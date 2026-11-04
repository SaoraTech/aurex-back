import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, desc, eq } from 'drizzle-orm';
import { AiOrchestratorService } from '../ai/ai-orchestrator.service';
import { AurexModelId } from '../ai/ai.types';
import { AppException, conflict } from '../common/errors';
import { newId } from '../common/ids';
import { ConversationsService } from '../conversations/conversations.service';
import { DRIZZLE } from '../db/db.constants';
import { conversation, memoryItem, message } from '../db/schema';
import { IdentityService } from '../identity/identity.service';
import { MathService } from '../math/math.service';
import { UsageService } from '../observability/usage.service';
import { PlanName, PlansService } from '../plans/plans.service';
import { QuotasService } from '../quotas/quotas.service';
import { WebResearchService } from '../research/web-research.service';

export type WebMode = 'off' | 'on' | 'auto';

const HISTORY_WINDOW = 30;
const isUniqueViolation = (e: unknown) =>
  (e as { code?: string; cause?: { code?: string } })?.code === '23505' ||
  (e as { cause?: { code?: string } })?.cause?.code === '23505';

@Injectable()
export class ChatService {
  private readonly logger = new Logger(ChatService.name);

  constructor(
    @Inject(DRIZZLE) private readonly db: any,
    private readonly conversations: ConversationsService,
    private readonly ai: AiOrchestratorService,
    private readonly plans: PlansService,
    private readonly quotas: QuotasService,
    private readonly identity: IdentityService,
    private readonly research: WebResearchService,
    private readonly math: MathService,
    private readonly usage: UsageService,
  ) {}

  private async findByRequest(
    conversationId: string,
    requestId: string,
    role: 'user' | 'assistant',
  ) {
    const [row] = await this.db
      .select()
      .from(message)
      .where(
        and(
          eq(message.conversationId, conversationId),
          eq(message.requestId, requestId),
          eq(message.role, role),
        ),
      )
      .limit(1);
    return row;
  }

