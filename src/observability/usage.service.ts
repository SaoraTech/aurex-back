import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { and, eq, gte, sql } from 'drizzle-orm';
import { DRIZZLE } from '../db/db.constants';
import { providerUsage } from '../db/schema';
import { newId } from '../common/ids';

export type UsageKind =
  | 'tts_chars'
  | 'stt_call'
  | 'web_search'
  | 'deep_research'
  | 'llm_call'
  | 'math_call';

export interface CostEstimate {
  costUsd: number | null;
  isEstimated: boolean;
  isUnknown: boolean;
  currency: 'USD';
  note?: string;
}

export interface UsageSummaryItem {
  kind: UsageKind;
  provider: string;
  totalUnits: number;
  callCount: number;
  avgLatencyMs: number | null;
  estimatedCostUsd: number | null;
}

export const startOfUtcDay = (d = new Date()) =>
  new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));

export const startOfUtcMonth = (d = new Date()) =>
  new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));

/** Indicative unit prices per 1,000 units (or per call). Overridable via MODEL_PRICING_JSON. */
const DEFAULT_UNIT_PRICES_PER_1K: Record<UsageKind, number | null> = {
  llm_call: 0.0005, // e.g., $0.50 / 1M tokens
  tts_chars: 0.015, // e.g., $15 / 1M chars (~$0.015 / 1k chars)
  stt_call: 5.0, // per 1k calls ($0.005 / call)
  web_search: 5.0, // per 1k searches ($0.005 / search)
  deep_research: 20.0, // per 1k deep queries ($0.02 / query)
  math_call: 2.0, // per 1k compute calls ($0.002 / call)
};

/** Records provider calls (for quotas, observability, and cost tracking). Recording never breaks the request path. */
@Injectable()
export class UsageService {
  private readonly logger = new Logger(UsageService.name);

  constructor(
    @Inject(DRIZZLE) private readonly db: any,
    private readonly config?: ConfigService,
  ) {}

  async record(input: {
    userId?: string | null;
    kind: UsageKind;
    provider: string;
    units?: number;
    latencyMs?: number;
    outcome: string;
    requestId?: string;
  }) {
    try {
      await this.db.insert(providerUsage).values({
        id: newId(),
        userId: input.userId ?? null,
        kind: input.kind,
        provider: input.provider,
        units: Math.max(0, Math.round(input.units ?? 1)),
        latencyMs: input.latencyMs ?? null,
        outcome: input.outcome,
        requestId: input.requestId ?? null,
      });
    } catch (error) {
      this.logger.error({ msg: 'usage_record_failed', kind: input.kind, error: (error as Error).message });
    }
  }

  /** Sum of units consumed by a user for a kind since a date. Throws on DB error so quota checks fail closed. */
  async sumSince(userId: string, kind: UsageKind, since: Date): Promise<number> {
    const rows = await this.db
      .select({ total: sql<number>`coalesce(sum(${providerUsage.units}), 0)` })
      .from(providerUsage)
      .where(and(eq(providerUsage.userId, userId), eq(providerUsage.kind, kind), gte(providerUsage.createdAt, since)));
    return Number(rows[0]?.total ?? 0);
  }

  /**
   * Estimates cost for measured provider calls based on standard or configured rates.
   * Clearly distinguishes estimated costs from unknown costs.
   */
  estimateCost(input: { kind: UsageKind; units: number; provider?: string }): CostEstimate {
    let customRates: Partial<Record<UsageKind, number>> = {};
    const rawConfig = this.config?.get<string>('MODEL_PRICING_JSON');
    if (rawConfig) {
      try { customRates = JSON.parse(rawConfig); } catch { /* ignore */ }
    }

    const pricePer1k = customRates[input.kind] ?? DEFAULT_UNIT_PRICES_PER_1K[input.kind];

    if (pricePer1k === null || pricePer1k === undefined) {
      return {
        costUsd: null,
        isEstimated: false,
        isUnknown: true,
        currency: 'USD',
        note: 'Pricing not configured for provider/kind',
      };
    }

    const costUsd = Math.round(((input.units / 1000) * pricePer1k) * 1_000_000) / 1_000_000;
    return {
      costUsd,
      isEstimated: true,
      isUnknown: false,
      currency: 'USD',
    };
  }

  /**
   * Aggregates usage summary for a user since a given timestamp (default: start of month).
   * Grouped by kind and provider for transparent usage monitoring.
   */
  async getUserUsageSummary(userId: string, since = startOfUtcMonth()): Promise<UsageSummaryItem[]> {
    const rows = await this.db
      .select({
        kind: providerUsage.kind,
        provider: providerUsage.provider,
        totalUnits: sql<number>`coalesce(sum(${providerUsage.units}), 0)`,
        callCount: sql<number>`count(*)`,
        avgLatencyMs: sql<number>`round(avg(${providerUsage.latencyMs}))`,
      })
      .from(providerUsage)
      .where(and(eq(providerUsage.userId, userId), gte(providerUsage.createdAt, since)))
      .groupBy(providerUsage.kind, providerUsage.provider);

    return rows.map((r: any) => {
      const units = Number(r.totalUnits ?? 0);
      const cost = this.estimateCost({ kind: r.kind, units, provider: r.provider });
      return {
        kind: r.kind as UsageKind,
        provider: r.provider,
        totalUnits: units,
        callCount: Number(r.callCount ?? 0),
        avgLatencyMs: r.avgLatencyMs !== null ? Number(r.avgLatencyMs) : null,
        estimatedCostUsd: cost.costUsd,
      };
    });
  }

  /**
   * Detects abnormal consumption spikes for an account.
   */
  async detectAbnormalConsumption(userId: string, thresholdUnits = 50_000, since = startOfUtcDay()) {
    const rows = await this.db
      .select({
        totalUnits: sql<number>`coalesce(sum(${providerUsage.units}), 0)`,
      })
      .from(providerUsage)
      .where(and(eq(providerUsage.userId, userId), gte(providerUsage.createdAt, since)));

    const consumed = Number(rows[0]?.totalUnits ?? 0);
    return {
      userId,
      consumedUnits: consumed,
      thresholdUnits,
      isAbnormal: consumed >= thresholdUnits,
      evaluatedSince: since.toISOString(),
    };
  }
}
