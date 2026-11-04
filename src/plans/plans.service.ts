import { Inject, Injectable, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { and, desc, eq, gte } from 'drizzle-orm';
import { DRIZZLE } from '../db/db.constants';
import { subscription } from '../db/schema';

export type PlanName = 'free' | 'plus' | 'pro' | 'plus_promo' | 'pro_promo';

export interface PlanLimits {
  dailyMessages: number;
  monthlyMessages: number;
  maxFileBytes: number;
  maxStorageBytes: number;
  dailyWebSearches: number;
  dailyDeepResearch: number;
  dailySpeechChars: number;
  dailyTranscriptions: number;
}

const DEFAULT_LIMITS: Record<PlanName, PlanLimits> = {
  free: { dailyMessages: 20, monthlyMessages: 300, maxFileBytes: 5_000_000, maxStorageBytes: 50_000_000, dailyWebSearches: 5, dailyDeepResearch: 1, dailySpeechChars: 5_000, dailyTranscriptions: 5 },
  plus: { dailyMessages: 100, monthlyMessages: 3000, maxFileBytes: 25_000_000, maxStorageBytes: 500_000_000, dailyWebSearches: 30, dailyDeepResearch: 5, dailySpeechChars: 30_000, dailyTranscriptions: 30 },
  pro: { dailyMessages: 300, monthlyMessages: 10000, maxFileBytes: 100_000_000, maxStorageBytes: 5_000_000_000, dailyWebSearches: 100, dailyDeepResearch: 20, dailySpeechChars: 100_000, dailyTranscriptions: 100 },
  plus_promo: { dailyMessages: 100, monthlyMessages: 1000, maxFileBytes: 25_000_000, maxStorageBytes: 500_000_000, dailyWebSearches: 30, dailyDeepResearch: 5, dailySpeechChars: 30_000, dailyTranscriptions: 30 },
  pro_promo: { dailyMessages: 300, monthlyMessages: 3000, maxFileBytes: 100_000_000, maxStorageBytes: 5_000_000_000, dailyWebSearches: 100, dailyDeepResearch: 20, dailySpeechChars: 100_000, dailyTranscriptions: 100 },
};

@Injectable()
export class PlansService {
  constructor(
    @Optional() private readonly config?: ConfigService,
    @Optional() @Inject(DRIZZLE) private readonly db?: any,
  ) {}

  private parse<T>(key: string, fallback: T): T {
    try {
      return JSON.parse(this.config?.get<string>(key) ?? '') as T;
    } catch {
      return fallback;
    }
  }

  getPrices(): Record<PlanName, number> {
    return this.parse('PLAN_PRICES_JSON', {
      free: 0,
      plus: 5000,
      pro: 10000,
      plus_promo: 1500,
      pro_promo: 3000,
    });
  }

  getLimits(): Record<PlanName, PlanLimits>;
  getLimits(plan: PlanName): PlanLimits;
  getLimits(plan?: PlanName): Record<PlanName, PlanLimits> | PlanLimits {
    const parsed = this.parse<Partial<Record<PlanName, Partial<PlanLimits>>>>('PLAN_LIMITS_JSON', {});
    const hardCeiling = Number(this.config?.get('uploadMaxBytes') ?? this.config?.get('UPLOAD_MAX_BYTES') ?? 26_214_400);

    const out = {} as Record<PlanName, PlanLimits>;
    for (const p of ['free', 'plus', 'pro', 'plus_promo', 'pro_promo'] as PlanName[]) {
      const merged = { ...DEFAULT_LIMITS[p], ...(parsed[p] ?? {}) };
      out[p] = { ...merged, maxFileBytes: Math.min(merged.maxFileBytes, hardCeiling) };
    }

    if (plan) {
      return out[plan] ?? out.free;
    }
    return out;
  }

  list() {
    const prices = this.getPrices();
    const limits = this.getLimits();
    return (['free', 'plus', 'pro', 'plus_promo', 'pro_promo'] as PlanName[]).map(id => ({
      id,
      priceXofPerMonth: prices[id],
      limits: limits[id],
    }));
  }

  async getEffectivePlan(userId: string): Promise<PlanName> {
    if (!this.db) return 'free';
    try {
      const rows = await this.db
        .select({ plan: subscription.plan })
        .from(subscription)
        .where(
          and(
            eq(subscription.userId, userId),
            eq(subscription.status, 'active'),
            gte(subscription.currentPeriodEnd, new Date()),
          ),
        )
        .orderBy(desc(subscription.updatedAt))
        .limit(5);

      const plans = rows.map((r: { plan: PlanName }) => r.plan);
      if (plans.includes('pro') || plans.includes('pro_promo')) return 'pro';
      if (plans.includes('plus') || plans.includes('plus_promo')) return 'plus';
      return 'free';
    } catch {
      return 'free';
    }
  }
}
