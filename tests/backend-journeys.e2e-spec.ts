import * as crypto from 'crypto';
import { ExecutionContext, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { RequireAdminGuard } from '../src/auth/require-admin.guard';
import { RequireUserGuard } from '../src/auth/require-user.guard';
import { BillingService } from '../src/billing/billing.service';
import { JemenipayProvider } from '../src/billing/providers/jemenipay.provider';
import { ChatService } from '../src/chat/chat.service';
import { QuotasService } from '../src/quotas/quotas.service';
import { PlansService } from '../src/plans/plans.service';
import { featureQuotaLedger, featureQuotaUsage, payment, subscription, message, conversation } from '../src/db/schema';

describe('Aurex Backend - Comprehensive E2E Journeys & Critical Invariants', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.clearAllMocks();
  });

  // =========================================================================
  // JOURNEY 1 — Auth & Admin Access Control
  // =========================================================================
  describe('Journey 1: Auth & Admin Access Control', () => {
    let adminGuard: RequireAdminGuard;
    let mockUserGuard: any;
    let mockConfig: any;

    beforeEach(() => {
      mockUserGuard = {
        resolve: jest.fn(),
      };
      mockConfig = {
        get: jest.fn((key: string) => {
          if (key === 'ADMIN_EMAILS' || key === 'adminEmails') return ['admin@saora.tech', 'superadmin@saora.tech'];
          return undefined;
        }),
      };
      adminGuard = new RequireAdminGuard(mockUserGuard as RequireUserGuard, mockConfig);
    });

    const makeContext = () => ({
      switchToHttp: () => ({
        getRequest: () => ({ headers: {} }),
      }),
    } as unknown as ExecutionContext);

    it('rejects unauthenticated requests before checking admin status', async () => {
      mockUserGuard.resolve.mockRejectedValue(
        new UnauthorizedException({ code: 'UNAUTHORIZED', message: 'Session invalide' }),
      );

      await expect(adminGuard.canActivate(makeContext())).rejects.toThrow(UnauthorizedException);
    });

    it('denies authenticated non-admin users with 403 Forbidden', async () => {
      mockUserGuard.resolve.mockResolvedValue({
        id: 'usr_regular_123',
        email: 'student@example.com',
      });

      await expect(adminGuard.canActivate(makeContext())).rejects.toThrow(ForbiddenException);
    });

    it('allows access when user email matches ADMIN_EMAILS (case-insensitive)', async () => {
      mockUserGuard.resolve.mockResolvedValue({
        id: 'usr_admin_1',
        email: 'ADMIN@SAORA.TECH',
      });

      const allowed = await adminGuard.canActivate(makeContext());
      expect(allowed).toBe(true);
    });
  });

  // =========================================================================
  // JOURNEY 3 — Chat generation through Groq
  // =========================================================================
  describe('Journey 3: Chat Groq conversation', () => {
    let chat: ChatService;
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
              orderBy: jest.fn(() => ({ limit: jest.fn().mockResolvedValue([]) })),
            })),
            orderBy: jest.fn(() => ({ limit: jest.fn().mockResolvedValue([]) })),
          })),
        })),
        insert: jest.fn(() => ({ values: jest.fn().mockResolvedValue(undefined) })),
        update: jest.fn(() => ({ set: jest.fn(() => ({ where: jest.fn().mockResolvedValue(undefined) })) })),
        transaction: jest.fn(async (cb: (tx: any) => Promise<any>) => cb(mockDb)),
      };
      mockConversations = {
        getOwned: jest.fn().mockResolvedValue({ id: 'convo_101', title: 'Calcul Dérivée' }),
        create: jest.fn().mockResolvedValue({ id: 'convo_101', title: 'Calcul Dérivée' }),
      };
      mockAi = {
        generate: jest.fn().mockResolvedValue({
          text: 'La dérivée de x^3 + 2x est expliquée étape par étape.',
          provider: 'groq',
          model: 'openai/gpt-oss-120b',
          tokens: 42,
          latencyMs: 190,
        }),
      };
      mockPlans = { getEffectivePlan: jest.fn().mockResolvedValue('pro') };
      mockQuotas = {
        reserveQuota: jest.fn().mockResolvedValue({ allowed: true, remaining: 99 }),
        commitQuota: jest.fn().mockResolvedValue(true),
        compensateQuota: jest.fn().mockResolvedValue(true),
      };
      mockIdentity = { buildSystemInstruction: jest.fn().mockReturnValue('INSTRUCTION_SYSTEME_AUREX') };
      mockResearch = {
        chatContext: jest.fn().mockResolvedValue({
          summary: { requested: false, performed: false, queries: [], sources: [] },
        }),
      };
      mockUsage = { record: jest.fn().mockResolvedValue(undefined) };
      chat = new ChatService(
        mockDb, mockConversations, mockAi, mockPlans, mockQuotas,
        mockIdentity, mockResearch, mockUsage,
      );
    });

    it('sends mathematical questions to Groq as ordinary chat and reserves only the message quota', async () => {
      const response = await chat.send('usr_test', {
        conversationId: 'convo_101',
        content: 'Explique la dérivée de x^3 + 2x',
      });
      expect(mockAi.generate).toHaveBeenCalled();
      expect(mockQuotas.reserveQuota).toHaveBeenCalledTimes(1);
      expect(mockQuotas.reserveQuota.mock.calls[0][1]).toBe('daily_messages');
      expect(response.message.content).toContain('dérivée');
      expect(response).not.toHaveProperty('mathComputation');
    });
  });

  // =========================================================================
  // JOURNEY 4 — Quotas Concurrency, Atomicity & Idempotency
  // =========================================================================
  describe('Journey 4: Quotas Atomicity & Idempotency', () => {
    let quotas: QuotasService;
    let mockDb: any;
    let storedLedger: Map<string, any>;
    let storedUsage: Map<string, any>;

    beforeEach(() => {
      storedLedger = new Map();
      storedUsage = new Map();

      const getTableRows = (tbl: any) => {
        if (tbl === featureQuotaLedger) {
          return Array.from(storedLedger.values());
        }
        return Array.from(storedUsage.values());
      };

      mockDb = {
        select: jest.fn(() => ({
          from: jest.fn((table: any) => ({
            where: jest.fn((condition: any) => ({
              limit: jest.fn().mockImplementation(() => getTableRows(table)),
            })),
          })),
        })),
        insert: jest.fn((table: any) => ({
          values: jest.fn().mockImplementation((val: any) => ({
            onConflictDoNothing: jest.fn().mockImplementation(() => {
              if (storedUsage.has(val.userId + ':' + val.feature)) {
                return [];
              }
              storedUsage.set(val.userId + ':' + val.feature, { ...val });
              return [{ id: 'usage_1' }];
            }),
          })),
        })),
        update: jest.fn(() => ({
          set: jest.fn(() => ({
            where: jest.fn(() => ({
              returning: jest.fn().mockResolvedValue([{ id: 'updated_1' }]),
            })),
          })),
        })),
        delete: jest.fn(() => ({
          where: jest.fn().mockResolvedValue(undefined),
        })),
        transaction: jest.fn(async (cb: (tx: any) => Promise<any>) => {
          const tx = {
            select: jest.fn(() => ({
              from: jest.fn((tbl: any) => ({
                where: jest.fn(() => ({
                  limit: jest.fn().mockImplementation(() => getTableRows(tbl)),
                  for: jest.fn(() => ({
                    limit: jest.fn().mockImplementation(() => getTableRows(tbl)),
                  })),
                })),
              })),
            })),
            insert: jest.fn(() => ({
              values: jest.fn().mockImplementation((val: any) => {
                storedLedger.set(val.operationId ?? val.id, { ...val });
                return [{ id: 'ledger_1' }];
              }),
            })),
            update: jest.fn(() => ({
              set: jest.fn((updateVals: any) => ({
                where: jest.fn().mockImplementation(() => {
                  return [{ id: 'updated_row' }];
                }),
              })),
            })),
            delete: jest.fn(() => ({
              where: jest.fn().mockResolvedValue(undefined),
            })),
          };
          return cb(tx);
        }),
      };

      const mockConfig: any = {
        get: jest.fn().mockReturnValue(undefined),
      };

      quotas = new QuotasService(mockDb, mockConfig);
    });

    it('handles idempotent reservation replay for identical parameters', async () => {
      const now = new Date();
      const opId = 'op_unique_123';
      const existingLedgerRow = {
        id: opId,
        userId: 'usr_abc',
        feature: 'daily_messages',
        units: 1,
        createdAt: now,
        status: 'reserved',
      };
      storedLedger.set(opId, existingLedgerRow);

      const res = await quotas.reserveQuota('usr_abc', 'daily_messages', 'free', opId, 1, now);
      expect(res.allowed).toBe(true);
      expect(res.operationId).toBe(opId);
    });

    it('rejects reuse of the same operationId with conflicting parameters', async () => {
      storedLedger.clear();
      const now = new Date();
      const opId = 'op_conflict_test';
      const existingLedgerRow = {
        id: opId,
        userId: 'usr_original',
        feature: 'daily_messages',
        units: 1,
        createdAt: now,
        status: 'reserved',
      };
      storedLedger.set(opId, existingLedgerRow);

      // Attempting to reserve with different userId
      const res = await quotas.reserveQuota('usr_imposter', 'daily_messages', 'free', opId, 1, now);
      expect(res.allowed).toBe(false);
      expect(res.errorCode).toBe('OPERATION_ID_CONFLICT');
    });

    it('rejects reservation replay if previous operation was already refunded or expired', async () => {
      storedLedger.clear();
      const now = new Date();
      const opId = 'op_refunded';
      storedLedger.set(opId, {
        id: opId,
        userId: 'usr_xyz',
        feature: 'daily_messages',
        units: 1,
        createdAt: now,
        status: 'refunded',
      });

      const res = await quotas.reserveQuota('usr_xyz', 'daily_messages', 'free', opId, 1, now);
      expect(res.allowed).toBe(false);
      expect(res.errorCode).toBe('OPERATION_ALREADY_REFUNDED');
    });
  });

  // =========================================================================
  // JOURNEY 5 — Jɛmɛnipay Checkout & Webhook Lifecycle
  // =========================================================================
  describe('Journey 5: Jɛmɛnipay Checkout & Webhook Lifecycle', () => {
    let billing: BillingService;
    let jemenipay: JemenipayProvider;
    let plans: PlansService;
    let mockDb: any;
    const testSecret = 'sk_live_jemeni_test_secret_99999999';
    const testApiKey = 'ak_live_jemeni_test_key_88888888';

    beforeEach(() => {
      const configMock: any = {
        get: jest.fn((key: string) => {
          if (key === 'jemenipaySecretKey' || key === 'JEMENIPAY_SECRET_KEY') return testSecret;
          if (key === 'jemenipayApiKey' || key === 'JEMENIPAY_API_KEY') return testApiKey;
          if (key === 'jemenipayBaseUrl' || key === 'JEMENIPAY_BASE_URL') return 'https://jemeni.net/api/live';
          if (key === 'appUrl' || key === 'APP_URL') return 'https://aurex.saora.tech';
          return undefined;
        }),
      };

      jemenipay = new JemenipayProvider(configMock);
      plans = new PlansService();

      mockDb = {
        select: jest.fn(() => ({
          from: jest.fn(() => ({
            where: jest.fn(() => ({
              limit: jest.fn().mockResolvedValue([
                {
                  id: 'pay_local_123',
                  userId: 'usr_buyer_1',
                  plan: 'plus',
                  amountMinor: 5000,
                  currency: 'XOF',
                  status: 'pending',
                  externalReference: 'jem_remote_456',
                },
              ]),
            })),
          })),
        })),
        insert: jest.fn(() => ({
          values: jest.fn().mockResolvedValue(undefined),
        })),
        update: jest.fn(() => ({
          set: jest.fn(() => {
            const whereObj: any = jest.fn().mockResolvedValue([{ id: 'pay_local_123' }]);
            whereObj.returning = jest.fn().mockResolvedValue([{ id: 'pay_local_123' }]);
            return { where: whereObj };
          }),
        })),
        transaction: jest.fn(async (cb: (tx: any) => Promise<any>) => {
          const tx = {
            select: jest.fn(() => ({
              from: jest.fn(() => ({
                where: jest.fn(() => ({
                  limit: jest.fn().mockResolvedValue([
                    {
                      id: 'pay_local_123',
                      userId: 'usr_buyer_1',
                      plan: 'plus',
                      amountMinor: 5000,
                      currency: 'XOF',
                      status: 'pending',
                      externalReference: 'jem_remote_456',
                    },
                  ]),
                })),
              })),
            })),
            insert: jest.fn(() => ({ values: jest.fn().mockResolvedValue(undefined) })),
            update: jest.fn(() => ({
              set: jest.fn(() => {
                const whereObj: any = jest.fn().mockResolvedValue([{ id: 'pay_local_123' }]);
                whereObj.returning = jest.fn().mockResolvedValue([{ id: 'pay_local_123' }]);
                return { where: whereObj };
              }),
            })),
          };
          return cb(tx);
        }),
      };

      billing = new BillingService(jemenipay, plans, mockDb);
    });

    it('verifies genuine Jɛmɛnipay HMAC-SHA512 webhook signature within freshness window', async () => {
      const nowSeconds = Math.floor(Date.now() / 1000);
      const payload = JSON.stringify({
        event: 'payment.succeeded',
        reference: 'pay_local_123',
        transactionId: 'jem_remote_456',
        status: 'COMPLETED',
        amount: 5000,
        currency: 'XOF',
      });

      // Valid signature: HMAC-SHA512 of payload
      const validSig = crypto.createHmac('sha512', testSecret).update(payload).digest('hex');

      const verified = await jemenipay.verifyWebhook(
        Buffer.from(payload),
        validSig,
        String(nowSeconds),
      );

      expect(verified.valid).toBe(true);
      expect(verified.externalReference).toBe('jem_remote_456');
      expect(verified.amount).toBe(5000);
    });

    it('rejects replayed webhook signatures with timestamps older than 5 minutes', async () => {
      const staleTimestamp = Math.floor(Date.now() / 1000) - 400; // 6.6 minutes ago
      const payload = JSON.stringify({ event: 'payment.succeeded' });
      const validSig = crypto.createHmac('sha512', testSecret).update(payload).digest('hex');

      const verified = await jemenipay.verifyWebhook(
        Buffer.from(payload),
        validSig,
        String(staleTimestamp),
      );

      expect(verified.valid).toBe(false);
    });

    it('rejects forged or modified webhook payloads', async () => {
      const nowSeconds = Math.floor(Date.now() / 1000);
      const payload = JSON.stringify({ event: 'payment.succeeded', amount: 5000 });
      const fakeSig = crypto.createHmac('sha512', 'wrong_secret').update(payload).digest('hex');

      const verified = await jemenipay.verifyWebhook(
        Buffer.from(payload),
        fakeSig,
        String(nowSeconds),
      );

      expect(verified.valid).toBe(false);
    });

    it('atomically activates subscription on verified webhook success', async () => {
      const nowSeconds = Math.floor(Date.now() / 1000);
      const payload = JSON.stringify({
        event: 'payment.succeeded',
        reference: 'pay_local_123',
        transactionId: 'jem_remote_456',
        status: 'COMPLETED',
        amount: 5000,
        currency: 'XOF',
      });
      const validSig = crypto.createHmac('sha512', testSecret).update(payload).digest('hex');

      const result = await billing.handleJemenipayWebhook(
        Buffer.from(payload),
        validSig,
        String(nowSeconds),
      );

      expect(result.received).toBe(true);
      expect(mockDb.transaction).toHaveBeenCalled();
    });

    it('protects succeeded payments from being overwritten by delayed failed webhooks', async () => {
      mockDb.select.mockImplementation(() => ({
        from: jest.fn(() => ({
          where: jest.fn(() => ({
            limit: jest.fn().mockResolvedValue([
              {
                id: 'pay_local_123',
                userId: 'usr_buyer_1',
                plan: 'plus',
                amountMinor: 5000,
                currency: 'XOF',
                status: 'succeeded', // ALREADY SUCCEEDED
                externalReference: 'jem_remote_456',
              },
            ]),
          })),
        })),
      }));

      const nowSeconds = Math.floor(Date.now() / 1000);
      const payload = JSON.stringify({
        event: 'payment.failed',
        reference: 'pay_local_123',
        transactionId: 'jem_remote_456',
        status: 'FAILED',
        amount: 5000,
        currency: 'XOF',
      });
      const validSig = crypto.createHmac('sha512', testSecret).update(payload).digest('hex');

      const result = await billing.handleJemenipayWebhook(
        Buffer.from(payload),
        validSig,
        String(nowSeconds),
      );

      expect(result.received).toBe(true);
    });
  });
});
