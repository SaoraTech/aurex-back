import { ChatService } from './chat.service';

describe('ChatService - Groq & SageMath Orchestration, Atomic Quotas & Idempotency', () => {
  let svc: ChatService;
  let mockDb: any;
  let mockConversations: any;
  let mockAi: any;
  let mockPlans: any;
  let mockQuotas: any;
  let mockIdentity: any;
  let mockResearch: any;
  let mockMath: any;
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
        text: 'La dérivée de x^3 + 2x est 3x^2 + 2.',
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

    mockMath = {
      detectAndSolve: jest.fn(),
      compute: jest.fn(),
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
      mockMath,
      mockUsage,
    );
  });

  it('orchestrates authentic SageMath computation when a mathematical question is asked', async () => {
    mockMath.detectAndSolve.mockReturnValue({
      operation: 'derivative',
      expression: 'x^3 + 2x',
      variable: 'x',
    });

    mockMath.compute.mockResolvedValue({
      engine: 'sagemath',
      status: 'verified',
      latex: '3x^2 + 2',
      plainText: '3*x^2 + 2',
      steps: ["(x^3)' = 3x^2", "(2x)' = 2"],
      computationTimeMs: 45,
    });

    const res = await svc.send('u1', {
      content: 'Calcule la dérivée de x^3 + 2x',
      requestId: 'req_math_1',
    });

    expect(mockMath.detectAndSolve).toHaveBeenCalledWith('Calcule la dérivée de x^3 + 2x');
    expect(mockMath.compute).toHaveBeenCalledWith('u1', expect.objectContaining({ operation: 'derivative' }), 'req_math_1');
    expect(mockAi.generate).toHaveBeenCalledWith(
      'free',
      expect.any(Array),
      undefined,
      expect.objectContaining({
        systemInstruction: expect.stringContaining('[CALCUL VÉRIFIÉ PAR LE MOTEUR SAGEMATH]'),
      }),
    );
    expect(res.mathComputation).toMatchObject({
      operation: 'derivative',
      verified: true,
      latex: '3x^2 + 2',
    });
    expect(mockQuotas.commitQuota).toHaveBeenCalled();
  });

  it('informs Groq transparently when SageMath is unavailable without inventing fake verified status', async () => {
    mockMath.detectAndSolve.mockReturnValue({
      operation: 'factor',
      expression: 'x^4 - 16',
      variable: 'x',
    });

    mockMath.compute.mockResolvedValue({
      engine: 'sagemath',
      status: 'failed',
      errorCode: 'UNAVAILABLE',
      error: 'SageMath service unreachable',
      computationTimeMs: 20,
    });

    const res = await svc.send('u1', {
      content: 'factorise x^4 - 16',
      requestId: 'req_math_2',
    });

    expect(mockAi.generate).toHaveBeenCalledWith(
      'free',
      expect.any(Array),
      undefined,
      expect.objectContaining({
        systemInstruction: expect.stringContaining('[NOTE SAGEMATH : MOTEUR INDISPONIBLE OU NON CONFIGURÉ]'),
      }),
    );
    expect(res.mathComputation).toMatchObject({
      verified: false,
    });
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

    expect(mockQuotas.compensateQuota).toHaveBeenCalledWith('req_groq_fail');
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
});
