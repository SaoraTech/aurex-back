import { Inject, Injectable, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { and, desc, eq, gte, isNull, or } from 'drizzle-orm';
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
  dailyMathCompute: number;
}

export interface SubscriptionInfo {
  plan: PlanName;
  commercialTier: 'free' | 'plus' | 'pro';
  isPromo: boolean;
  status: 'active' | 'expired' | 'canceled' | 'none';
  currentPeriodStart?: Date;
  currentPeriodEnd?: Date | null;
  cancelAtPeriodEnd?: boolean;
}

const DEFAULT_LIMITS: Record<PlanName, PlanLimits> = {
  free: {
    dailyMessages: 20,
    monthlyMessages: 300,
    maxFileBytes: 5_000_000,
    maxStorageBytes: 50_000_000,
    dailyWebSearches: 5,
    dailyDeepResearch: 1,
    dailySpeechChars: 5_000,
    dailyTranscriptions: 5,
    dailyMathCompute: 50,
  },
  plus: {
    dailyMessages: 100,
    monthlyMessages: 3000,
    maxFileBytes: 25_000_000,
    maxStorageBytes: 500_000_000,
    dailyWebSearches: 30,
    dailyDeepResearch: 5,
    dailySpeechChars: 30_000,
    dailyTranscriptions: 30,
    dailyMathCompute: 500,
  },
  pro: {
    dailyMessages: 300,
    monthlyMessages: 10000,
    maxFileBytes: 100_000_000,
    maxStorageBytes: 5_000_000_000,
    dailyWebSearches: 100,
    dailyDeepResearch: 20,
    dailySpeechChars: 100_000,
    dailyTranscriptions: 100,
    dailyMathCompute: 2000,
  },
  plus_promo: {
    dailyMessages: 100,
    monthlyMessages: 1000,
    maxFileBytes: 25_000_000,
    maxStorageBytes: 500_000_000,
    dailyWebSearches: 30,
    dailyDeepResearch: 5,
    dailySpeechChars: 30_000,
    dailyTranscriptions: 30,
    dailyMathCompute: 200,
  },
  pro_promo: {
    dailyMessages: 300,
    monthlyMessages: 3000,
    maxFileBytes: 100_000_000,
    maxStorageBytes: 5_000_000_000,
    dailyWebSearches: 100,
    dailyDeepResearch: 20,
    dailySpeechChars: 100_000,
    dailyTranscriptions: 100,
    dailyMathCompute: 1000,
  },
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
    const parsed = this.parse<Partial<Record<PlanName, Partial<PlanLimits>>>>(
      'PLAN_LIMITS_JSON',
      {},
    );
    const hardCeiling = Number(
      this.config?.get('uploadMaxBytes') ??
        this.config?.get('UPLOAD_MAX_BYTES') ??
        26_214_400,
    );
    const out = {} as Record<PlanName, PlanLimits>;
    for (const p of [
      'free',
      'plus',
      'pro',
      'plus_promo',
      'pro_promo',
    ] as PlanName[]) {
      const merged = { ...DEFAULT_LIMITS[p], ...(parsed[p] ?? {}) };
      out[p] = {
        ...merged,
        maxFileBytes: Math.min(merged.maxFileBytes, hardCeiling),
      };
    }
    if (plan) {
      return out[plan] ?? out.free;
    }
    return out;
  }

  list() {
    const prices = this.getPrices();
    const limits = this.getLimits();
    return (
      ['free', 'plus', 'pro', 'plus_promo', 'pro_promo'] as PlanName[]
    ).map(id => ({
      id,
      priceXof: prices[id],
      isPromotion: id.endsWith('_promo'),
      durationDays: id.endsWith('_promo') ? 7 : id === 'free' ? 0 : 30,
      limits: limits[id],
    }));
  }

  /**
   * Returns the exact effective plan without prematurely losing promotion identity.
   * If a user has an active, non-expired plus_promo or pro_promo, it returns that exact plan.
   * When expired, user drops back to free unless they have an active standard subscription.
   */
  async getEffectivePlan(userId: string): Promise<PlanName> {
    const info = await this.getSubscriptionInfo(userId);
    return info.plan;
  }

  async getSubscriptionInfo(userId: string): Promise<SubscriptionInfo> {
    if (!this.db) {
      return {
        plan: 'free',
        commercialTier: 'free',
        isPromo: false,
        status: 'none',
      };
    }

    const now = new Date();
      const rows = await this.db
        .select({
          plan: subscription.plan,
          status: subscription.status,
          currentPeriodStart: subscription.currentPeriodStart,
          currentPeriodEnd: subscription.currentPeriodEnd,
          cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
        })
        .from(subscription)
        .where(
          and(
            eq(subscription.userId, userId),
            eq(subscription.status, 'active'),
            or(isNull(subscription.currentPeriodEnd), gte(subscription.currentPeriodEnd, now)),
          ),
        )
        .orderBy(desc(subscription.updatedAt))
        .limit(5);

      if (!rows || rows.length === 0) {
        return {
          plan: 'free',
          commercialTier: 'free',
          isPromo: false,
          status: 'none',
        };
      }

      // Check priority: pro > pro_promo > plus > plus_promo > free
      const activeSubs = rows as Array<{
        plan: PlanName;
        status: string;
        currentPeriodStart: Date;
        currentPeriodEnd: Date | null;
        cancelAtPeriodEnd: boolean;
      }>;

      // Exact promotional retention without loss of promo metadata
      const found =
        activeSubs.find(s => s.plan === 'pro') ??
        activeSubs.find(s => s.plan === 'pro_promo') ??
        activeSubs.find(s => s.plan === 'plus') ??
        activeSubs.find(s => s.plan === 'plus_promo') ??
        activeSubs[0];

      const p = found.plan;
      const isPromo = p.endsWith('_promo');
      const commercialTier = p.startsWith('pro')
        ? 'pro'
        : p.startsWith('plus')
          ? 'plus'
          : 'free';

      return {
        plan: p,
        commercialTier,
        isPromo,
        status: 'active',
        currentPeriodStart: found.currentPeriodStart,
        currentPeriodEnd: found.currentPeriodEnd,
        cancelAtPeriodEnd: found.cancelAtPeriodEnd,
      };
  }
}
