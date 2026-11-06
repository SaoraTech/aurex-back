import { ChatService } from './chat.service';

describe('ChatService - Groq conversation, atomic quotas & idempotency', () => {
  let svc: ChatService;
  let mockDb: any;
  let mockConversations: any;
  let mockAi: any;
  let mockPlans: any;
  let mockQuotas: any;
  let mockIdentity: any;
  let mockResearch: any;
  let mockUsage: any;

  beforeEach(() => {
    mockDb = {
      select: jest.fn(() => ({
        from: jest.fn(() => ({
          where: jest.fn(() => ({
            limit: jest.fn().mockResolvedValue([]),
            orderBy: jest.fn(() => ({
              limit: jest.fn().mockResolvedValue([]),
            })),
          })),
          orderBy: jest.fn(() => ({
            limit: jest.fn().mockResolvedValue([]),
          })),
        })),
      })),
      insert: jest.fn(() => ({
        values: jest.fn().mockResolvedValue(undefined),
      })),
      update: jest.fn(() => ({
        set: jest.fn(() => ({
          where: jest.fn().mockResolvedValue(undefined),
        })),
      })),
      transaction: jest.fn(async (cb: (tx: any) => Promise<any>) => {
        const tx = {
          insert: jest.fn(() => ({ values: jest.fn().mockResolvedValue(undefined) })),
          update: jest.fn(() => ({ set: jest.fn(() => ({ where: jest.fn().mockResolvedValue(undefined) })) })),
        };
        return cb(tx);
      }),
    };

    mockConversations = {
      getOwned: jest.fn().mockResolvedValue({ id: 'convo_1', title: 'Test Conversation' }),
      create: jest.fn().mockResolvedValue({ id: 'convo_1', title: 'Test Conversation' }),
    };

    mockAi = {
      generate: jest.fn().mockResolvedValue({
        text: 'La dérivée de x^3 + 2x est expliquée sans vérification formelle.',
        provider: 'groq',
        model: 'openai/gpt-oss-120b',
        tokens: 35,
        latencyMs: 150,
      }),
    };

    mockPlans = {
      getEffectivePlan: jest.fn().mockResolvedValue('free'),
    };

    mockQuotas = {
      reserveQuota: jest.fn().mockResolvedValue({
        allowed: true,
        limit: 20,
        used: 1,
        remaining: 19,
        resetAt: new Date().toISOString(),
      }),
      commitQuota: jest.fn().mockResolvedValue(undefined),
      compensateQuota: jest.fn().mockResolvedValue(true),
    };

    mockIdentity = {
      buildSystemInstruction: jest.fn(() => 'INSTRUCTION_SYSTEME_AUREX'),
    };

    mockResearch = {
      chatContext: jest.fn().mockResolvedValue({
        summary: { requested: false, performed: false, queries: [], sources: [] },
      }),
    };

    mockUsage = {
      record: jest.fn().mockResolvedValue(undefined),
    };

    svc = new ChatService(
      mockDb,
      mockConversations,
      mockAi,
      mockPlans,
      mockQuotas,
      mockIdentity,
      mockResearch,
      mockUsage,
    );
  });

  it('handles mathematical prompts as ordinary Groq conversations without a deterministic math integration', async () => {
    const res = await svc.send('u1', {
      content: 'Calcule la dérivée de x^3 + 2x',
      requestId: 'req_math_prompt_plain_chat',
    });

    expect(mockAi.generate).toHaveBeenCalledWith(
      'free',
      expect.any(Array),
      undefined,
      expect.objectContaining({
        systemInstruction: 'INSTRUCTION_SYSTEME_AUREX',
      }),
    );
    expect(mockQuotas.reserveQuota).toHaveBeenCalledTimes(1);
    expect(mockQuotas.reserveQuota.mock.calls[0][1]).toBe('daily_messages');
    expect(res.message.content).toContain('dérivée');
    expect(res).not.toHaveProperty('mathComputation');
  });

  it('rejects message with 429 when daily quota is exhausted', async () => {
    mockQuotas.reserveQuota.mockResolvedValue({
      allowed: false,
      errorCode: 'FEATURE_LIMIT_REACHED',
      errorMessage: 'Limite de messages atteinte.',
      limit: 20,
      used: 20,
      remaining: 0,
      resetAt: new Date().toISOString(),
      retryAfterSeconds: 3600,
    });

    await expect(
      svc.send('u1', { content: 'Bonjour Aurex', requestId: 'req_quota_exceeded' }),
    ).rejects.toMatchObject({
      status: 429,
    });

    expect(mockAi.generate).not.toHaveBeenCalled();
  });

  it('compensates reserved message quota when Groq generation fails', async () => {
    mockAi.generate.mockRejectedValue(new Error('Groq 500 Internal Error'));

    await expect(
      svc.send('u1', { content: 'Explique le théorème de Bayes', requestId: 'req_groq_fail' }),
    ).rejects.toThrow('Groq 500 Internal Error');

    expect(mockQuotas.compensateQuota).toHaveBeenCalledWith(expect.any(String));
  });

  it('returns idempotent replay when requestId already has an assistant answer', async () => {
    mockDb.select.mockReturnValue({
      from: jest.fn(() => ({
        where: jest.fn(() => ({
          limit: jest.fn().mockResolvedValue([
            {
              id: 'msg_existing_1',
              conversationId: 'convo_1',
              role: 'assistant',
              content: 'Réponse déjà enregistrée',
              provider: 'groq',
              model: 'openai/gpt-oss-120b',
              requestId: 'req_idem_1',
            },
          ]),
        })),
      })),
    });

    const res = await svc.send('u1', {
      conversationId: 'convo_1',
      content: 'Question déjà posée',
      requestId: 'req_idem_1',
    });

    expect(res.idempotentReplay).toBe(true);
    expect(res.message.content).toBe('Réponse déjà enregistrée');
    expect(mockQuotas.reserveQuota).not.toHaveBeenCalled();
    expect(mockAi.generate).not.toHaveBeenCalled();
  });

  it('persists streamed partial output when generation is interrupted', async () => {
    const deltas: string[] = [];
    mockAi.generate.mockImplementation(async (_plan: any, _history: any, _model: any, options: any) => {
      options.onToken?.('Réponse partielle');
      throw new Error('Generation cancelled');
    });

    await expect(svc.send(
      'u1',
      { content: 'Explique les limites', requestId: 'req_stream_partial' },
      'corr_stream_partial',
      { onToken: (delta) => deltas.push(delta) },
    )).rejects.toThrow('Generation cancelled');

    expect(deltas).toEqual(['Réponse partielle']);
    expect(mockDb.insert).toHaveBeenCalledTimes(2);
    expect(mockQuotas.compensateQuota).toHaveBeenCalledWith(expect.any(String));
  });

  it('uses a fresh quota operation for a retry with the same client request id', async () => {
    mockAi.generate.mockRejectedValueOnce(new Error('Temporary Groq failure'));
    await expect(svc.send('u1', { content: 'Réessaie cette réponse', requestId: 'req_retry_same' })).rejects.toThrow('Temporary Groq failure');

    mockAi.generate.mockResolvedValueOnce({
      text: 'Réponse rétablie',
      provider: 'groq',
      model: 'openai/gpt-oss-120b',
      tokens: 12,
      latencyMs: 80,
    });
    const result = await svc.send('u1', { content: 'Réessaie cette réponse', requestId: 'req_retry_same' });

    expect(result.message.content).toBe('Réponse rétablie');
    expect(mockQuotas.reserveQuota).toHaveBeenCalledTimes(2);
    expect(mockQuotas.reserveQuota.mock.calls[0][3]).not.toBe(mockQuotas.reserveQuota.mock.calls[1][3]);
  });
});
