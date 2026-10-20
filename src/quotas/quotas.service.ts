import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { and, eq, sql } from 'drizzle-orm';
import { DRIZZLE } from '../db/db.constants';
import { featureBlock, featureQuotaLedger, featureQuotaUsage } from '../db/schema';
import { newId } from '../common/ids';
import { AppException } from '../common/errors';
import { PlanName } from '../plans/plans.service';
import { DEFAULT_QUOTA_POLICIES } from './quota-policies';
import { QuotaPolicy, QuotaStatus, ReservationResult } from './quota.types';

const BURST_WINDOW_MS = 600_000; // 10 minutes

export function startOfUtcDay(d = new Date()): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

export function startOfNextUtcDay(d = new Date()): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1));
}

export function startOfUtcMonth(d = new Date()): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}

export function startOfNextUtcMonth(d = new Date()): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1));
}

@Injectable()
export class QuotasService {
  private readonly logger = new Logger(QuotasService.name);

  constructor(
    @Inject(DRIZZLE) private readonly db: any,
    private readonly config: ConfigService,
  ) {}

  getPolicy(plan: PlanName, feature: string): QuotaPolicy {
    const raw = this.config.get<string>('quotaPoliciesJson');
    let overrides: Partial<Record<PlanName, Record<string, Partial<QuotaPolicy>>>> = {};
    if (raw) {
      try { overrides = JSON.parse(raw); } catch { /* ignore invalid JSON */ }
    }

    const defaultForPlan = DEFAULT_QUOTA_POLICIES[plan] ?? DEFAULT_QUOTA_POLICIES.free;
    const defaultPolicy: QuotaPolicy = defaultForPlan[feature] ?? {
      limit: 10,
      window: 'day',
      baseBlockSeconds: 300,
      maxBlockSeconds: 86400,
      adaptiveAdjustment: true,
      enabled: true,
    };

    const overridePolicy = overrides[plan]?.[feature] ?? {};
    return { ...defaultPolicy, ...overridePolicy };
  }

  getWindowBounds(window: 'day' | 'month', now = new Date()): { windowStart: Date; windowEnd: Date } {
    if (window === 'month') {
      return {
        windowStart: startOfUtcMonth(now),
        windowEnd: startOfNextUtcMonth(now),
      };
    }
    return {
      windowStart: startOfUtcDay(now),
      windowEnd: startOfNextUtcDay(now),
    };
  }

  async getActiveBlock(userId: string, feature: string, now = new Date()) {
    const rows = await this.db.select().from(featureBlock)
      .where(and(eq(featureBlock.userId, userId), eq(featureBlock.feature, feature)))
      .limit(1);

    const block = rows[0];
    if (!block) return null;

    if (new Date(block.blockedUntil).getTime() > now.getTime()) {
      const remainingSeconds = Math.max(1, Math.ceil((new Date(block.blockedUntil).getTime() - now.getTime()) / 1000));
      return {
        blockedUntil: new Date(block.blockedUntil).toISOString(),
        retryAfterSeconds: remainingSeconds,
        violationCount: block.violationCount,
      };
    }

    return null;
  }

  async recordAdaptiveViolation(userId: string, feature: string, policy: QuotaPolicy, now = new Date()) {
    const existing = await this.db.select().from(featureBlock)
      .where(and(eq(featureBlock.userId, userId), eq(featureBlock.feature, feature)))
      .limit(1);

    const row = existing[0];
    let violationCount = 1;

    if (row) {
      const timeSinceLast = now.getTime() - new Date(row.lastViolationAt).getTime();
      if (timeSinceLast <= BURST_WINDOW_MS) {
        violationCount = (row.violationCount ?? 1) + 1;
      }
    }

    const multiplier = Math.pow(2, Math.max(0, violationCount - 1));
    const durationSeconds = Math.min(policy.baseBlockSeconds * multiplier, policy.maxBlockSeconds);
    const blockedUntil = new Date(now.getTime() + durationSeconds * 1000);

    await this.db.insert(featureBlock).values({
      id: newId(),
      userId,
      feature,
      blockedUntil,
      reason: 'Repeated requests after quota exhaustion',
      violationCount,
      lastViolationAt: now,
      createdAt: now,
      updatedAt: now,
    }).onConflictDoUpdate({
      target: [featureBlock.userId, featureBlock.feature],
      set: {
        blockedUntil,
        violationCount,
        lastViolationAt: now,
        updatedAt: now,
      },
    });

    return {
      blockedUntil: blockedUntil.toISOString(),
      retryAfterSeconds: durationSeconds,
      violationCount,
    };
  }