  async send(
    userId: string,
    input: {
      conversationId?: string;
      content: string;
      requestId?: string;
      model?: AurexModelId;
      webSearch?: WebMode;
    },
    correlationId?: string,
  ) {
    const plan = await this.plans.getEffectivePlan(userId);
    const convo = input.conversationId
      ? await this.conversations.getOwned(userId, input.conversationId)
      : await this.conversations.create(userId, {
          title: input.content.slice(0, 70),
        });

    // 1. Idempotent replay check: already answered -> return existing result without new provider call or quota use
    if (input.requestId) {
      const existing = await this.findByRequest(
        convo.id,
        input.requestId,
        'assistant',
      );
      if (existing) {
        return {
          conversationId: convo.id,
          message: existing,
          provider: existing.provider,
          model: existing.model,
          webSearch: webSummaryFromRow(existing),
          mathComputation: existing.mathResult
            ? {
                input: existing.mathInput,
                result: existing.mathResult,
                latex: existing.computation,
              }
            : null,
          idempotentReplay: true,
        };
      }
    }

    // 2. Atomic Quota Reservation: Reserve 1 message slot atomically
    const opId = input.requestId ?? newId();
    const quotaRes = await this.quotas.reserveQuota(
      userId,
      'daily_messages',
      plan,
      opId,
    );
    if (!quotaRes.allowed) {
      throw new AppException(
        429,
        quotaRes.errorCode ?? 'DAILY_MESSAGE_LIMIT',
        quotaRes.errorMessage ?? 'Limite quotidienne de messages atteinte.',
        {
          limit: quotaRes.limit,
          used: quotaRes.used,
          remaining: quotaRes.remaining,
          resetAt: quotaRes.resetAt,
          retryAfterSeconds: quotaRes.retryAfterSeconds,
        },
        quotaRes.retryAfterSeconds,
      );
    }

    let userMessageId: string | undefined;
    const previous = input.requestId
      ? await this.findByRequest(convo.id, input.requestId, 'user')
      : undefined;

    if (previous) {
      userMessageId = previous.id; // Retry after failed generation: reuse user message
    } else {
      userMessageId = newId();
      try {
        await this.db.insert(message).values({
          id: userMessageId,
          conversationId: convo.id,
          role: 'user',
          content: input.content,
          requestId: input.requestId ?? null,
          createdAt: new Date(),
        });
      } catch (error) {
        // Compensate reserved quota slot if user message insert fails
        await this.quotas.compensateQuota(opId);
        if (isUniqueViolation(error)) {
          throw conflict(
            'REQUEST_IN_PROGRESS',
            'Cette requête est déjà en cours de traitement.',
          );
        }
        throw error;
      }
    }

    try {
      // 3. Load conversation history & pinned memories
      const rows = await this.db
        .select()
        .from(message)
        .where(eq(message.conversationId, convo.id))
        .orderBy(desc(message.createdAt))
        .limit(HISTORY_WINDOW);

      const history = rows
        .reverse()
        .filter((m: any) => m.role === 'user' || m.role === 'assistant')
        .map((m: any) => ({
          role: m.role as 'user' | 'assistant',
          content: m.content as string,
        }));

      const pinned = await this.db
        .select({ title: memoryItem.title, content: memoryItem.content })
        .from(memoryItem)
        .where(and(eq(memoryItem.userId, userId), eq(memoryItem.pinned, true)))
        .orderBy(desc(memoryItem.updatedAt))
        .limit(10);

      // 4. Orchestration with SageMath (Mathematical Intent Detection & Exact Verification)
      let mathData: {
        operation: string;
        expression: string;
        latex?: string;
        plainText?: string;
        steps?: string[];
        verified: boolean;
        error?: string;
      } | null = null;

      const detectedMath = this.math.detectAndSolve(input.content);
      if (detectedMath) {
        this.logger.log({
          msg: 'math_intent_detected',
          operation: detectedMath.operation,
          expression: detectedMath.expression,
        });

        // Reserve math quota atomically
        const mathOpId = newId();
        const mathQuota = await this.quotas.reserveQuota(
          userId,
          'math_compute',
          plan,
          mathOpId,
        );

        if (mathQuota.allowed) {
          try {
            const mathResult = await this.math.compute(
              userId,
              detectedMath,
              input.requestId,
            );
            if (mathResult.status === 'verified') {
              mathData = {
                operation: detectedMath.operation,
                expression: detectedMath.expression,
                latex: mathResult.latex,
                plainText: mathResult.plainText,
                steps: mathResult.steps,
                verified: true,
              };
              await this.quotas.commitQuota(mathOpId);
            } else {
              mathData = {
                operation: detectedMath.operation,
                expression: detectedMath.expression,
                verified: false,
                error: mathResult.error ?? 'Calcul non vérifié par SageMath',
              };
              // Don't charge quota for unverified/failed calculation
              await this.quotas.compensateQuota(mathOpId);
            }
          } catch (err: any) {
            await this.quotas.compensateQuota(mathOpId);
            mathData = {
              operation: detectedMath.operation,
              expression: detectedMath.expression,
              verified: false,
              error: err.message ?? 'Service de calcul SageMath indisponible',
            };
          }
        } else {
          mathData = {
            operation: detectedMath.operation,
            expression: detectedMath.expression,
            verified: false,
            error: 'Quota quotidien de calcul SageMath atteint pour ce plan',
          };
        }
      }

      // 5. Web Search Research Context
      const web = await this.research.chatContext(
        userId,
        input.content,
        input.webSearch ?? 'off',
        correlationId,
      );

      // 6. Construct System Instruction with Math Verification & Web Context
      let mathInstruction = '';
      if (mathData) {
        if (mathData.verified) {
          mathInstruction = `\n\n[CALCUL VÉRIFIÉ PAR LE MOTEUR SAGEMATH]
Opération : ${mathData.operation}
Expression : ${mathData.expression}
Résultat exact : ${mathData.plainText ?? mathData.latex}
${mathData.latex ? `LaTeX : ${mathData.latex}` : ''}
${mathData.steps?.length ? `Étapes de calcul : ${mathData.steps.join(' -> ')}` : ''}
INSTRUCTION STRICTE : Le calcul exact ci-dessus a été formellement calculé et vérifié par le moteur SageMath. Tu DOIS impérativement t'appuyer sur cette valeur exacte dans ton explication pédagogique en français, sans modifier le résultat mathématique.`;
        } else {
          mathInstruction = `\n\n[NOTE SAGEMATH : MOTEUR INDISPONIBLE OU NON CONFIGURÉ]
Opération détectée : ${mathData.operation}
Expression : ${mathData.expression}
Raison : ${mathData.error}
INSTRUCTION STRICTE : Le moteur SageMath n'a pas pu vérifier ce calcul exact (${mathData.error}). Tu DOIS obligatoirement indiquer avec transparence à l'utilisateur que le calcul formel n'a pas pu être formellement vérifié par le moteur officiel SageMath, tout en lui fournissant la méthode et la démarche de résolution pas à pas. Ne prétends JAMAIS que le résultat a été vérifié.`;
        }
      }

      const systemInstruction =
        this.identity.buildSystemInstruction({
          userMemory: pinned,
          conversation: { subject: convo.subject, title: convo.title },
          web: {
            requested: web.summary.requested,
            performed: web.summary.performed,
            failureCode: web.summary.failureCode,
            sourceCount: web.summary.sources.length,
          },
        }) + mathInstruction;

      // Web content is appended to CURRENT user turn for the model call only
      if (web.block && history.length) {
        history[history.length - 1] = {
          role: 'user',
          content: `${history[history.length - 1].content}\n\n${web.block}`,
        };
      }

      // 7. Call Groq LLM
      const result = await this.ai.generate(plan, history, input.model, {
        systemInstruction,
      });

      // 8. Commit reserved message quota slot (only on successful completion!)
      await this.quotas.commitQuota(opId);

      // Record LLM usage
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
        id: newId(),
        conversationId: convo.id,
        role: 'assistant' as const,
        content: result.text,
        mathInput: mathData ? JSON.stringify(mathData.expression) : null,
        mathResult: mathData?.plainText ?? null,
        computation: mathData?.latex ?? null,
        provider: result.provider,
        model: result.model,
        latencyMs: result.latencyMs ?? null,
        tokenCount: result.tokens ?? null,
        requestId: input.requestId ?? null,
        createdAt: new Date(),
        sources: web.summary.performed
          ? {
              performed: true,
              queries: web.summary.queries,
              items: web.summary.sources,
            }
          : web.summary.requested
            ? { performed: false, failureCode: web.summary.failureCode }
            : null,
      };

      try {
        await this.db.transaction(async (tx: any) => {
          await tx.insert(message).values(assistant);
          await tx
            .update(conversation)
            .set({ updatedAt: new Date() })
            .where(eq(conversation.id, convo.id));
        });
      } catch (error) {
        if (input.requestId && isUniqueViolation(error)) {
          const existing = await this.findByRequest(
            convo.id,
            input.requestId,
            'assistant',
          );
          if (existing) {
            return {
              conversationId: convo.id,
              message: existing,
              provider: existing.provider,
              model: existing.model,
              webSearch: webSummaryFromRow(existing),
              mathComputation: mathData,
              idempotentReplay: true,
            };
          }
        }
        throw error;
      }

      return {
        conversationId: convo.id,
        message: assistant,
        provider: result.provider,
        model: result.model,
        webSearch: web.summary,
        mathComputation: mathData,
      };
    } catch (err) {
      // Compensate reserved message quota on generation failure
      await this.quotas.compensateQuota(opId);
      throw err;
    }
  }
}

function webSummaryFromRow(row: any) {
  const s = row.sources as {
    performed?: boolean;
    queries?: string[];
    items?: unknown[];
    failureCode?: string;
  } | null;
  if (!s) return { requested: false, performed: false, queries: [], sources: [] };
  return {
    requested: true,
    performed: !!s.performed,
    queries: s.queries ?? [],
    sources: s.items ?? [],
    failureCode: s.failureCode,
  };
}
