import { ProtectGuard } from './protect.guard';

describe('ProtectGuard', () => {
  const req: any = { headers: {}, ip: '203.0.113.5', socket: {} };
  const response: any = { setHeader: jest.fn() };
  const context: any = {
    getType: () => 'http',
    getHandler: () => ({}),
    getClass: () => ({}),
    switchToHttp: () => ({ getRequest: () => req, getResponse: () => response }),
  };

  it('applies the pre-auth IP gate before Better Auth session resolution', async () => {
    const reflector: any = { getAllAndOverride: () => 'chat' };
    const users: any = { resolve: jest.fn() };
    const security: any = { decide: jest.fn().mockResolvedValue({ allowed: false, status: 429, code: 'RATE_LIMITED', retryAfterSeconds: 30 }) };
    const guard = new ProtectGuard(reflector, security, users);
    await expect(guard.canActivate(context)).rejects.toMatchObject({ status: 429 });
    expect(security.decide).toHaveBeenCalledWith(req, 'preauth');
    expect(users.resolve).not.toHaveBeenCalled();
    expect(response.setHeader).toHaveBeenCalledWith('Retry-After', '30');
  });

  it('resolves the verified user only after pre-auth protection, then applies route policy', async () => {
    const reflector: any = { getAllAndOverride: () => 'chat' };
    const users: any = { resolve: jest.fn().mockResolvedValue({ id: 'verified-user' }) };
    const security: any = { decide: jest.fn()
      .mockResolvedValueOnce({ allowed: true })
      .mockResolvedValueOnce({ allowed: true }) };
    const guard = new ProtectGuard(reflector, security, users);
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(security.decide.mock.calls).toEqual([[req, 'preauth'], [req, 'chat', 'verified-user']]);
    expect(users.resolve).toHaveBeenCalledTimes(1);
  });
});
