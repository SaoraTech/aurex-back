import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { assertOk, fetchWithTimeout } from '../common/http';
import { ProviderError, kindFromStatus } from '../common/provider-error';
import { TtlCache } from '../common/ttl-cache';
import { MetricsService } from '../observability/metrics.service';

const BASE = 'https://api.search.brave.com/res/v1/llm/context';
export interface BraveHit { url: string; title: string; content: string; publishedDate?: string }
export interface BraveSearchParams {
  query: string;
  topic?: 'general' | 'news';
  timeRange?: 'day' | 'week' | 'month' | 'year';
  maxResults?: number;
}
const str = (v: unknown, max: number) => typeof v === 'string' ? v.slice(0, max) : '';
const FRESHNESS: Record<string, string> = { day: 'pd', week: 'pw', month: 'pm', year: 'py' };

@Injectable()
export class BraveSearchService {
  private readonly cache = new TtlCache<BraveHit[]>(200);
  constructor(private readonly config: ConfigService, private readonly metrics: MetricsService) {}

  isConfigured(): boolean {
    return this.config.get('braveSearchEnabled') === true || this.config.get('braveSearchEnabled') === 'true'
      ? !!this.config.get('braveSearchApiKey') : false;
  }

  private key(): string {
    if (!this.isConfigured()) throw new ProviderError('brave_search', 'not_configured', 'Brave Search is disabled or not configured');
    return this.config.get<string>('braveSearchApiKey')!;
  }

  async search(p: BraveSearchParams): Promise<{ hits: BraveHit[]; cached: boolean }> {
    const key = this.key();
    const query = p.query.trim().slice(0, 400);
    if (query.length < 2) throw new ProviderError('brave_search', 'invalid_request', 'query too short');
    const maxResults = Math.min(Math.max(p.maxResults ?? 5, 1), 10);
    const freshness = p.timeRange ? FRESHNESS[p.timeRange] : p.topic === 'news' ? 'pw' : undefined;
    const body: Record<string, unknown> = {
      q: query,
      search_lang: this.config.get<string>('braveSearchLanguage') ?? 'fr',
      count: maxResults,
      maximum_number_of_urls: maxResults,
      maximum_number_of_tokens: this.config.get<number>('braveSearchMaxTokens') ?? 8192,
      context_threshold_mode: 'balanced',
      safesearch: 'moderate',
      enable_source_metadata: true,
      ...(freshness ? { freshness } : {}),
      ...(this.config.get<string>('braveSearchCountry') ? { country: this.config.get<string>('braveSearchCountry') } : {}),
    };
    const cacheKey = JSON.stringify(body);
    const cached = this.cache.get(cacheKey);
    if (cached) {
      this.metrics.inc('aurex_brave_search_cache_total', { result: 'hit' });
      return { hits: cached, cached: true };
    }

    const hits = await this.metrics.track('brave_search', 'search', async () => {
      const res = await fetchWithTimeout('brave_search', BASE, {
        method: 'POST',
        headers: {
          'X-Subscription-Token': key,
          'Content-Type': 'application/json',
          Accept: 'application/json',
          'Accept-Encoding': 'gzip',
        },
        body: JSON.stringify(body),
      }, this.config.get<number>('braveSearchTimeoutMs') ?? 30000);
      assertOk('brave_search', res, kindFromStatus);
      return this.parseResults(await this.json(res));
    });

    const ttl = this.config.get<number>('braveSearchCacheTtlSeconds') ?? 600;
    this.cache.set(cacheKey, hits, freshness ? Math.min(ttl, 120000) : ttl * 1000);
    this.metrics.inc('aurex_brave_search_cache_total', { result: 'miss' });
    return { hits, cached: false };
  }

  private async json(res: Response): Promise<unknown> {
    try { return await res.json(); }
    catch { throw new ProviderError('brave_search', 'bad_response', 'Brave Search returned invalid JSON'); }
  }

  private parseResults(value: unknown): BraveHit[] {
    const root = value as {
      grounding?: { generic?: unknown[] };
      sources?: Record<string, { age?: unknown[]; title?: unknown }>;
    };
    const generic = root?.grounding?.generic;
    if (!Array.isArray(generic)) throw new ProviderError('brave_search', 'bad_response', 'Brave Search returned no grounding array');
    return generic.map((entry: any) => {
      const url = str(entry?.url, 2048);
      const metadata = root.sources?.[url];
      const age = Array.isArray(metadata?.age) ? metadata.age : [];
      const publishedDate = str(age[1], 40) || str(age[3], 40) || undefined;
      const snippets = Array.isArray(entry?.snippets) ? entry.snippets : [];
      return {
        url,
        title: str(entry?.title, 300) || str(metadata?.title, 300) || url,
        content: snippets.map((s: unknown) => str(s, 8000)).filter(Boolean).join('\n\n').slice(0, 12000),
        publishedDate,
      };
    }).filter(hit => /^https?:\/\//i.test(hit.url) && hit.content.length > 0);
  }
}
