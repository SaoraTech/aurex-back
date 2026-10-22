import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, count, desc, eq, gte } from 'drizzle-orm';
import { AiOrchestratorService } from '../ai/ai-orchestrator.service';
import { AurexModelId } from '../ai/ai.types';
import { conflict, tooManyRequests } from '../common/errors';
import { newId } from '../common/ids';
import { ConversationsService } from '../conversations/conversations.service';
import { DRIZZLE } from '../db/db.constants';
import { conversation, memoryItem, message } from '../db/schema';
import { IdentityService } from '../identity/identity.service';
import { startOfUtcDay, startOfUtcMonth, UsageService } from '../observability/usage.service';
import { PlansService } from '../plans/plans.service';
import { WebResearchService } from '../research/web-research.service';

export type WebMode = 'off' | 'on' | 'auto';
const HISTORY_WINDOW = 30;
const isUniqueViolation = (e: unknown) => (e as { code?: string; cause?: { code?: string } })?.code === '23505' || (e as { cause?: { code?: string } })?.cause?.code === '23505';

@Injectable()
export class ChatService {
  private readonly logger = new Logger(ChatService.name);
  constructor(
    @Inject(DRIZZLE) private readonly db: any,
    private readonly conversations: ConversationsService,
    private readonly ai: AiOrchestratorService,
    private readonly plans: PlansService,
    private readonly identity: IdentityService,
    private readonly research: WebResearchService,
    private readonly usage: UsageService,
  ) {}

  /** Quota unit = a delivered assistant answer (a failed generation does not consume quota). UTC day/month. */
  private async enforceLimits(userId: string, plan: 'free' | 'plus' | 'pro') {
    const limits = this.plans.getLimits()[plan];
    const used = async (since: Date) => {
      const rows = await this.db.select({ value: count() }).from(message)
        .innerJoin(conversation, eq(message.conversationId, conversation.id))
        .where(and(eq(conversation.userId, userId), eq(message.role, 'assistant'), gte(message.createdAt, since)));
      return Number(rows[0]?.value ?? 0);
    };
    if ((await used(startOfUtcDay())) >= limits.dailyMessages) throw tooManyRequests('DAILY_MESSAGE_LIMIT', 'Limite quotidienne de messages atteinte.');
    if ((await used(startOfUtcMonth())) >= limits.monthlyMessages) throw tooManyRequests('MONTHLY_MESSAGE_LIMIT', 'Limite mensuelle de messages atteinte.');
  }

  private async findByRequest(conversationId: string, requestId: string, role: 'user' | 'assistant') {
    const [row] = await this.db.select().from(message)
      .where(and(eq(message.conversationId, conversationId), eq(message.requestId, requestId), eq(message.role, role))).limit(1);
    return row;
  }

  async send(userId: string, input: { conversationId?: string; content: string; requestId?: string; model?: AurexModelId; webSearch?: WebMode }, correlationId?: string) {
    const plan = await this.plans.getEffectivePlan(userId);
    const convo = input.conversationId
      ? await this.conversations.getOwned(userId, input.conversationId)
      : await this.conversations.create(userId, { title: input.content.slice(0, 70) });

    // Idempotent replay: same (conversation, requestId) already answered -> return it, no new provider call, no quota use.
    if (input.requestId) {
      const existing = await this.findByRequest(convo.id, input.requestId, 'assistant');
      if (existing) return { conversationId: convo.id, message: existing, provider: existing.provider, model: existing.model, webSearch: webSummaryFromRow(existing), idempotentReplay: true };
    }
    await this.enforceLimits(userId, plan);

    let userMessageId: string | undefined;
    const previous = input.requestId ? await this.findByRequest(convo.id, input.requestId, 'user') : undefined;
    if (previous) userMessageId = previous.id; // retry after a failed generation: reuse, do not duplicate
    else {
      userMessageId = newId();
      try {
        await this.db.insert(message).values({ id: userMessageId, conversationId: convo.id, role: 'user', content: input.content, requestId: input.requestId ?? null, createdAt: new Date() });
      } catch (error) {
        if (isUniqueViolation(error)) throw conflict('REQUEST_IN_PROGRESS', 'Cette requête est déjà en cours de traitement.');
        throw error;
      }
    }

    const rows = await this.db.select().from(message).where(eq(message.conversationId, convo.id)).orderBy(desc(message.createdAt)).limit(HISTORY_WINDOW);
    const history = rows.reverse().filter((m: any) => m.role === 'user' || m.role === 'assistant').map((m: any) => ({ role: m.role as 'user' | 'assistant', content: m.content as string }));

    const pinned = await this.db.select({ title: memoryItem.title, content: memoryItem.content }).from(memoryItem)
      .where(and(eq(memoryItem.userId, userId), eq(memoryItem.pinned, true))).orderBy(desc(memoryItem.updatedAt)).limit(10);

    const web = await this.research.chatContext(userId, input.content, input.webSearch ?? 'off', correlationId);
    const systemInstruction = this.identity.buildSystemInstruction({
      userMemory: pinned, conversation: { subject: convo.subject, title: convo.title },
      web: { requested: web.summary.requested, performed: web.summary.performed, failureCode: web.summary.failureCode, sourceCount: web.summary.sources.length },
    });
    // Web content is appended to the CURRENT user turn only for the model call; it is never persisted as user text.
    if (web.block && history.length) history[history.length - 1] = { role: 'user', content: `${history[history.length - 1].content}\n\n${web.block}` };

    const result = await this.ai.generate(plan, history, input.model, { systemInstruction });
    void this.usage.record({
      userId,
      kind: 'llm_call',
      provider: result.provider,
      units: result.tokens ?? 1,
      latencyMs: result.latencyMs,
      outcome: 'ok',
      requestId: input.requestId,
    });

    const assistant = {
      id: newId(), conversationId: convo.id, role: 'assistant' as const, content: result.text, provider: result.provider, model: result.model,
      latencyMs: result.latencyMs ?? null, tokenCount: result.tokens ?? null, requestId: input.requestId ?? null, createdAt: new Date(),
      sources: web.summary.performed ? { performed: true, queries: web.summary.queries, items: web.summary.sources } : web.summary.requested ? { performed: false, failureCode: web.summary.failureCode } : null,
    };
    try {
      await this.db.transaction(async (tx: any) => {
        await tx.insert(message).values(assistant);
        await tx.update(conversation).set({ updatedAt: new Date() }).where(eq(conversation.id, convo.id));
      });
    } catch (error) {
      if (input.requestId && isUniqueViolation(error)) {
        const existing = await this.findByRequest(convo.id, input.requestId, 'assistant');
        if (existing) return { conversationId: convo.id, message: existing, provider: existing.provider, model: existing.model, webSearch: webSummaryFromRow(existing), idempotentReplay: true };
      }
      throw error;
    }
    return { conversationId: convo.id, message: assistant, provider: result.provider, model: result.model, fallbackFrom: result.fallbackFrom, webSearch: web.summary };
  }
}

function webSummaryFromRow(row: any) {
  const s = row.sources as { performed?: boolean; queries?: string[]; items?: unknown[]; failureCode?: string } | null;
  if (!s) return { requested: false, performed: false, queries: [], sources: [] };
  return { requested: true, performed: !!s.performed, queries: s.queries ?? [], sources: s.items ?? [], failureCode: s.failureCode };
}
