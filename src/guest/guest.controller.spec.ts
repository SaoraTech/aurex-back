import { GuestController } from './guest.controller';
import { GuestSessionService } from './guest-session.service';

describe('GuestController', () => {
  it('streams Groq deltas and a completed response using the guest bearer token', async () => {
    const guests: any = {
      send: jest.fn(async (_authorization: string, _dto: any, options: any) => {
        options.onToken('Bonjour');
        return {
          sessionId: 'guest-session',
          message: { role: 'assistant', content: 'Bonjour.', provider: 'groq', model: 'test-model', latencyMs: 10 },
          quota: { limit: 10, used: 1, remaining: 9 },
          expiresAt: new Date(Date.now() + 60_000).toISOString(),
        };
      }),
    };
    const controller = new GuestController(guests as GuestSessionService);
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
});