  /**
   * Atomically reserves 1 unit of quota for (userId, feature).
   * Concurrency-safe: utilizes conditional PostgreSQL atomic upsert.
   */
  async reserveQuota(
    userId: string,
    feature: string,
    plan: PlanName,
    operationId: string = newId(),
    now = new Date(),
  ): Promise<ReservationResult> {
    const policy = this.getPolicy(plan, feature);
    const { windowStart, windowEnd } = this.getWindowBounds(policy.window, now);
    const resetAt = windowEnd.toISOString();

    if (!policy.enabled) {
      return {
        allowed: false,
        operationId,
        feature,
        limit: 0,
        used: 0,
        remaining: 0,
        resetAt,
        errorCode: 'FEATURE_DISABLED',
        errorMessage: 'Cette fonctionnalité est temporairement désactivée.',
      };
    }

    // 1. Check if a temporary block is active
    const activeBlock = await this.getActiveBlock(userId, feature, now);
    if (activeBlock) {
      // User is continuing to query while blocked: increment adaptive violation
      const updatedBlock = await this.recordAdaptiveViolation(userId, feature, policy, now);
      return {
        allowed: false,
        operationId,
        feature,
        limit: policy.limit,
        used: policy.limit,
        remaining: 0,
        resetAt,
        blockedUntil: updatedBlock.blockedUntil,
        retryAfterSeconds: updatedBlock.retryAfterSeconds,
        errorCode: 'FEATURE_TEMPORARILY_BLOCKED',
        errorMessage: 'Cette fonctionnalité est temporairement bloquée suite à des requêtes répétées.',
      };
    }

    // 2. Atomic reservation query: only increments used_count if used_count + 1 <= policy.limit
    const upsertRes = await this.db.execute(sql`
      INSERT INTO feature_quota_usage (id, user_id, feature, window_start, window_end, used_count, created_at, updated_at)
      VALUES (${newId()}, ${userId}, ${feature}, ${windowStart}, ${windowEnd}, 1, ${now}, ${now})
      ON CONFLICT (user_id, feature, window_start)
      DO UPDATE SET
        used_count = feature_quota_usage.used_count + 1,
        updated_at = ${now}
      WHERE feature_quota_usage.used_count + 1 <= ${policy.limit}
      RETURNING used_count;
    `);

    const row = upsertRes.rows?.[0] as { used_count?: number } | undefined;

    if (row && typeof row.used_count === 'number') {
      const used = row.used_count;
      // Record reservation in ledger for strict idempotency and tracking
      await this.db.insert(featureQuotaLedger).values({
        id: operationId,
        userId,
        feature,
        status: 'reserved',
        createdAt: now,
        updatedAt: now,
      });

      return {
        allowed: true,
        operationId,
        feature,
        limit: policy.limit,
        used,
        remaining: Math.max(0, policy.limit - used),
        resetAt,
      };
    }

    // 3. Quota limit reached (no rows updated)
    const usageRows = await this.db.select().from(featureQuotaUsage)
      .where(and(
        eq(featureQuotaUsage.userId, userId),
        eq(featureQuotaUsage.feature, feature),
        eq(featureQuotaUsage.windowStart, windowStart),
      ))
      .limit(1);

    const currentUsed = usageRows[0]?.usedCount ?? policy.limit;
    const retryAfterSeconds = Math.max(1, Math.ceil((windowEnd.getTime() - now.getTime()) / 1000));

    return {
      allowed: false,
      operationId,
      feature,
      limit: policy.limit,
      used: currentUsed,
      remaining: 0,
      resetAt,
      retryAfterSeconds,
      errorCode: 'FEATURE_LIMIT_REACHED',
      errorMessage: 'La limite d’utilisation de cette fonctionnalité est atteinte pour cette période.',
    };
  }

