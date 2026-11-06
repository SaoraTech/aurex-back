import { BraveSearchService } from './brave-search.service';

const cfg = (overrides: Record<string, unknown> = {}) => ({
  get: (key: string) => ({
    braveSearchEnabled: 'true', braveSearchApiKey: 'brave-test', braveSearchTimeoutMs: 1000,
    braveSearchMaxTokens: 8192, braveSearchLanguage: 'fr', braveSearchCountry: undefined,
    braveSearchCacheTtlSeconds: 600, ...overrides,
  } as any)[key],
}) as any;
const metrics: any = { track: (_p: string, _o: string, fn: () => Promise<unknown>) => fn(), inc: jest.fn() };
const response = (body: unknown) => ({ ok: true, status: 200, headers: { get: () => null }, json: async () => body }) as any;
const realFetch = global.fetch;
afterEach(() => { (global as any).fetch = realFetch; });

describe('BraveSearchService', () => {
  it('is disabled unless explicitly enabled and keyed', async () => {
    const service = new BraveSearchService(cfg({ braveSearchEnabled: 'false' }), metrics);
    expect(service.isConfigured()).toBe(false);
    await expect(service.search({ query: 'maths' })).rejects.toMatchObject({ kind: 'not_configured' });
  });

  it('calls the LLM Context endpoint with token auth and maps grounding sources', async () => {
    const payload = {
      grounding: { generic: [{ url: 'https://example.test/page', title: 'A title', snippets: ['first passage', 'second passage'] }] },
      sources: { 'https://example.test/page': { age: ['Today', '2026-11-06', 'today', '2026-11-06T08:00:00Z'] } },
    };
    const fetchMock = jest.fn().mockResolvedValue(response(payload));
    (global as any).fetch = fetchMock;
    const result = await new BraveSearchService(cfg(), metrics).search({ query: 'intégrales', timeRange: 'week' });
    expect(result.hits).toEqual([{
      url: 'https://example.test/page', title: 'A title',
      content: 'first passage\n\nsecond passage', publishedDate: '2026-11-06',
    }]);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe('https://api.search.brave.com/res/v1/llm/context');
    expect(init.headers['X-Subscription-Token']).toBe('brave-test');
    expect(JSON.parse(init.body)).toMatchObject({ q: 'intégrales', search_lang: 'fr', freshness: 'pw', maximum_number_of_tokens: 8192 });
  });

  it('caches identical queries without a second billed request', async () => {
    const fetchMock = jest.fn().mockResolvedValue(response({ grounding: { generic: [{ url: 'https://a.test', title: 'A', snippets: ['content'] }] }, sources: {} }));
    (global as any).fetch = fetchMock;
    const service = new BraveSearchService(cfg(), metrics);
    await service.search({ query: 'same query' });
    const second = await service.search({ query: 'same query' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(second.cached).toBe(true);
  });

  it.each([[401, 'auth'], [429, 'rate_limited'], [402, 'quota'], [422, 'invalid_request'], [503, 'unavailable']])(
    'maps HTTP %s to %s without retrying', async (status, kind) => {
      const fetchMock = jest.fn().mockResolvedValue({ ok: false, status, headers: { get: () => null }, json: async () => ({}) });
      (global as any).fetch = fetchMock;
      await expect(new BraveSearchService(cfg(), metrics).search({ query: 'test query' })).rejects.toMatchObject({ kind });
      expect(fetchMock).toHaveBeenCalledTimes(1);
    },
  );

  it('maps timeouts and malformed provider responses', async () => {
    (global as any).fetch = jest.fn().mockRejectedValue(Object.assign(new Error('timeout'), { name: 'TimeoutError' }));
    await expect(new BraveSearchService(cfg(), metrics).search({ query: 'timeout query' })).rejects.toMatchObject({ kind: 'timeout' });
    (global as any).fetch = jest.fn().mockResolvedValue(response({ grounding: {} }));
    await expect(new BraveSearchService(cfg(), metrics).search({ query: 'malformed response' })).rejects.toMatchObject({ kind: 'bad_response' });
  });
});
