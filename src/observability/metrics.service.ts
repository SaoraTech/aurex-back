import { Injectable } from '@nestjs/common';
import { ProviderError } from '../common/provider-error';

type Labels = Record<string, string>;
const esc = (v: string) => v.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, ' ');

/**
 * In-process metrics (counters + latency sum/count/max) rendered in Prometheus text format.
 * Per-instance: aggregate across instances in your monitoring system.
 */
@Injectable()
export class MetricsService {
  private readonly counters = new Map<string, number>();
  private readonly latency = new Map<string, { count: number; sumMs: number; maxMs: number }>();

  inc(name: string, labels: Labels = {}, by = 1) {
    const key = `${name}|${JSON.stringify(Object.entries(labels).sort())}`;
    this.counters.set(key, (this.counters.get(key) ?? 0) + by);
  }

  /** Times an external call. outcome = ok | <ProviderErrorKind> | error. Distinguishes provider outage from business errors. */
  async track<T>(provider: string, operation: string, fn: () => Promise<T>): Promise<T> {
    const started = Date.now();
    let outcome = 'ok';
    try {
      return await fn();
    } catch (error) {
      outcome = error instanceof ProviderError ? error.kind : 'error';
      throw error;
    } finally {
      const ms = Date.now() - started;
      this.inc('aurex_provider_calls_total', { provider, operation, outcome });
      const key = `${provider}|${operation}`;
      const cur = this.latency.get(key) ?? { count: 0, sumMs: 0, maxMs: 0 };
      this.latency.set(key, { count: cur.count + 1, sumMs: cur.sumMs + ms, maxMs: Math.max(cur.maxMs, ms) });
    }
  }

  render(): string {
    const lines: string[] = ['# TYPE aurex_provider_calls_total counter'];
    for (const [key, value] of this.counters) {
      const [name, raw] = key.split('|');
      const labels = (JSON.parse(raw) as [string, string][]).map(([k, v]) => `${k}="${esc(v)}"`).join(',');
      lines.push(`${name}${labels ? `{${labels}}` : ''} ${value}`);
    }
    lines.push('# TYPE aurex_provider_latency_ms summary');
    for (const [key, v] of this.latency) {
      const [provider, operation] = key.split('|');
      const l = `provider="${esc(provider)}",operation="${esc(operation)}"`;
      lines.push(`aurex_provider_latency_ms_count{${l}} ${v.count}`, `aurex_provider_latency_ms_sum{${l}} ${v.sumMs}`, `aurex_provider_latency_ms_max{${l}} ${v.maxMs}`);
    }
    return lines.join('\n') + '\n';
  }
}
