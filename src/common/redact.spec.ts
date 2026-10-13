import { redact, redactString } from './redact';
describe('redact', () => {
  it('masks sensitive keys and bearer tokens', () => {
    const out: any = redact({ authorization: 'Bearer abcdefghijklmnop', apiKey: 'x', nested: { password: 'p', ok: 'fine' } });
    expect(out.authorization).toBe('[REDACTED]'); expect(out.apiKey).toBe('[REDACTED]');
    expect(out.nested.password).toBe('[REDACTED]'); expect(out.nested.ok).toBe('fine');
  });
  it('masks key-like tokens inside strings', () => {
    expect(redactString('failed with Bearer abcdefghijklmnop123')).toBe('failed with Bearer [REDACTED]');
    expect(redactString('key tvly-abcdefghijklmnopqrstuv')).toContain('[REDACTED]');
  });
});
