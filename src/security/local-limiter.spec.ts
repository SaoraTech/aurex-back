import { LocalLimiter } from './local-limiter';
describe('LocalLimiter', () => {
  it('allows up to max then blocks with a retry-after', () => {
    let now = 1_000_000; const l = new LocalLimiter(() => now);
    expect(l.hit('k', 60, 2).allowed).toBe(true);
    expect(l.hit('k', 60, 2).allowed).toBe(true);
    const third = l.hit('k', 60, 2);
    expect(third.allowed).toBe(false); expect(third.retryAfterSeconds).toBeGreaterThan(0);
  });
  it('isolates keys and recovers after the window', () => {
    let now = 1_000_000; const l = new LocalLimiter(() => now);
    l.hit('a', 10, 1); expect(l.hit('a', 10, 1).allowed).toBe(false);
    expect(l.hit('b', 10, 1).allowed).toBe(true);
    now += 11_000; expect(l.hit('a', 10, 1).allowed).toBe(true);
  });
});