  /**
   * Confirms consumption of a previously reserved quota slot.
   */
  async commitQuota(operationId: string): Promise<void> {
    await this.db.update(featureQuotaLedger)
      .set({ status: 'consumed', updatedAt: new Date() })
      .where(eq(featureQuotaLedger.id, operationId));
  }

  /**
   * Idempotent compensation: refunds 1 reserved unit if operation failed or aborted.
   * Can never refund twice because of strict WHERE status = 'reserved'.
   */
  async compensateQuota(operationId: string): Promise<boolean> {
    const updated = await this.db.update(featureQuotaLedger)
      .set({ status: 'refunded', updatedAt: new Date() })
      .where(and(eq(featureQuotaLedger.id, operationId), eq(featureQuotaLedger.status, 'reserved')))
      .returning({ userId: featureQuotaLedger.userId, feature: featureQuotaLedger.feature, createdAt: featureQuotaLedger.createdAt });

    const entry = updated[0];
    if (!entry) {
      return false; // already consumed, refunded, or not found
    }

    const { windowStart } = this.getWindowBounds('day', new Date(entry.createdAt));

    await this.db.execute(sql`
      UPDATE feature_quota_usage
      SET used_count = GREATEST(0, used_count - 1), updated_at = NOW()
      WHERE user_id = ${entry.userId} AND feature = ${entry.feature} AND window_start = ${windowStart};
    `);

    return true;
  }

  /**
   * Returns current quota and block status for a given user & feature.
   */
  async getStatus(userId: string, plan: PlanName, feature: string): Promise<QuotaStatus> {
    const policy = this.getPolicy(plan, feature);
    const now = new Date();
    const { windowStart, windowEnd } = this.getWindowBounds(policy.window, now);
    const resetAt = windowEnd.toISOString();

    const activeBlock = await this.getActiveBlock(userId, feature, now);

    const usageRows = await this.db.select().from(featureQuotaUsage)
      .where(and(
        eq(featureQuotaUsage.userId, userId),
        eq(featureQuotaUsage.feature, feature),
        eq(featureQuotaUsage.windowStart, windowStart),
      ))
      .limit(1);

    const used = usageRows[0]?.usedCount ?? 0;
    const remaining = Math.max(0, policy.limit - used);

    return {
      feature,
      limit: policy.limit,
      used,
      remaining,
      isBlocked: !!activeBlock,
      blockedUntil: activeBlock?.blockedUntil ?? null,
      resetAt,
      retryAfterSeconds: activeBlock?.retryAfterSeconds ?? (remaining === 0 ? Math.ceil((windowEnd.getTime() - now.getTime()) / 1000) : undefined),
    };
  }

  /**
   * High-level helper: wraps an operation with atomic quota check, automatic commit, and compensation on error.
   */
  async runWithQuota<T>(
    userId: string,
    feature: string,
    plan: PlanName,
    fn: (operationId: string) => Promise<T>,
    operationId: string = newId(),
  ): Promise<T> {
    const res = await this.reserveQuota(userId, feature, plan, operationId);
    if (!res.allowed) {
      throw new AppException(
        429,
        res.errorCode ?? 'FEATURE_LIMIT_REACHED',
        res.errorMessage ?? 'Limite de quota atteinte.',
        {
          feature: res.feature,
          limit: res.limit,
          used: res.used,
          remaining: res.remaining,
          resetAt: res.resetAt,
          blockedUntil: res.blockedUntil,
          retryAfterSeconds: res.retryAfterSeconds,
        },
        res.retryAfterSeconds,
      );
    }

    try {
      const outcome = await fn(res.operationId);
      await this.commitQuota(res.operationId);
      return outcome;
    } catch (err) {
      // Automatically compensate/refund the reserved slot
      await this.compensateQuota(res.operationId);
      throw err;
    }
  }
}
