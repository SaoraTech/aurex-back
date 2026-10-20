import { ConfigService } from '@nestjs/config';
import { QuotasService } from './quotas.service';

describe('QuotasService', () => {
  let service: QuotasService;
  let usageTable: Map<string, { used_count: number; limit: number }>;
  let ledgerTable: Map<string, { status: string; userId: string; feature: string; createdAt: Date }>;
  let blockTable: Map<string, { blockedUntil: Date; violationCount: number; lastViolationAt: Date }>;

  beforeEach(() => {
    usageTable = new Map();
    ledgerTable = new Map();
    blockTable = new Map();

    const configMock = {
      get: jest.fn().mockReturnValue(undefined),
    } as unknown as ConfigService;

    const dbMock = {
      execute: jest.fn().mockImplementation((queryObj) => {
        const chunks = queryObj?.queryChunks ?? [];
        const queryText = chunks
          .map((c: any) => (typeof c === 'string' ? c : c?.value?.join('') ?? ''))
          .join(' ');

        // 1. Atomic reservation query
        if (queryText.includes('INSERT INTO feature_quota_usage')) {
          const userId = chunks[3];
          const feature = chunks[5];
          const limit = chunks[17] ?? 10;

          const key = `${userId}:${feature}`;
          const current = usageTable.get(key) ?? { used_count: 0, limit };

          if (current.used_count + 1 <= limit) {
            current.used_count += 1;
            usageTable.set(key, current);
            return Promise.resolve({ rows: [{ used_count: current.used_count }] });
          } else {
            return Promise.resolve({ rows: [] });
          }
        }

        // 2. Compensation query
        if (queryText.includes('UPDATE feature_quota_usage')) {
          const userId = chunks[1];
          const feature = chunks[3];
          const key = `${userId}:${feature}`;
          const current = usageTable.get(key);
          if (current) {
            current.used_count = Math.max(0, current.used_count - 1);
            usageTable.set(key, current);
          }
          return Promise.resolve({ rows: [] });
        }

        return Promise.resolve({ rows: [] });
      }),

      select: jest.fn().mockImplementation(() => ({
        from: jest.fn().mockImplementation(() => ({
          where: jest.fn().mockImplementation(() => ({
            limit: jest.fn().mockImplementation(() => {
              for (const [key, val] of blockTable.entries()) {
                return Promise.resolve([{
                  userId: key.split(":")[0],
                  feature: key.split(":")[1],
                  blockedUntil: val.blockedUntil,
                  violationCount: val.violationCount,
                  lastViolationAt: val.lastViolationAt,
                }]);
              }
              return Promise.resolve([]);
            }),
          })),
        })),
      })),

      insert: jest.fn().mockImplementation(() => ({
        values: jest.fn().mockImplementation((val) => {
          if (val.status === 'reserved') {
            ledgerTable.set(val.id, {
              status: 'reserved',
              userId: val.userId,
              feature: val.feature,
              createdAt: val.createdAt ?? new Date(),
            });
          }
          if (val.blockedUntil) {
            const key = `${val.userId}:${val.feature}`;
            blockTable.set(key, {
              blockedUntil: val.blockedUntil,
              violationCount: val.violationCount ?? 1,
              lastViolationAt: val.lastViolationAt ?? new Date(),
            });
          }
          return {
            onConflictDoUpdate: jest.fn().mockResolvedValue([]),
          };
        }),
      })),

      update: jest.fn().mockImplementation(() => ({
        set: jest.fn().mockImplementation((updates) => ({
          where: jest.fn().mockImplementation((whereClause) => {
            return {
              returning: jest.fn().mockImplementation(() => {
                for (const [id, entry] of ledgerTable.entries()) {
                  if (entry.status === 'reserved') {
                    entry.status = updates.status;
                    return Promise.resolve([{
                      userId: entry.userId,
                      feature: entry.feature,
                      createdAt: entry.createdAt,
                    }]);
                  }
                }
                return Promise.resolve([]);
              }),
            };
          }),
        })),
      })),
    };

    service = new QuotasService(dbMock, configMock);
  });

  describe('Concurrency & Atomic Reservation', () => {
    it('allows exactly 1 reservation and rejects 19 concurrent requests when 1 slot remains', async () => {
      const userId = 'user_concurrency';
      const feature = 'document_analysis';
      const key = `${userId}:${feature}`;

      usageTable.set(key, { used_count: 9, limit: 10 });

      const requests = Array.from({ length: 20 }, (_, i) =>
        service.reserveQuota(userId, feature, 'free', `op_conc_${i}`),
      );

      const results = await Promise.all(requests);

      const allowed = results.filter((r) => r.allowed);
      const rejected = results.filter((r) => !r.allowed);

      expect(allowed.length).toBe(1);
      expect(allowed[0].used).toBe(10);
      expect(allowed[0].remaining).toBe(0);

      expect(rejected.length).toBe(19);
      expect(rejected[0].errorCode).toBe('FEATURE_LIMIT_REACHED');
      expect(rejected[0].retryAfterSeconds).toBeGreaterThan(0);
    });
  });

  describe('Idempotent Compensation', () => {
    it('refunds the quota slot only once even when compensation is called multiple times', async () => {
      const userId = 'user_refund';
      const feature = 'image_analysis';
      const key = `${userId}:${feature}`;
      const opId = 'op_refund_1';

      usageTable.set(key, { used_count: 5, limit: 10 });
      ledgerTable.set(opId, {
        status: 'reserved',
        userId,
        feature,
        createdAt: new Date(),
      });

      const firstRefund = await service.compensateQuota(opId);
      expect(firstRefund).toBe(true);
      expect(usageTable.get(key)?.used_count).toBe(4);

      const secondRefund = await service.compensateQuota(opId);
      expect(secondRefund).toBe(false);
      expect(usageTable.get(key)?.used_count).toBe(4);
    });
  });

  describe('User & Feature Isolation', () => {
    it('isolates quotas strictly between different users and different features', async () => {
      usageTable.set('userA:document_analysis', { used_count: 10, limit: 10 });

      const userAImage = await service.reserveQuota('userA', 'image_analysis', 'free', 'op_iso_1');
      expect(userAImage.allowed).toBe(true);

      const userBDoc = await service.reserveQuota('userB', 'document_analysis', 'free', 'op_iso_2');
      expect(userBDoc.allowed).toBe(true);

      const userADoc = await service.reserveQuota('userA', 'document_analysis', 'free', 'op_iso_3');
      expect(userADoc.allowed).toBe(false);
      expect(userADoc.errorCode).toBe('FEATURE_LIMIT_REACHED');
    });
  });

  describe('runWithQuota & External Failure Recovery', () => {
    it('automatically refunds the quota when the wrapped provider operation throws', async () => {
      const userId = 'user_fail_test';
      const feature = 'document_analysis';
      const key = `${userId}:${feature}`;

      usageTable.set(key, { used_count: 2, limit: 10 });

      await expect(
        service.runWithQuota(userId, feature, 'free', async () => {
          throw new Error('Provider 503 Service Unavailable');
        }, 'op_wrapped_fail'),
      ).rejects.toThrow('Provider 503 Service Unavailable');

      expect(usageTable.get(key)?.used_count).toBe(2);
    });
  });

  describe('Adaptive Penalty Calculation', () => {
    it('applies exponential backoff on repeated burst violations up to maxBlockSeconds', async () => {
      const userId = 'user_adaptive';
      const feature = 'document_analysis';
      const policy = service.getPolicy('free', feature);
      const now = new Date();

      const v1 = await service.recordAdaptiveViolation(userId, feature, policy, now);
      expect(v1.violationCount).toBe(1);
      expect(v1.retryAfterSeconds).toBe(300);

      const v2 = await service.recordAdaptiveViolation(userId, feature, policy, new Date(now.getTime() + 60_000));
      expect(v2.violationCount).toBe(2);
      expect(v2.retryAfterSeconds).toBe(600);

      const v3 = await service.recordAdaptiveViolation(userId, feature, policy, new Date(now.getTime() + 120_000));
      expect(v3.violationCount).toBe(3);
      expect(v3.retryAfterSeconds).toBe(1200);
    });
  });
});
