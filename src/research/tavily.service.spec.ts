import { TavilyService } from './tavily.service';

const cfg = (o: Record<string, unknown> = {}) => ({ get: (k: string) => ({ tavilyEnabled: true, tavilyApiKey: 'tvly-test', tavilyTimeoutMs: 1000, tavilySearchDepth: 'basic', tavilyMaxResults: 5, tavilyCacheTtlSeconds: 600, ...o } as any)[k] }) as any;
const metrics: any = { track: (_p: string, _o: string, fn: () => Promise<unknown>) => fn(), inc: jest.fn() };
const okJson = (body: unknown) => ({ ok: true, status: 200, headers: { get: () => null }, json: async () => body }) as any;
const realFetch = global.fetch;
afterEach(() => { (global as any).fetch = realFetch; });

describe('TavilyService', () => {
  it('is unconfigured unless enabled and keyed', async () => {
    const s = new TavilyService(cfg({ tavilyEnabled: false }), metrics);
    expect(s.isConfigured()).toBe(false);
    await expect(s.search({ query: 'maths' })).rejects.toMatchObject({ kind: 'not_configured' });
  });
  it('calls /search with Bearer auth and parses results', async () => {
    const fetchMock = jest.fn().mockResolvedValue(okJson({ results: [{ url: 'https://a.test', title: 'A', content: 'c', score: 0.9 }, { url: 'ftp://bad', title: 'B', content: 'x' }] }));
    (global as any).fetch = fetchMock;
    const r = await new TavilyService(cfg(), metrics).search({ query: 'dérivée' });
    expect(r.hits).toHaveLength(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe('https://api.tavily.com/search');
    expect(init.headers.Authorization).toBe('Bearer tvly-test');
    expect(JSON.parse(init.body)).toMatchObject({ query: 'dérivée', include_answer: false });
  });
  it('caches identical searches (no second billed call)', async () => {
    const fetchMock = jest.fn().mockResolvedValue(okJson({ results: [{ url: 'https://a.test', title: 'A', content: 'c' }] }));
    (global as any).fetch = fetchMock;
    const s = new TavilyService(cfg(), metrics);
    await s.search({ query: 'même requête' }); const second = await s.search({ query: 'même requête' });
    expect(fetchMock).toHaveBeenCalledTimes(1); expect(second.cached).toBe(true);
  });
  it.each([[401, 'auth'], [429, 'rate_limited'], [432, 'quota'], [433, 'quota'], [422, 'invalid_request'], [503, 'unavailable']])('maps HTTP %s to %s without retrying', async (status, kind) => {
    const fetchMock = jest.fn().mockResolvedValue({ ok: false, status, headers: { get: () => null }, json: async () => ({}) });
    (global as any).fetch = fetchMock;
    await expect(new TavilyService(cfg(), metrics).search({ query: 'quelque chose' })).rejects.toMatchObject({ kind });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it('maps a timeout', async () => {
    (global as any).fetch = jest.fn().mockRejectedValue(Object.assign(new Error('t'), { name: 'TimeoutError' }));
    await expect(new TavilyService(cfg(), metrics).search({ query: 'timeout test' })).rejects.toMatchObject({ kind: 'timeout' });
  });
  it('rejects a malformed provider response', async () => {
    (global as any).fetch = jest.fn().mockResolvedValue(okJson({ nope: true }));
    await expect(new TavilyService(cfg(), metrics).search({ query: 'bad shape' })).rejects.toMatchObject({ kind: 'bad_response' });
  });
});
