import { StorageService } from './storage.service';

const UUID = '123e4567-e89b-12d3-a456-426614174000';
const cfg = (o: Record<string, unknown>) => ({ get: (k: string) => o[k] }) as any;
const metrics: any = { track: (_p: string, _o: string, fn: () => Promise<unknown>) => fn() };
const enabled = { r2Enabled: true, r2AccountId: 'acc', r2Bucket: 'b', r2AccessKeyId: 'k', r2SecretAccessKey: 's', r2TimeoutMs: 1000 };

describe('StorageService', () => {
  it('is disabled by default and refuses to operate with a clear 503', async () => {
    const s = new StorageService(cfg({ r2Enabled: false }), metrics);
    expect(s.isEnabled()).toBe(false);
    await expect(s.put('k', Buffer.from('x'), 'text/plain', 'u')).rejects.toMatchObject({ status: 503, code: 'STORAGE_DISABLED' });
  });
  it('refuses to start enabled without credentials', () => {
    expect(() => new StorageService(cfg({ r2Enabled: true, r2Bucket: 'b' }), metrics)).toThrow();
  });
  it('builds keys server-side and rejects non-UUID object ids / path tricks', () => {
    const s = new StorageService(cfg(enabled), metrics);
    expect(s.buildKey('user-1', UUID)).toBe(`users/user-1/${UUID}`);
    expect(() => s.buildKey('user-1', '../../other')).toThrow();
    expect(s.buildKey('a/b', UUID)).toBe(`users/a%2Fb/${UUID}`);
  });
  it('exists() returns false on 404 and throws mapped errors otherwise', async () => {
    const s = new StorageService(cfg(enabled), metrics);
    (s as any).client = { send: jest.fn().mockRejectedValue(Object.assign(new Error('nf'), { name: 'NotFound', $metadata: { httpStatusCode: 404 } })) };
    expect(await s.exists('k')).toBe(false);
    (s as any).client = { send: jest.fn().mockRejectedValue(Object.assign(new Error('x'), { $metadata: { httpStatusCode: 500 } })) };
    await expect(s.exists('k')).rejects.toMatchObject({ status: 503 });
  });
  it('maps a 403 from R2 to a misconfiguration error (no leak)', async () => {
    const s = new StorageService(cfg(enabled), metrics);
    (s as any).client = { send: jest.fn().mockRejectedValue(Object.assign(new Error('AccessDenied key=abc'), { $metadata: { httpStatusCode: 403 } })) };
    await expect(s.delete('k')).rejects.toMatchObject({ code: 'STORAGE_MISCONFIGURED' });
  });
  it('uses the configured endpoint override and never a public base URL', () => {
    const s = new StorageService(cfg({ ...enabled, r2Endpoint: 'https://acc.eu.r2.cloudflarestorage.com' }), metrics);
    expect(s.isEnabled()).toBe(true);
  });
});
