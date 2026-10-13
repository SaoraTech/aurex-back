import { ProviderError } from '../common/provider-error';
import { AiOrchestratorService } from './ai-orchestrator.service';

const ok = (provider: string) => jest.fn().mockResolvedValue({ text: 'ok', provider, model: 'm' });
const build = (opts: { gemini?: jest.Mock; compatible?: jest.Mock; configured?: string[]; maxFallbacks?: number } = {}) => {
  const configured = opts.configured ?? ['kimi', 'qwen', 'deepseek', 'grok', 'gemini', 'groq'];
  const registry = { llmLabel: (id: string) => id, isLlmConfigured: (id: string) => configured.includes(id) } as any;
  const config = { get: (k: string) => (k === 'aiMaxFallbacks' ? opts.maxFallbacks ?? 1 : undefined) } as any;
  const gemini = { generate: opts.gemini ?? ok('gemini') } as any;
  const compatible = { generate: opts.compatible ?? ok('groq') } as any;
  return { service: new AiOrchestratorService(gemini, compatible, registry, config), gemini, compatible };
};
const msgs = [{ role: 'user' as const, content: 'hi' }];

describe('AiOrchestratorService model policy', () => {
  it('exposes four Free models', () => expect(build().service.listModels('free')).toHaveLength(4));
  it('exposes Gemini and Groq for Plus/Pro', () => {
    const { service } = build();
    expect(service.listModels('plus').map(m => m.id)).toEqual(['gemini', 'groq']);
    expect(service.listModels('pro').map(m => m.id)).toEqual(['gemini', 'groq']);
  });
  it('rejects a paid model for Free without calling any provider', async () => {
    const { service, gemini } = build();
    await expect(service.generate('free', msgs, 'gemini')).rejects.toMatchObject({ status: 400 });
    expect(gemini.generate).not.toHaveBeenCalled();
  });
});

describe('AiOrchestratorService fallback', () => {
  it('falls back from Gemini to Groq on a provider outage and reports it', async () => {
    const gemini = jest.fn().mockRejectedValue(new ProviderError('gemini', 'unavailable', 'x', 503));
    const { service, compatible } = build({ gemini });
    const r = await service.generate('plus', msgs);
    expect(r.provider).toBe('groq'); expect(r.fallbackFrom).toBe('gemini');
    expect(compatible.generate).toHaveBeenCalledTimes(1);
  });
  it('does NOT fall back on an invalid request (no second billed call)', async () => {
    const gemini = jest.fn().mockRejectedValue(new ProviderError('gemini', 'invalid_request', 'x', 400));
    const { service, compatible } = build({ gemini });
    await expect(service.generate('plus', msgs)).rejects.toMatchObject({ status: 400 });
    expect(compatible.generate).not.toHaveBeenCalled();
  });
  it('skips unconfigured providers and does not count them as attempts', async () => {
    const { service, gemini } = build({ configured: ['groq'] });
    const r = await service.generate('plus', msgs);
    expect(r.provider).toBe('groq'); expect(gemini.generate).not.toHaveBeenCalled(); expect(r.fallbackFrom).toBe('gemini');
  });
  it('honours AI_MAX_FALLBACKS=0', async () => {
    const gemini = jest.fn().mockRejectedValue(new ProviderError('gemini', 'timeout', 'x'));
    const { service, compatible } = build({ gemini, maxFallbacks: 0 });
    await expect(service.generate('plus', msgs)).rejects.toMatchObject({ status: 504 });
    expect(compatible.generate).not.toHaveBeenCalled();
  });
  it('reports a clear 503 when nothing is configured', async () => {
    const { service } = build({ configured: [] });
    await expect(service.generate('free', msgs)).rejects.toMatchObject({ status: 503 });
  });
});
