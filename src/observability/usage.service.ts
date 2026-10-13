import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, eq, gte, sql } from 'drizzle-orm';
import { DRIZZLE } from '../db/db.constants';
import { providerUsage } from '../db/schema';
import { newId } from '../common/ids';

export type UsageKind = 'tts_chars' | 'stt_call' | 'web_search' | 'deep_research' | 'llm_call' | 'math_call';

export const startOfUtcDay = (d = new Date()) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
export const startOfUtcMonth = (d = new Date()) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));

/** Records provider calls (for quotas and cost tracking). Recording never breaks the request path. */
@Injectable()
export class UsageService {
  private readonly logger = new Logger(UsageService.name);
  constructor(@Inject(DRIZZLE) private readonly db: any) {}

  async record(input: { userId?: string | null; kind: UsageKind; provider: string; units?: number; latencyMs?: number; outcome: string; requestId?: string }) {
    try {
      await this.db.insert(providerUsage).values({
        id: newId(), userId: input.userId ?? null, kind: input.kind, provider: input.provider,
        units: Math.max(0, Math.round(input.units ?? 1)), latencyMs: input.latencyMs ?? null,
        outcome: input.outcome, requestId: input.requestId ?? null,
      });
    } catch (error) {
      this.logger.error({ msg: 'usage_record_failed', kind: input.kind, error: (error as Error).message });
    }
  }

  /** Sum of units consumed by a user for a kind since a date. Throws on DB error so quota checks fail closed. */
  async sumSince(userId: string, kind: UsageKind, since: Date): Promise<number> {
    const rows = await this.db.select({ total: sql<number>`coalesce(sum(${providerUsage.units}), 0)` }).from(providerUsage)
      .where(and(eq(providerUsage.userId, userId), eq(providerUsage.kind, kind), gte(providerUsage.createdAt, since)));
    return Number(rows[0]?.total ?? 0);
  }
}
