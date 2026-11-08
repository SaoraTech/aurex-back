import { ConfigService } from '@nestjs/config';
import { AiOrchestratorService } from '../ai/ai-orchestrator.service';
import { IdentityService } from '../identity/identity.service';
import { GuestSessionService } from './guest-session.service';

describe('GuestSessionService', () => {
  let service: GuestSessionService;
  let ai: { generate: jest.Mock };
  let identity: { buildSystemInstruction: jest.Mock };
  const config = { get: jest.fn(() => undefined) } as unknown as ConfigService;

  beforeEach(() => {
    ai = { generate: jest.fn().mockResolvedValue({ text: 'Réponse', provider: 'groq', model: 'test-model', latencyMs: 12 }) };
    identity = { buildSystemInstruction: jest.fn(() => 'Aurex system prompt') };
    service = new GuestSessionService(config, ai as unknown as AiOrchestratorService, identity as unknown as IdentityService);
  });

  afterEach(() => service.onModuleDestroy());

  it('creates a high-entropy bearer token and resolves it without a database', () => {
    const created = service.create();
    expect(created.token).toHaveLength(43);
    expect(created.tokenType).toBe('Bearer');
    expect(service.authenticate(`Bearer ${created.token}`).id).toBe(created.sessionId);
  });

  it('keeps conversation context in memory and increments quota only after success', async () => {
    const created = service.create();
    const first = await service.send(`Bearer ${created.token}`, { content: 'Bonjour' });
    expect(first.quota).toEqual({ limit: 10, used: 1, remaining: 9 });
    await service.send(`Bearer ${created.token}`, { content: 'Continue' });
    expect(ai.generate).toHaveBeenCalledTimes(2);
    const secondHistory = ai.generate.mock.calls[1][1];
    expect(secondHistory).toEqual([{ role: 'user', content: 'Bonjour' }, { role: 'assistant', content: 'Réponse' }, { role: 'user', content: 'Continue' }]);
  });

  it('does not consume quota or retain a failed turn', async () => {
    const created = service.create();
    ai.generate.mockRejectedValueOnce(new Error('provider unavailable'));
    await expect(service.send(`Bearer ${created.token}`, { content: 'Question' })).rejects.toThrow('provider unavailable');
    ai.generate.mockResolvedValueOnce({ text: 'OK', provider: 'groq', model: 'test-model' });
    const result = await service.send(`Bearer ${created.token}`, { content: 'Nouvel essai' });
    expect(result.quota.used).toBe(1);
    expect(ai.generate.mock.calls[1][1]).toEqual([{ role: 'user', content: 'Nouvel essai' }]);
  });

  it('expires and removes sessions when their absolute expiry is reached', () => {
    const created = service.create();
    const session = (service as any).sessions.get(created.sessionId);
    session.expiresAt = Date.now() - 1;
    expect(() => service.authenticate(`Bearer ${created.token}`)).toThrow();
    expect((service as any).sessions.size).toBe(0);
    expect((service as any).tokenIndex.size).toBe(0);
  });

  it('rejects turns after the session quota is exhausted', async () => {
    const created = service.create();
    (service as any).sessions.get(created.sessionId).used = 10;
    await expect(service.send(`Bearer ${created.token}`, { content: 'Encore une question' })).rejects.toMatchObject({ status: 429 });
    expect(ai.generate).not.toHaveBeenCalled();
  });

  it('revokes a session immediately', () => {
    const created = service.create();
    expect(service.revoke(`Bearer ${created.token}`)).toEqual({ revoked: true });
    expect(() => service.authenticate(`Bearer ${created.token}`)).toThrow();
  });

  it('rejects overlapping generations in the same session', async () => {
    const created = service.create();
    let finish!: (value: any) => void;
    ai.generate.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const first = service.send(`Bearer ${created.token}`, { content: 'Question 1' });
    await Promise.resolve();
    await expect(service.send(`Bearer ${created.token}`, { content: 'Question 2' })).rejects.toMatchObject({ status: 409 });
    finish({ text: 'OK', provider: 'groq', model: 'test-model' });
    await first;
  });
});
