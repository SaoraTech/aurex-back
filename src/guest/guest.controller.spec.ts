import { GuestController } from './guest.controller';
import { GuestSessionService } from './guest-session.service';
import { GuestImportService } from './guest-import.service';

describe('GuestController', () => {
  it('streams Groq deltas and a completed response using the guest bearer token', async () => {
    const guests: any = {
      send: jest.fn(async (_authorization: string, _dto: any, options: any) => {
        options.onToken('Bonjour');
        return {
          sessionId: 'guest-session',
          userMessage: { role: 'user', content: 'Bonjour', createdAt: '2026-11-08T10:00:00.000Z' },
          message: { role: 'assistant', content: 'Bonjour.', provider: 'groq', model: 'test-model', latencyMs: 10, createdAt: '2026-11-08T10:00:02.000Z' },
          quota: { limit: 10, used: 1, remaining: 9 },
          expiresAt: new Date(Date.now() + 60_000).toISOString(),
        };
      }),
    };
    const imports: any = { importConversation: jest.fn() };
    const controller = new GuestController(guests as GuestSessionService, imports as GuestImportService);
    const response: any = {
      status: jest.fn().mockReturnThis(),
      set: jest.fn().mockReturnThis(),
      flushHeaders: jest.fn(),
      on: jest.fn(),
      write: jest.fn(),
      end: jest.fn(() => { response.writableEnded = true; }),
      writableEnded: false,
      destroyed: false,
    };

    await controller.stream('Bearer guest-token', { content: 'Bonjour' } as any, response);

    expect(guests.send).toHaveBeenCalledWith('Bearer guest-token', { content: 'Bonjour' }, expect.objectContaining({
      signal: expect.any(AbortSignal),
      onToken: expect.any(Function),
    }));
    expect(response.set).toHaveBeenCalledWith(expect.objectContaining({ 'Content-Type': 'text/event-stream; charset=utf-8' }));
    expect(response.write).toHaveBeenNthCalledWith(1, 'event: delta\ndata: {"delta":"Bonjour"}\n\n');
    expect(response.write.mock.calls[1][0]).toContain('event: done\ndata: ');
    expect(response.end).toHaveBeenCalledTimes(1);
  });

  it('delegates an authenticated import using the server-resolved user id', async () => {
    const guests: any = {};
    const imports: any = { importConversation: jest.fn().mockResolvedValue({ conversationId: 'persisted-id' }) };
    const controller = new GuestController(guests as GuestSessionService, imports as GuestImportService);
    const result = await controller.importCurrentSession('guest-token', 'authenticated-user-id', {
      transferId: 'd2b9b9aa-3f24-4a63-b9de-9c3c9d5c9d7d',
      messages: [
        { role: 'user', content: 'Q', createdAt: '2026-11-08T10:00:00.000Z' },
        { role: 'assistant', content: 'A', createdAt: '2026-11-08T10:00:02.000Z' },
      ],
    });
    expect(imports.importConversation).toHaveBeenCalledWith('Bearer guest-token', 'authenticated-user-id', expect.any(Object));
    expect(result).toEqual({ conversationId: 'persisted-id' });
  });
});
