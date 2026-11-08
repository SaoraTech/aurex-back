import { GuestImportService } from './guest-import.service';
import { GuestSessionService } from './guest-session.service';
import { conversation, message } from '../db/schema';

describe('GuestImportService', () => {
  const snapshot = {
    sessionId: 'guest-session-id',
    used: 1,
    createdAt: Date.parse('2026-11-08T10:00:00.000Z'),
    expiresAt: Date.parse('2026-11-08T22:00:00.000Z'),
    messages: [
      { role: 'user' as const, content: 'Question', createdAt: '2026-11-08T10:00:00.000Z' },
      { role: 'assistant' as const, content: 'Réponse', createdAt: '2026-11-08T10:00:02.000Z', provider: 'groq', model: 'test-model', latencyMs: 120 },
    ],
  };
  let rows: { conversation?: any; messages: any[] };
  let db: any;
  let guests: any;
  let service: GuestImportService;

  beforeEach(() => {
    rows = { messages: [] };
    db = {
      select: jest.fn(() => {
        const query: any = { table: undefined };
        query.from = jest.fn((table: any) => { query.table = table; return query; });
        query.where = jest.fn(() => query);
        query.limit = jest.fn(async () => query.table === conversation && rows.conversation ? [rows.conversation] : []);
        query.then = (resolve: (value: any) => any, reject: (reason: any) => any) =>
          Promise.resolve(query.table === message ? rows.messages : query.table === conversation && rows.conversation ? [rows.conversation] : []).then(resolve, reject);
        return query;
      }),
      transaction: jest.fn(async (callback: (tx: any) => Promise<void>) => {
        const tx = {
          insert: jest.fn((table: any) => ({
            values: jest.fn(async (value: any) => {
              if (table === conversation) rows.conversation = value;
              if (table === message) rows.messages = value;
            }),
          })),
        };
        await callback(tx);
      }),
    };
    guests = {
      beginImport: jest.fn(() => snapshot),
      completeImport: jest.fn(),
      releaseImport: jest.fn(),
    };
    service = new GuestImportService(db, guests as GuestSessionService);
  });

  const payload = () => ({
    transferId: 'd2b9b9aa-3f24-4a63-b9de-9c3c9d5c9d7d',
    messages: snapshot.messages.map(({ role, content, createdAt }) => ({ role, content, createdAt })),
  });

  it('persists the ordered Guest transcript transactionally and then revokes the session', async () => {
    const result = await service.importConversation('Bearer token', 'user-1', payload());
    expect(result).toMatchObject({ imported: true, idempotentReplay: false, messageCount: 2 });
    expect(rows.conversation).toMatchObject({ userId: 'user-1', subject: 'general', title: 'Question' });
    expect(rows.messages.map((item: any) => [item.role, item.content])).toEqual([['user', 'Question'], ['assistant', 'Réponse']]);
    expect(rows.messages[1]).toMatchObject({ provider: 'groq', model: 'test-model', latencyMs: 120 });
    expect(guests.completeImport).toHaveBeenCalledWith('guest-session-id');
    expect(guests.releaseImport).not.toHaveBeenCalled();
  });

  it('returns the existing conversation for a repeated transfer id without creating duplicates', async () => {
    const first = await service.importConversation('Bearer token', 'user-1', payload());
    const replay = await service.importConversation('Bearer token', 'user-1', payload());
    expect(replay).toMatchObject({ conversationId: first.conversationId, imported: true, idempotentReplay: true, messageCount: 2 });
    expect(db.transaction).toHaveBeenCalledTimes(1);
  });

  it('rejects malformed message order without creating a conversation', async () => {
    const invalid = payload();
    invalid.messages[0].role = 'assistant';
    await expect(service.importConversation('Bearer token', 'user-1', invalid)).rejects.toMatchObject({ status: 400 });
    expect(db.transaction).not.toHaveBeenCalled();
    expect(guests.releaseImport).toHaveBeenCalledWith('guest-session-id');
    expect(guests.completeImport).not.toHaveBeenCalled();
  });

  it('keeps the Guest session alive when Neon persistence fails', async () => {
    db.transaction.mockRejectedValueOnce(new Error('Neon unavailable'));
    await expect(service.importConversation('Bearer token', 'user-1', payload())).rejects.toMatchObject({ status: 503 });
    expect(guests.releaseImport).toHaveBeenCalledWith('guest-session-id');
    expect(guests.completeImport).not.toHaveBeenCalled();
  });

  it('does not let the payload select its conversation owner', async () => {
    await service.importConversation('Bearer token', 'authenticated-user-42', payload());
    expect(rows.conversation.userId).toBe('authenticated-user-42');
  });
});
