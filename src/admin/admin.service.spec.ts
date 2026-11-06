import { AdminService } from './admin.service';

describe('AdminService audit history', () => {
  const rows = [
    {
      id: 'audit_1',
      actorUserId: 'user_1',
      actorEmail: 'admin@saora.tech',
      action: 'announcement.publish',
      targetType: 'announcement',
      targetId: 'announcement_1',
      requestId: 'req_1',
      createdAt: new Date('2026-11-06T12:00:00.000Z'),
    },
  ];

  it('returns paginated audit events without exposing arbitrary metadata', async () => {
    const offset = jest.fn().mockResolvedValue(rows);
    const limit = jest.fn().mockReturnValue({ offset });
    const orderBy = jest.fn().mockReturnValue({ limit });
    const whereItems = jest.fn().mockReturnValue({ orderBy });
    const leftJoin = jest.fn().mockReturnValue({ where: whereItems });
    const fromItems = jest.fn().mockReturnValue({ leftJoin });
    const whereCount = jest.fn().mockResolvedValue([{ count: 7 }]);
    const fromCount = jest.fn().mockReturnValue({ where: whereCount });

    const db = {
      select: jest.fn()
        .mockReturnValueOnce({ from: fromItems })
        .mockReturnValueOnce({ from: fromCount }),
    };
    const config = { get: jest.fn() };
    const service = new AdminService(db as any, config as any);

    const result = await service.listAuditEvents(
      'announcement.publish',
      'user_1',
      'announcement',
      '25',
      '10',
    );

    expect(result).toEqual({ items: rows, total: 7, limit: 25, offset: 10 });
    expect(db.select).toHaveBeenCalledTimes(2);
    expect(leftJoin).toHaveBeenCalled();
    expect(whereItems).toHaveBeenCalled();
    expect(whereCount).toHaveBeenCalled();
  });

  it('uses safe pagination defaults and caps the requested page size', async () => {
    const offset = jest.fn().mockResolvedValue([]);
    const limit = jest.fn().mockReturnValue({ offset });
    const orderBy = jest.fn().mockReturnValue({ limit });
    const whereItems = jest.fn().mockReturnValue({ orderBy });
    const leftJoin = jest.fn().mockReturnValue({ where: whereItems });
    const fromItems = jest.fn().mockReturnValue({ leftJoin });
    const whereCount = jest.fn().mockResolvedValue([{ count: 0 }]);
    const fromCount = jest.fn().mockReturnValue({ where: whereCount });
    const db = {
      select: jest.fn()
        .mockReturnValueOnce({ from: fromItems })
        .mockReturnValueOnce({ from: fromCount }),
    };
    const service = new AdminService(db as any, { get: jest.fn() } as any);

    const result = await service.listAuditEvents(undefined, undefined, undefined, '1000', '-1');

    expect(result).toEqual({ items: [], total: 0, limit: 100, offset: 0 });
  });
});
