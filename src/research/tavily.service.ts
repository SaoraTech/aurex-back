import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { assertOk, fetchWithTimeout } from '../common/http';
import { ProviderError, kindFromStatus } from '../common/provider-error';
import { TtlCache } from '../common/ttl-cache';
import { MetricsService } from '../observability/metrics.service';

const BASE = 'https://api.tavily.com';

export interface TavilyHit { url: string; title: string; content: string; score?: number; publishedDate?: string }
export interface SearchParams {
  query: string; topic?: 'general' | 'news'; timeRange?: 'day' | 'week' | 'month' | 'year';
  maxResults?: number; depth?: 'basic' | 'advanced' | 'fast' | 'ultra-fast';
  includeDomains?: string[]; excludeDomains?: string[];
}

const str = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : '');

/**
 * Tavily adapter (REST, Bearer auth): POST /search and POST /extract. No retry: calls are billed in credits and
 * a retry would multiply cost. Results are public web data; the cache is per-process and keyed by exact params.
 */
@Injectable()
export class TavilyService {
  private readonly cache = new TtlCache<TavilyHit[]>(200);
  constructor(private readonly config: ConfigService, private readonly metrics: MetricsService) {}

  isConfigured(): boolean { return !!this.config.get('tavilyEnabled') && !!this.config.get('tavilyApiKey'); }
  private key(): string {
    if (!this.isConfigured()) throw new ProviderError('tavily', 'not_configured', 'tavily is disabled or not configured');
    return this.config.get<string>('tavilyApiKey')!;
  }
  private get timeout() { return this.config.get<number>('tavilyTimeoutMs') ?? 15000; }

  async search(p: SearchParams): Promise<{ hits: TavilyHit[]; cached: boolean }> {
    const key = this.key();
    const query = p.query.trim().slice(0, 400);
    if (query.length < 2) throw new ProviderError('tavily', 'invalid_request', 'query too short');
    const body = {
      query, topic: p.topic ?? 'general', search_depth: p.depth ?? this.config.get('tavilySearchDepth') ?? 'basic',
      max_results: Math.min(Math.max(p.maxResults ?? this.config.get<number>('tavilyMaxResults') ?? 5, 1), 10),
      include_answer: false, include_raw_content: false,
      ...(p.timeRange ? { time_range: p.timeRange } : {}),
      ...(p.includeDomains?.length ? { include_domains: p.includeDomains.slice(0, 20) } : {}),
      ...(p.excludeDomains?.length ? { exclude_domains: p.excludeDomains.slice(0, 20) } : {}),
    };
    const cacheKey = JSON.stringify(body);
    const hit = this.cache.get(cacheKey);
    if (hit) { this.metrics.inc('aurex_tavily_cache_total', { result: 'hit' }); return { hits: hit, cached: true }; }

    const hits = await this.metrics.track('tavily', 'search', async () => {
      const res = await fetchWithTimeout('tavily', `${BASE}/search`, {
        method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      }, this.timeout);
      assertOk('tavily', res, kindFromStatus);
      return this.parseResults(await this.json(res));
    });
    // Fresh topics are cached briefly; evergreen queries use the configured TTL.
    const fresh = p.topic === 'news' || p.timeRange === 'day' || p.timeRange === 'week';
    const ttl = (this.config.get<number>('tavilyCacheTtlSeconds') ?? 600) * 1000;
    this.cache.set(cacheKey, hits, fresh ? Math.min(ttl, 120_000) : ttl);
    this.metrics.inc('aurex_tavily_cache_total', { result: 'miss' });
    return { hits, cached: false };
  }

  /** Extracts page content for URLs that came from search results (never from raw user input). */
  async extract(urls: string[], query?: string): Promise<Array<{ url: string; content: string }>> {
    const key = this.key();
    const safe = urls.filter(u => { try { const x = new URL(u); return x.protocol === 'https:' || x.protocol === 'http:'; } catch { return false; } }).slice(0, 5);
    if (!safe.length) return [];
    return this.metrics.track('tavily', 'extract', async () => {
      const res = await fetchWithTimeout('tavily', `${BASE}/extract`, {
        method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ urls: safe, extract_depth: 'basic', format: 'markdown', ...(query ? { query: query.slice(0, 400), chunks_per_source: 3 } : {}) }),
      }, this.timeout);
      assertOk('tavily', res, kindFromStatus);
      const json = await this.json(res) as { results?: Array<{ url?: unknown; raw_content?: unknown }> };
      if (!Array.isArray(json.results)) throw new ProviderError('tavily', 'bad_response', 'tavily extract returned no results array');
      return json.results.map(r => ({ url: str(r.url, 2048), content: str(r.raw_content, 20000) })).filter(r => r.url && r.content);
    });
  }

  private async json(res: Response): Promise<unknown> {
    try { return await res.json(); } catch { throw new ProviderError('tavily', 'bad_response', 'tavily returned invalid JSON'); }
  }
  private parseResults(json: unknown): TavilyHit[] {
    const results = (json as { results?: unknown })?.results;
    if (!Array.isArray(results)) throw new ProviderError('tavily', 'bad_response', 'tavily search returned no results array');
    return results.map((r: Record<string, unknown>) => ({
      url: str(r.url, 2048), title: str(r.title, 300), content: str(r.content, 2000),
      score: typeof r.score === 'number' ? r.score : undefined, publishedDate: str(r.published_date, 40) || undefined,
    })).filter(h => h.url && /^https?:\/\//i.test(h.url));
  }
}
