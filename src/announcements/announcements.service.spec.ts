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
          const rows = Array.isArray(val) ? val : [val];
          const inserted = rows.map((item: any) => ({ ...item, createdAt: new Date(), updatedAt: new Date() }));
          store.push(...inserted);
          return {
            returning: jest.fn().mockResolvedValue(inserted),
            onConflictDoNothing: jest.fn().mockResolvedValue(undefined),
          };
        }),
      }),
      update: jest.fn().mockReturnValue({
        set: jest.fn().mockImplementation((updates) => ({
          where: jest.fn().mockImplementation(() => {
            const item = store[0];
            if (item) Object.assign(item, updates);
            return { returning: jest.fn().mockResolvedValue(item ? [item] : []) };
          }),
        })),
      }),
      select: jest.fn().mockImplementation(() => ({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            limit: jest.fn().mockImplementation((limit) => ({
              offset: jest.fn().mockResolvedValue(store.slice(0, limit)),
              then: (resolve: any) => resolve(store.slice(0, limit)),
            })),
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
      triggerWorkflow: jest.fn().mockResolvedValue({ sent: true, transactionId: 'novu_tx_1' }),
    };

    service = new AnnouncementsService(dbMock, notificationsMock as unknown as NotificationsService);
  });

  it('creates in-app-only publications as drafts without external channels', async () => {
    const created = await service.create({
      title: 'Nouvelle fonctionnalité',
      summary: 'Résumé de la nouveauté',
      content: 'Contenu détaillé de la publication',
      publicationMode: 'IN_APP_ONLY',
    }, 'admin_1', true);

    expect(created.status).toBe('draft');
    expect(created.publicationMode).toBe('IN_APP_ONLY');
    expect(created.notificationChannels).toEqual([]);
  });

  it('requires selected channels for multi-channel publications', async () => {
    await expect(service.create({
      title: 'Nouvelle fonctionnalité',
      summary: 'Résumé de la nouveauté',
      content: 'Contenu détaillé de la publication',
      publicationMode: 'MULTI_CHANNEL',
    })).rejects.toThrow('Sélectionnez au moins un canal Push ou Email.');
  });

  it('schedules a publication with an explicit downstream delivery mode', async () => {
    const created = await service.create({
      title: 'Maintenance planifiée',
      summary: 'Interruption programmée',
      content: 'Détails de la maintenance programmée',
      publicationMode: 'SCHEDULED',
      scheduledAt: new Date(Date.now() + 60_000).toISOString(),
      scheduledDeliveryMode: 'MULTI_CHANNEL',
      notificationChannels: ['push', 'email'],
    });

    expect(created.status).toBe('scheduled');
    expect(created.scheduledDeliveryMode).toBe('MULTI_CHANNEL');
    expect(created.notificationChannels).toEqual(['push', 'email']);
  });

  it('does not trigger Novu for IN_APP_ONLY publication', async () => {
    const created = await service.create({
      title: 'Petite correction',
      summary: 'Résumé de la correction',
      content: 'Détails de la correction',
      publicationMode: 'IN_APP_ONLY',
    });
    jest.spyOn(service, 'getById').mockResolvedValue(created as any);

    await service.publish(created.id, 'admin_1');
    expect(notificationsMock.triggerWorkflow).not.toHaveBeenCalled();
  });

  it('targets a Novu topic and records per-channel dispatch results for MULTI_CHANNEL', async () => {
    const created = {
      id: 'ann_1',
      title: 'Mise à jour majeure',
      summary: 'Résumé',
      category: 'improvement',
      link: null,
      status: 'draft',
      publicationMode: 'MULTI_CHANNEL',
      notificationChannels: ['push', 'email'],
      targetAudience: 'plus',
    };
    jest.spyOn(service, 'getById').mockResolvedValue(created as any);
    dbMock.update.mockReturnValue({
      set: jest.fn().mockReturnValue({
        where: jest.fn().mockReturnValue({ returning: jest.fn().mockResolvedValue([{ ...created, status: 'published' }]) }),
      }),
    });

    const published = await service.publish(created.id, 'admin_1');
    expect(published.status).toBe('published');
    expect(notificationsMock.triggerWorkflow).toHaveBeenCalledWith(expect.objectContaining({
      topicKey: 'announcements:plus',
      workflowId: 'aurex-announcement',
      payload: expect.objectContaining({ targetAudience: 'plus', channels: ['push', 'email'] }),
    }));
    expect(dbMock.insert).toHaveBeenCalled();
  });

  it('rejects scheduled dates that are not in the future', async () => {
    await expect(service.create({
      title: 'Maintenance',
      summary: 'Résumé',
      content: 'Détails de la maintenance',
      publicationMode: 'SCHEDULED',
      scheduledAt: new Date(Date.now() - 60_000).toISOString(),
      scheduledDeliveryMode: 'IN_APP_ONLY',
    })).rejects.toThrow('La date de programmation doit être une date future valide.');
  });
});
