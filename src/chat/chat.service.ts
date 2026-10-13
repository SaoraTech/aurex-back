import {
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
} from '@nestjs/common';
import { and, count, eq, gte } from 'drizzle-orm';
import { DRIZZLE } from '../db/db.constants';
import { conversation, message, subscription } from '../db/schema';
import { newId } from '../common/ids';
import { ConversationsService } from '../conversations/conversations.service';
import { AiOrchestratorService, AurexModelId } from '../ai/ai-orchestrator.service';
import { PlansService } from '../plans/plans.service';
import { AurexIdentity } from '../identity/aurex-identity';

@Injectable()
export class ChatService {
  constructor(
    @Inject(DRIZZLE) private readonly db: any,
    private readonly conversations: ConversationsService,
    private readonly ai: AiOrchestratorService,
    private readonly plans: PlansService,
  ) {}

  private async enforceDailyLimit(userId: string, plan: 'free' | 'plus' | 'pro') {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const rows = await this.db
      .select({ value: count() })
      .from(message)
      .innerJoin(conversation, eq(message.conversationId, conversation.id))
      .where(
        and(
          eq(conversation.userId, userId),
          eq(message.role, 'user'),
          gte(message.createdAt, start),
        ),
      );

    const used = Number(rows[0]?.value ?? 0);
    if (used >= this.plans.getLimits()[plan].dailyMessages) {
      throw new HttpException('Daily message limit reached', HttpStatus.TOO_MANY_REQUESTS);
    }
  }

  private async getEffectivePlan(userId: string): Promise<'free' | 'plus' | 'pro'> {
    const now = new Date();
    const rows = await this.db
      .select({ plan: subscription.plan })
      .from(subscription)
      .where(
        and(
          eq(subscription.userId, userId),
          eq(subscription.status, 'active'),
          gte(subscription.currentPeriodEnd, now),
        ),
      )
      .orderBy(subscription.updatedAt)
      .limit(1);

    const plan = rows[0]?.plan;
    return plan === 'plus' || plan === 'pro' ? plan : 'free';
  }

  async send(
    userId: string,
    input: {
      conversationId?: string;
      content: string;
      requestId?: string;
      model?: AurexModelId;
    },
  ) {
    const plan = await this.getEffectivePlan(userId);
    await this.enforceDailyLimit(userId, plan);

    let convo;
    if (input.conversationId) {
      convo = await this.conversations.getOwned(userId, input.conversationId);
    } else {
      convo = await this.conversations.create(userId, { title: input.content.slice(0, 70) });
    }

    if (input.requestId) {
      const [existing] = await this.db
        .select()
        .from(message)
        .where(eq(message.requestId, input.requestId))
        .limit(1);

      if (existing && existing.conversationId === convo.id && existing.role === 'assistant') {
        return { conversationId: convo.id, message: existing, idempotentReplay: true };
      }
    }

    const now = new Date();
    const userMessage = {
      id: newId(),
      conversationId: convo.id,
      role: 'user' as const,
      content: input.content,
      requestId: input.requestId ?? null,
      createdAt: now,
    };
    await this.db.insert(message).values(userMessage);

    const history = await this.conversations.getMessages(userId, convo.id);
    const aiMessages = history
      .filter((m: any) => m.role === 'user' || m.role === 'assistant')
      .slice(-30)
      .map((m: any) => ({ role: m.role, content: m.content }));

    // Injection de la source de vérité d'identité officielle d'Aurex
    const systemInstruction = AurexIdentity.buildSystemInstruction({
      configuredProviders: this.ai.listModels(plan).map(m => m.provider),
      activeCapabilities: {
        mathEngine: true,
        audioTts: true,
        audioStt: true,
        storage: true,
        memory: true,
        artifacts: true,
      },
    });

    const result = await this.ai.generate(plan, aiMessages, input.model, {
      systemInstruction,
    });

    const assistantMessage = {
      id: newId(),
      conversationId: convo.id,
      role: 'assistant' as const,
      content: result.text,
      provider: result.provider,
      requestId: input.requestId ?? null,
      createdAt: new Date(),
    };
    await this.db.insert(message).values(assistantMessage);
    await this.db
      .update(conversation)
      .set({ updatedAt: new Date() })
      .where(eq(conversation.id, convo.id));

    return {
      conversationId: convo.id,
      message: assistantMessage,
      provider: result.provider,
      model: result.model,
    };
  }
}
