import { ArcjetService } from './arcjet.service';
import { POLICIES } from './arcjet.policies';

const metrics: any = { inc: jest.fn() };
const cfg = (o: Record<string, unknown>) => ({ get: (k: string) => o[k] }) as any;
const req: any = { ip: '203.0.113.9', headers: {}, socket: {} };
const decision = (o: Partial<{ denied: boolean; errored: boolean; rate: boolean; bot: boolean; reset: number }>) => ({
  id: 'd1', isDenied: () => !!o.denied, isErrored: () => !!o.errored,
  reason: { isRateLimit: () => !!o.rate, isBot: () => !!o.bot, isShield: () => false, reset: o.reset },
});
const sdk = (protect: jest.Mock) => ({
  default: jest.fn(() => ({ protect })), shield: jest.fn(() => 'shield'), detectBot: jest.fn(() => 'bot'), slidingWindow: jest.fn(() => 'sw'),
});
async function build(protect: jest.Mock, extra: Record<string, unknown> = {}) {
  const mod = sdk(protect);
  const svc = new ArcjetService(cfg({ arcjetMode: 'live', arcjetKey: 'ajkey_test', nodeEnv: 'test', arcjetBotAllow: ['CATEGORY:PROGRAMMATIC'], trustedProxies: [], ...extra }), metrics, async () => mod);
  await svc.onModuleInit();
  return { svc, mod };
}

describe('ArcjetService', () => {
  it('actually builds rules per category and calls protect with the verified user id', async () => {
    const protect = jest.fn().mockResolvedValue(decision({}));
    const { svc, mod } = await build(protect);
    const v = await svc.decide(req, 'chat', 'user-1');
    expect(v.allowed).toBe(true);
    expect(protect).toHaveBeenCalledTimes(1);
    expect(protect.mock.calls[0][1]).toEqual({ userId: 'user-1' });
    expect(mod.slidingWindow).toHaveBeenCalled();
  });
  it('translates a rate-limit denial into 429 with Retry-After', async () => {
    const { svc } = await build(jest.fn().mockResolvedValue(decision({ denied: true, rate: true, reset: 42 })));
    expect(await svc.decide(req, 'tts', 'u')).toMatchObject({ allowed: false, status: 429, code: 'RATE_LIMITED', retryAfterSeconds: 42 });
  });
  it('translates a bot denial into 403', async () => {
    const { svc } = await build(jest.fn().mockResolvedValue(decision({ denied: true, bot: true })));
    expect(await svc.decide(req, 'auth')).toMatchObject({ allowed: false, status: 403, code: 'BOT_DETECTED' });
  });
  it('on Arcjet error enforces the local limiter (does NOT open everything) for sensitive routes', async () => {
    const protect = jest.fn().mockResolvedValue(decision({ errored: true }));
    const { svc } = await build(protect);
    const max = Math.max(1, Math.floor(POLICIES.tts.userLimit!.max * 0.5));
    let last: any;
    for (let i = 0; i < max + 1; i++) last = await svc.decide(req, 'tts', 'u-degraded');
    expect(last).toMatchObject({ allowed: false, status: 429, source: 'local', degraded: true });
  });
  it('denies with 503 when ARCJET_FAIL_MODE=deny and Arcjet throws', async () => {
    const { svc } = await build(jest.fn().mockRejectedValue(new Error('network')), { arcjetFailMode: 'deny' });
    expect(await svc.decide(req, 'chat', 'u')).toMatchObject({ allowed: false, status: 503, code: 'SECURITY_UNAVAILABLE' });
  });
  it('low-risk read routes may fail open when Arcjet errors', async () => {
    const { svc } = await build(jest.fn().mockResolvedValue(decision({ errored: true })));
    expect(await svc.decide(req, 'read', 'u')).toMatchObject({ allowed: true, degraded: true });
  });
  it('disabled mode still enforces the local limiter', async () => {
    const svc = new ArcjetService(cfg({ arcjetMode: 'disabled', nodeEnv: 'test' }), metrics, async () => { throw new Error('must not load'); });
    await svc.onModuleInit();
    const max = POLICIES.signup.ipLimit!.max; let last: any;
    for (let i = 0; i < max + 1; i++) last = await svc.decide({ ...req, ip: '198.51.100.7' }, 'signup');
    expect(last.allowed).toBe(false); expect(last.source).toBe('local');
  });
  it('exempt category is never evaluated', async () => {
    const protect = jest.fn();
    const { svc } = await build(protect);
    expect((await svc.decide(req, 'exempt')).allowed).toBe(true); expect(protect).not.toHaveBeenCalled();
  });
  it('throws at startup in production when the SDK cannot be loaded', async () => {
    const svc = new ArcjetService(cfg({ arcjetMode: 'live', arcjetKey: 'k', nodeEnv: 'production' }), metrics, async () => { throw new Error('missing'); });
    await expect(svc.onModuleInit()).rejects.toThrow();
  });
});
