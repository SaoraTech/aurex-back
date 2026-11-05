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
const RESERVATION_TTL_MS = 10 * 60 * 1000; // reservations expire after 10 minutes if not committed

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

  private async withTransaction<T>(fn: (tx: any) => Promise<T>): Promise<T> {
    if (typeof this.db?.transaction === 'function') {
      return this.db.transaction(fn);
    }
    // Fallback for environments without transaction support (e.g. unit-test mocks).
    return fn(this.db);
  }

  getPolicy(plan: PlanName, feature: string): QuotaPolicy {
    const raw = this.config.get<string>('quotaPoliciesJson');
    let overrides: Partial<Record<PlanName, Record<string, Partial<QuotaPolicy>>>> = {};
    if (raw) {
      try {
        overrides = JSON.parse(raw);
      } catch {
        /* ignore invalid JSON */
      }
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
    if (!policy.adaptiveAdjustment) {
      const blockedUntil = new Date(now.getTime() + policy.baseBlockSeconds * 1000);
      return {
        blockedUntil: blockedUntil.toISOString(),
        retryAfterSeconds: policy.baseBlockSeconds,
        violationCount: 1,
      };
    }

    const rows = await this.db.select().from(featureBlock)
      .where(and(eq(featureBlock.userId, userId), eq(featureBlock.feature, feature)))
      .limit(1);

    const row = rows[0];
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
   * Resolve the quota window type for a feature by scanning the default policies
   * (the window is consistent across all plans for a given feature).
   */
  private windowTypeForFeature(feature: string): 'day' | 'month' {
    for (const planPolicies of Object.values(DEFAULT_QUOTA_POLICIES)) {
      const p = (planPolicies as any)[feature];
      if (p?.window === 'month' || p?.window === 'day') return p.window;
    }
    return 'day';
  }

  private async fetchUsage(tx: any, userId: string, feature: string, windowStart: Date) {
    const rows = await tx.select().from(featureQuotaUsage)
      .where(and(
        eq(featureQuotaUsage.userId, userId),
        eq(featureQuotaUsage.feature, feature),
        eq(featureQuotaUsage.windowStart, windowStart),
      ))
      .limit(1);
    return rows?.[0];
  }

  async reserveQuota(
    userId: string,
    feature: string,
    plan: PlanName,
    operationId: string = newId(),
    units = 1,
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

    return this.withTransaction(async (tx) => {
      // 2. Idempotency: verify existing operationId if present.
      const existingRows = await tx.select().from(featureQuotaLedger)
        .where(eq(featureQuotaLedger.id, operationId))
        .limit(1);
      const existing = existingRows?.[0];

      if (existing) {
        const existingWindowType = this.windowTypeForFeature(existing.feature);
        const { windowStart: existingWindowStart } = this.getWindowBounds(existingWindowType, new Date(existing.createdAt));
        const isConflict =
          existing.userId !== userId ||
          existing.feature !== feature ||
          (existing.units ?? 1) !== units ||
          existingWindowStart.getTime() !== windowStart.getTime();

        if (isConflict) {
          return {
            allowed: false,
            operationId,
            feature,
            limit: policy.limit,
            used: policy.limit,
            remaining: 0,
            resetAt,
            errorCode: 'OPERATION_ID_CONFLICT',
            errorMessage: 'Cet identifiant d’opération a déjà été utilisé avec des paramètres différents.',
          };
        }

        if (existing.status === 'reserved' || existing.status === 'consumed') {
          const usageRow = await this.fetchUsage(tx, userId, feature, windowStart);
          const used = usageRow?.usedCount ?? 0;
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

        if (existing.status === 'refunded') {
          return {
            allowed: false,
            operationId,
            feature,
            limit: policy.limit,
            used: policy.limit,
            remaining: 0,
            resetAt,
            errorCode: 'OPERATION_ALREADY_REFUNDED',
            errorMessage: 'Cette opération a déjà été remboursée.',
          };
        }

        if (existing.status === 'expired') {
          return {
            allowed: false,
            operationId,
            feature,
            limit: policy.limit,
            used: policy.limit,
            remaining: 0,
            resetAt,
            errorCode: 'OPERATION_EXPIRED',
            errorMessage: 'Cette réservation a expiré.',
          };
        }

        return {
          allowed: false,
          operationId,
          feature,
          limit: policy.limit,
          used: policy.limit,
          remaining: 0,
          resetAt,
          errorCode: 'INVALID_OPERATION_STATUS',
          errorMessage: `Statut d’opération invalide : ${existing.status}.`,
        };
      }

      // 3. Insert ledger entry first (primary key guarantees uniqueness of the operation).
      try {
        await tx.insert(featureQuotaLedger).values({
          id: operationId,
          userId,
          feature,
          units,
          status: 'reserved',
          createdAt: now,
          updatedAt: now,
        });
      } catch (err) {
        // Race: another transaction inserted the same operationId. Re-read and verify identity.
        const raceRows = await tx.select().from(featureQuotaLedger)
          .where(eq(featureQuotaLedger.id, operationId))
          .limit(1);
        const race = raceRows?.[0];
        if (race) {
          const raceWindowType = this.windowTypeForFeature(race.feature);
          const { windowStart: raceWindowStart } = this.getWindowBounds(raceWindowType, new Date(race.createdAt));
          const isRaceConflict =
            race.userId !== userId ||
            race.feature !== feature ||
            (race.units ?? 1) !== units ||
            raceWindowStart.getTime() !== windowStart.getTime();

          if (isRaceConflict) {
            return {
              allowed: false,
              operationId,
              feature,
              limit: policy.limit,
              used: policy.limit,
              remaining: 0,
              resetAt,
              errorCode: 'OPERATION_ID_CONFLICT',
              errorMessage: 'Cet identifiant d’opération a déjà été utilisé avec des paramètres différents.',
            };
          }

          if (race.status === 'reserved' || race.status === 'consumed') {
            const usageRow = await this.fetchUsage(tx, userId, feature, windowStart);
            const used = usageRow?.usedCount ?? 0;
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

          if (race.status === 'refunded') {
            return {
              allowed: false,
              operationId,
              feature,
              limit: policy.limit,
              used: policy.limit,
              remaining: 0,
              resetAt,
              errorCode: 'OPERATION_ALREADY_REFUNDED',
              errorMessage: 'Cette opération a déjà été remboursée.',
            };
          }

          if (race.status === 'expired') {
            return {
              allowed: false,
              operationId,
              feature,
              limit: policy.limit,
              used: policy.limit,
              remaining: 0,
              resetAt,
              errorCode: 'OPERATION_EXPIRED',
              errorMessage: 'Cette réservation a expiré.',
            };
          }
        }
        throw err;
      }

      // 4. Atomic conditional upsert of the usage counter.
      const upsertRes = await tx.execute(sql`
        INSERT INTO feature_quota_usage (id, user_id, feature, window_start, window_end, used_count, created_at, updated_at)
        VALUES (${newId()}, ${userId}, ${feature}, ${windowStart}, ${windowEnd}, ${units}, ${now}, ${now})
        ON CONFLICT (user_id, feature, window_start)
        DO UPDATE SET
          used_count = feature_quota_usage.used_count + ${units},
          updated_at = ${now}
        WHERE feature_quota_usage.used_count + ${units} <= ${policy.limit}
        RETURNING used_count;
      `);

      const row = upsertRes.rows?.[0] as { used_count?: number } | undefined;
      if (row && typeof row.used_count === 'number') {
        const used = row.used_count;
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

      // 5. Quota exhausted: clean up unfulfilled reservation so no phantom row exists in the ledger.
      if (typeof tx.delete === 'function') {
        await tx.delete(featureQuotaLedger)
          .where(and(eq(featureQuotaLedger.id, operationId), eq(featureQuotaLedger.status, 'reserved')));
      }

      const usageRows = await tx.select().from(featureQuotaUsage)
        .where(and(
          eq(featureQuotaUsage.userId, userId),
          eq(featureQuotaUsage.feature, feature),
          eq(featureQuotaUsage.windowStart, windowStart),
        ))
        .limit(1);

      const currentUsed = usageRows?.[0]?.usedCount ?? policy.limit;
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
    });
  }

  async commitQuota(operationId: string): Promise<boolean> {
    return this.withTransaction(async (tx) => {
      const updated = await tx.update(featureQuotaLedger)
        .set({ status: 'consumed', updatedAt: new Date() })
        .where(and(eq(featureQuotaLedger.id, operationId), eq(featureQuotaLedger.status, 'reserved')))
        .returning({ id: featureQuotaLedger.id });
      return (updated?.length ?? 0) > 0;
    });
  }

  async compensateQuota(operationId: string): Promise<boolean> {
    return this.withTransaction(async (tx) => {
      const updated = await tx.update(featureQuotaLedger)
        .set({ status: 'refunded', updatedAt: new Date() })
        .where(and(eq(featureQuotaLedger.id, operationId), eq(featureQuotaLedger.status, 'reserved')))
        .returning({
          userId: featureQuotaLedger.userId,
          feature: featureQuotaLedger.feature,
          units: featureQuotaLedger.units,
          createdAt: featureQuotaLedger.createdAt,
        });

      const entry = updated?.[0];
      if (!entry) {
        return false; // already consumed, refunded, expired, or not found
      }

      const units = entry.units ?? 1;
      const windowType = this.windowTypeForFeature(entry.feature);
      const { windowStart } = this.getWindowBounds(windowType, new Date(entry.createdAt));

      await tx.execute(sql`
        UPDATE feature_quota_usage
        SET used_count = GREATEST(0, used_count - ${units}), updated_at = NOW()
        WHERE user_id = ${entry.userId} AND feature = ${entry.feature} AND window_start = ${windowStart};
      `);

      return true;
    });
  }

  /**
   * Marks a still-reserved operation as expired and refunds it exactly once.
   */
  async expireQuota(operationId: string): Promise<boolean> {
    return this.withTransaction(async (tx) => {
      const updated = await tx.update(featureQuotaLedger)
        .set({ status: 'expired', updatedAt: new Date() })
        .where(and(eq(featureQuotaLedger.id, operationId), eq(featureQuotaLedger.status, 'reserved')))
        .returning({
          userId: featureQuotaLedger.userId,
          feature: featureQuotaLedger.feature,
          units: featureQuotaLedger.units,
          createdAt: featureQuotaLedger.createdAt,
        });

      const entry = updated?.[0];
      if (!entry) {
        return false;
      }

      const units = entry.units ?? 1;
      const windowType = this.windowTypeForFeature(entry.feature);
      const { windowStart } = this.getWindowBounds(windowType, new Date(entry.createdAt));

      await tx.execute(sql`
        UPDATE feature_quota_usage
        SET used_count = GREATEST(0, used_count - ${units}), updated_at = NOW()
        WHERE user_id = ${entry.userId} AND feature = ${entry.feature} AND window_start = ${windowStart};
      `);

      return true;
    });
  }

  /**
   * Expires reservations older than the TTL without double refund.
   */
  async expireStaleReservations(now = new Date(), ttlMs = RESERVATION_TTL_MS): Promise<number> {
    const cutoff = new Date(now.getTime() - ttlMs);
    const rows = await this.db.select().from(featureQuotaLedger)
      .where(eq(featureQuotaLedger.status, 'reserved'));

    let count = 0;
    for (const r of rows ?? []) {
      if (new Date(r.createdAt).getTime() <= cutoff.getTime()) {
        const ok = await this.expireQuota(r.id);
        if (ok) count++;
      }
    }
    return count;
  }

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

    const used = usageRows?.[0]?.usedCount ?? 0;
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

  async runWithQuota<T>(
    userId: string,
    feature: string,
    plan: PlanName,
    fn: (operationId: string) => Promise<T>,
    operationId: string = newId(),
    units = 1,
  ): Promise<T> {
    const res = await this.reserveQuota(userId, feature, plan, operationId, units);
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
      await this.compensateQuota(res.operationId);
      throw err;
    }
  }
}

