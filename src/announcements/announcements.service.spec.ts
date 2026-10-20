import { AnnouncementsService } from './announcements.service';
import { NotificationsService } from '../notifications/notifications.service';

describe('AnnouncementsService', () => {
  let dbMock: any;
  let notificationsMock: any;
  let service: AnnouncementsService;
  let store: any[];

  beforeEach(() => {
    store = [];
    dbMock = {
      insert: jest.fn().mockReturnValue({
        values: jest.fn().mockImplementation((val) => {
          const item = { ...val, createdAt: new Date(), updatedAt: new Date() };
          store.push(item);
          return {
            returning: jest.fn().mockResolvedValue([item]),
          };
        }),
      }),
      update: jest.fn().mockReturnValue({
        set: jest.fn().mockImplementation((updates) => ({
          where: jest.fn().mockImplementation(() => {
            const item = store[0];
            if (item) Object.assign(item, updates);
            return {
              returning: jest.fn().mockResolvedValue([item]),
            };
          }),
        })),
      }),
      select: jest.fn().mockImplementation((cols) => ({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            limit: jest.fn().mockImplementation((limit) => {
              return {
                offset: jest.fn().mockResolvedValue(store.slice(0, limit)),
                then: (resolve: any) => resolve(store.slice(0, limit)),
              };
            }),
            orderBy: jest.fn().mockReturnValue({
              limit: jest.fn().mockReturnValue({
                offset: jest.fn().mockResolvedValue(store),
              }),
            }),
          }),
        }),
      })),
    };

    notificationsMock = {
      triggerWorkflow: jest.fn().mockResolvedValue({ sent: true }),
    };

    service = new AnnouncementsService(dbMock, notificationsMock as unknown as NotificationsService);
  });

  describe('Hybrid publication mode', () => {
    it('creates announcement in pending_review status by default in hybrid mode', async () => {
      const created = await service.create({
        title: 'Nouvelle fonctionnalité de calcul',
        summary: 'Découvrez le nouveau moteur',
        content: 'Contenu détaillé de la nouveauté',
        category: 'feature',
        publicationMode: 'hybrid',
      }, 'admin_1', true);

      expect(created.status).toBe('pending_review');
      expect(created.publishedAt).toBeNull();
    });

    it('publishes a pending announcement and triggers Novu when sendNotification is true', async () => {
      const created = await service.create({
        title: 'Mise à jour majeure',
        summary: 'Résumé',
        content: 'Détails',
        category: 'improvement',
        publicationMode: 'hybrid',
      }, 'admin_1', true);

      // Simulate getById finding the item
      jest.spyOn(service, 'getById').mockResolvedValue(created as any);

      const published = await service.publish(created.id, { sendNotification: true }, 'admin_1');

      expect(published.status).toBe('published');
      expect(published.publishedBy).toBe('admin_1');
      expect(notificationsMock.triggerWorkflow).toHaveBeenCalledWith(expect.objectContaining({
        workflowId: 'aurex-announcement',
      }));
    });

    it('does not trigger Novu when sendNotification is false or omitted', async () => {
      const created = await service.create({
        title: 'Petite correction',
        summary: 'Résumé',
        content: 'Détails',
      }, 'admin_1', true);

      jest.spyOn(service, 'getById').mockResolvedValue(created as any);

      await service.publish(created.id, { sendNotification: false }, 'admin_1');

      expect(notificationsMock.triggerWorkflow).not.toHaveBeenCalled();
    });

    it('prevents modifying an already published announcement', async () => {
      const publishedItem = {
        id: 'ann_1',
        title: 'Titre',
        status: 'published',
      };
      jest.spyOn(service, 'getById').mockResolvedValue(publishedItem as any);

      await expect(service.update('ann_1', { title: 'Nouveau Titre' })).rejects.toThrow(
        'Impossible de modifier une annonce déjà publiée.',
      );
    });
  });
});
