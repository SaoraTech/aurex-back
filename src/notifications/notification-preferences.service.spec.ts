import { NotificationPreferencesService } from './notification-preferences.service';

describe('NotificationPreferencesService', () => {
  it('returns safe defaults when a user has no stored preferences', async () => {
    const db = { select: () => ({ from: () => ({ where: () => ({ limit: async () => [] }) }) }) };
    const service = new NotificationPreferencesService(db as any);
    await expect(service.getForUser('user_1')).resolves.toEqual({
      editorialEmailEnabled: true,
      editorialPushEnabled: true,
      transactionalEmailEnabled: true,
      transactionalPushEnabled: true,
    });
  });
});
