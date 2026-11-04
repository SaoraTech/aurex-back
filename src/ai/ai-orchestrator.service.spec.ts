import { ProviderError } from '../common/provider-error';
import { AiOrchestratorService } from './ai-orchestrator.service';

function build(o: { groq?: Partial<any> } = {}) {
  const groq: any = {
    isEnabled: () => true,
    getModel: () => 'openai/gpt-oss-120b',
    generate: jest.fn().mockResolvedValue({
      text: 'Calcul exact',
      provider: 'groq',
      model: 'openai/gpt-oss-120b',
      tokens: 42,
      latencyMs: 120,
    }),
    ...o.groq,
  };
  const usage: any = { record: jest.fn().mockResolvedValue(undefined) };
  return { svc: new AiOrchestratorService(groq, usage), groq, usage };
}

describe('AiOrchestratorService (Groq-only)', () => {
  it('routes calls to Groq without client model override', async () => {
    const { svc, groq, usage } = build();
    const res = await svc.generate('free', [{ role: 'user', content: '2+2' }], undefined, {}, 'req-1', 'user-1');
    expect(res.provider).toBe('groq');
    expect(res.text).toBe('Calcul exact');
    expect(groq.generate).toHaveBeenCalledTimes(1);
    expect(usage.record).toHaveBeenCalledWith(
      expect.objectContaining({ provider: 'groq', outcome: 'ok', units: 42 }),
    );
  });

  it('translates Groq errors into appropriate HTTP exceptions', async () => {
    const { svc } = build({
      groq: {
        generate: jest.fn().mockRejectedValue(new ProviderError('groq', 'timeout', 'Groq timeout')),
      },
    });
    await expect(svc.generate('free', [{ role: 'user', content: 'test' }])).rejects.toMatchObject({
      status: 504,
    });
  });
});
