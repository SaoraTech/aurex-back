/**
 * In-process sliding-window limiter. It is (a) the enforcement layer when Arcjet is disabled (dev/test),
 * (b) the degraded-mode layer when Arcjet errors. Per-instance state: with several instances the effective
 * limit is multiplied by the number of instances, which is why Arcjet is the production control.
 */
export class LocalLimiter {
  private readonly hits = new Map<string, number[]>();
  private lastSweep = 0;
  constructor(private readonly now: () => number = Date.now) {}

  hit(key: string, intervalSeconds: number, max: number): { allowed: boolean; remaining: number; retryAfterSeconds: number } {
    const t = this.now();
    const windowMs = intervalSeconds * 1000;
    const arr = (this.hits.get(key) ?? []).filter(ts => ts > t - windowMs);
    if (arr.length >= max) {
      this.hits.set(key, arr);
      return { allowed: false, remaining: 0, retryAfterSeconds: Math.max(1, Math.ceil((arr[0] + windowMs - t) / 1000)) };
    }
    arr.push(t);
    this.hits.set(key, arr);
    this.sweep(t, windowMs);
    return { allowed: true, remaining: max - arr.length, retryAfterSeconds: 0 };
  }

  private sweep(t: number, windowMs: number) {
    if (t - this.lastSweep < 60_000 && this.hits.size < 10_000) return;
    this.lastSweep = t;
    for (const [k, arr] of this.hits) if (!arr.length || arr[arr.length - 1] <= t - Math.max(windowMs, 600_000)) this.hits.delete(k);
  }
}
