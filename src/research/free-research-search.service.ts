import { Injectable } from '@nestjs/common';
import { fetchWithTimeout } from '../common/http';
import { ProviderError } from '../common/provider-error';
import { BraveSearchParams, BraveHit } from './brave-search.service';

const stripHtml = (value: string) => value.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ')
  .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ').trim().slice(0, 8000);
const decode = (value: string) => {
  try { return decodeURIComponent(value.replace(/\+/g, '%20')); } catch { return value; }
};
const validUrl = (value: string) => {
  try { const url = new URL(value); return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : undefined; }
  catch { return undefined; }
};

@Injectable()
export class FreeResearchSearchService {
  private readonly cache = new Map<string, { expiresAt: number; hits: BraveHit[] }>();

  async search(input: BraveSearchParams): Promise<{ hits: BraveHit[]; cached: boolean }> {
    const query = input.query.trim().slice(0, 300);
    if (query.length < 2) throw new ProviderError('free_research', 'invalid_request', 'query too short');
    const max = Math.min(Math.max(input.maxResults ?? 5, 1), 10);
    const key = query.toLocaleLowerCase() + ':' + max + ':' + (input.topic ?? 'general');
    const cached = this.cache.get(key);
    if (cached && cached.expiresAt > Date.now()) return { hits: cached.hits, cached: true };
    const results = await Promise.allSettled([
      this.duckDuckGo(query, max), this.wikipedia(query, max), this.crossref(query, Math.min(max, 4)),
    ]);
    const merged = new Map<string, BraveHit>();
    for (const result of results) {
      if (result.status !== 'fulfilled') continue;
      for (const hit of result.value) {
        const url = validUrl(hit.url);
        if (url && hit.content) merged.set(url, { ...hit, url });
      }
    }
    const hits = [...merged.values()].slice(0, max);
    if (!hits.length) throw new ProviderError('free_research', 'unavailable', 'Free research sources returned no results');
    this.cache.set(key, { hits, expiresAt: Date.now() + 5 * 60 * 1000 });
    if (this.cache.size > 150) { const first = this.cache.keys().next().value; if (first) this.cache.delete(first); }
    return { hits, cached: false };
  }

  private async duckDuckGo(query: string, max: number): Promise<BraveHit[]> {
    const response = await fetchWithTimeout('free_research', 'https://html.duckduckgo.com/html/?q=' + encodeURIComponent(query), {
      headers: { Accept: 'text/html', 'User-Agent': 'Mozilla/5.0 (compatible; AurexResearch/1.0)' },
    }, 12000);
    if (!response.ok) throw new ProviderError('free_research', 'unavailable', 'DuckDuckGo returned HTTP ' + response.status);
    const html = await response.text();
    const hits: BraveHit[] = [];
    const links = html.matchAll(/<a[^>]*class=["'][^"']*result__a[^"']*["'][^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi);
    for (const match of links) {
      let href = decode(match[1]);
      try { const parsed = new URL(href, 'https://duckduckgo.com'); const redirected = parsed.searchParams.get('uddg'); if (redirected) href = decode(redirected); }
      catch { continue; }
      const safe = validUrl(href), title = stripHtml(match[2]);
      if (!safe || !title) continue;
      const start = (match.index ?? 0) + match[0].length;
      const snippet = html.slice(start, start + 1600).match(/class=["'][^"']*result__snippet[^"']*["'][^>]*>([\s\S]*?)<\/(?:a|td|div)>/i);
      hits.push({ url: safe, title, content: stripHtml(snippet?.[1] ?? title) });
      if (hits.length >= max) break;
    }
    return hits;
  }

  private async wikipedia(query: string, max: number): Promise<BraveHit[]> {
    const params = new URLSearchParams({ action: 'query', list: 'search', srsearch: query, srlimit: String(max), format: 'json', origin: '*' });
    const response = await fetchWithTimeout('free_research', 'https://fr.wikipedia.org/w/api.php?' + params, { headers: { Accept: 'application/json' } }, 10000);
    if (!response.ok) throw new ProviderError('free_research', 'unavailable', 'Wikimedia returned HTTP ' + response.status);
    const data = await response.json() as any;
    return (data?.query?.search ?? []).map((item: any) => ({
      url: 'https://fr.wikipedia.org/?curid=' + encodeURIComponent(String(item.pageid)),
      title: stripHtml(String(item.title ?? '')), content: stripHtml(String(item.snippet ?? '')),
    })).filter((hit: BraveHit) => hit.title && hit.content);
  }

  private async crossref(query: string, max: number): Promise<BraveHit[]> {
    const params = new URLSearchParams({ 'query.bibliographic': query, rows: String(max), select: 'DOI,title,URL,abstract,published' });
    const response = await fetchWithTimeout('free_research', 'https://api.crossref.org/works?' + params, {
      headers: { Accept: 'application/json', 'User-Agent': 'AurexResearch/1.0' },
    }, 12000);
    if (!response.ok) throw new ProviderError('free_research', 'unavailable', 'Crossref returned HTTP ' + response.status);
    const data = await response.json() as any;
    return (data?.message?.items ?? []).map((item: any) => ({
      url: String(item.URL ?? (item.DOI ? 'https://doi.org/' + item.DOI : '')),
      title: stripHtml(String(item.title?.[0] ?? item.DOI ?? 'Publication scientifique')),
      content: stripHtml(String(item.abstract ?? item.title?.[0] ?? '')),
      publishedDate: item.published?.['date-parts']?.[0]?.join('-'),
    })).filter((hit: BraveHit) => validUrl(hit.url) && hit.content);
  }
}
