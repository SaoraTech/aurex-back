import { PrivacyService } from './privacy.service';

describe('PrivacyService', () => {
  let dbMock: any;
  let service: PrivacyService;
  let privacyRequestsStore: any[];

  beforeEach(() => {
    privacyRequestsStore = [];

    dbMock = {
      select: jest.fn().mockImplementation((cols) => ({
        from: jest.fn().mockImplementation((table) => ({
          where: jest.fn().mockImplementation((clause) => ({
            orderBy: jest.fn().mockImplementation(() => ({
              limit: jest.fn().mockImplementation(() => {
                return Promise.resolve(privacyRequestsStore);
              }),
            })),
            then: (resolve: any) => resolve([]),
          })),
        })),
      })),

      insert: jest.fn().mockImplementation((table) => ({
        values: jest.fn().mockImplementation((val) => {
          privacyRequestsStore.push(val);
          return Promise.resolve();
        }),
      })),

      transaction: jest.fn().mockImplementation(async (callback) => {
        const txMock = {
          delete: jest.fn().mockReturnValue({ where: jest.fn().mockResolvedValue([]) }),
          update: jest.fn().mockReturnValue({
            set: jest.fn().mockReturnValue({ where: jest.fn().mockResolvedValue([]) }),
          }),
        };
        return callback(txMock);
      }),
    };

    service = new PrivacyService(dbMock);
  });

  describe('requestDeletion (Idempotence & Lifecycle)', () => {
    it('creates a new deletion request when none exists', async () => {
      const res = await service.requestDeletion('user_priv_1');
      expect(res.status).toBe('pending');
      expect(privacyRequestsStore.length).toBe(1);
      expect(privacyRequestsStore[0].userId).toBe('user_priv_1');
    });

    it('returns existing pending request without creating duplicates when called repeatedly', async () => {
      privacyRequestsStore.push({
        id: 'req_existing_1',
        userId: 'user_priv_2',
        type: 'delete_account',
        status: 'pending',
        createdAt: new Date(),
      });

      const res = await service.requestDeletion('user_priv_2');
      expect(res.requestId).toBe('req_existing_1');
      expect(res.status).toBe('pending');
      expect(res.message).toContain('déjà en cours');
      expect(privacyRequestsStore.length).toBe(1); // No duplicate added
    });
  });

  describe('purgeUserData', () => {
    it('executes atomic deletion across all personal data tables in a transaction', async () => {
      const result = await service.purgeUserData('user_to_purge');
      expect(result.purged).toBe(true);
      expect(dbMock.transaction).toHaveBeenCalled();
    });
  });
});
