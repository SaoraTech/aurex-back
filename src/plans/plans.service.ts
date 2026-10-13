import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { and, desc, eq, gte } from 'drizzle-orm';
import { DRIZZLE } from '../db/db.constants';
import { subscription } from '../db/schema';

export type PlanName = 'free' | 'plus' | 'pro';
export interface PlanLimits {
  dailyMessages: number; monthlyMessages: number; maxFileBytes: number; maxStorageBytes: number;
  dailyWebSearches: number; dailyDeepResearch: number; dailySpeechChars: number; dailyTranscriptions: number;
}

// Provisional defaults (not final commercial decisions); overridable with PLAN_LIMITS_JSON, field by field.
const DEFAULT_LIMITS: Record<PlanName, PlanLimits> = {
  free: { dailyMessages: 20, monthlyMessages: 300, maxFileBytes: 5_000_000, maxStorageBytes: 50_000_000, dailyWebSearches: 5, dailyDeepResearch: 1, dailySpeechChars: 5_000, dailyTranscriptions: 5 },
  plus: { dailyMessages: 100, monthlyMessages: 3000, maxFileBytes: 25_000_000, maxStorageBytes: 500_000_000, dailyWebSearches: 30, dailyDeepResearch: 5, dailySpeechChars: 30_000, dailyTranscriptions: 30 },
  pro: { dailyMessages: 300, monthlyMessages: 10000, maxFileBytes: 100_000_000, maxStorageBytes: 5_000_000_000, dailyWebSearches: 100, dailyDeepResearch: 20, dailySpeechChars: 100_000, dailyTranscriptions: 100 },
};

@Injectable()
export class PlansService {
  constructor(private readonly config: ConfigService, @Inject(DRIZZLE) private readonly db: any) {}

  private parse<T>(key: string, fallback: T): T {
    try { return JSON.parse(this.config.get<string>(key) ?? '') as T; } catch { return fallback; }
  }
  getPrices(): Record<PlanName, number> { return this.parse('PLAN_PRICES_JSON', { free: 0, plus: 1500, pro: 3000 }); }

  getLimits(): Record<PlanName, PlanLimits> {
    const parsed = this.parse<Partial<Record<PlanName, Partial<PlanLimits>>>>('PLAN_LIMITS_JSON', {});
    const hardCeiling = Number(this.config.get('uploadMaxBytes') ?? this.config.get('UPLOAD_MAX_BYTES') ?? 26_214_400);
    const out = {} as Record<PlanName, PlanLimits>;
    for (const plan of ['free', 'plus', 'pro'] as PlanName[]) {
      const merged = { ...DEFAULT_LIMITS[plan], ...(parsed[plan] ?? {}) };
      // A plan can never allow a single upload larger than the server-side in-memory ceiling.
      out[plan] = { ...merged, maxFileBytes: Math.min(merged.maxFileBytes, hardCeiling) };
    }
    return out;
  }

  list() {
    const prices = this.getPrices(); const limits = this.getLimits();
    return (['free', 'plus', 'pro'] as PlanName[]).map(id => ({ id, priceXofPerMonth: prices[id], limits: limits[id] }));
  }

  /** Effective plan derived from an active, unexpired subscription in the database — never from the client. */
  async getEffectivePlan(userId: string): Promise<PlanName> {
    const rows = await this.db.select({ plan: subscription.plan }).from(subscription)
      .where(and(eq(subscription.userId, userId), eq(subscription.status, 'active'), gte(subscription.currentPeriodEnd, new Date())))
      .orderBy(desc(subscription.updatedAt)).limit(5);
    const plans = rows.map((r: { plan: PlanName }) => r.plan);
    if (plans.includes('pro')) return 'pro';
    if (plans.includes('plus')) return 'plus';
    return 'free';
  }
}
