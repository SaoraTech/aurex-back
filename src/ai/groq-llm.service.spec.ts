import { ConfigService } from '@nestjs/config';
import { GroqLlmService } from './groq-llm.service';

describe('GroqLlmService streaming', () => {
  let service: GroqLlmService;
  beforeEach(() => {
    const config = {
      get: jest.fn((key: string) => key === 'groqApiKey' ? 'test-key' : 'openai/gpt-oss-120b'),
    } as unknown as ConfigService;
    service = new GroqLlmService(config);
  });

  afterEach(() => jest.restoreAllMocks());

  it('streams incremental text and includes provider usage metadata', async () => {
    const events = [
      { choices: [{ delta: { content: 'Bonjour' } }] },
      { choices: [{ delta: { content: ' Aurex' } }] },
      { choices: [], usage: { prompt_tokens: 3, completion_tokens: 2 } },
    ];
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const event of events) {
          controller.enqueue(new TextEncoder().encode('data: ' + JSON.stringify(event) + '\n\n'));
        }
        controller.enqueue(new TextEncoder().encode('data: [DONE]\n\n'));
        controller.close();
      },
    });
    const fetchMock = jest.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(stream, { status: 200 }));
    const deltas: string[] = [];

    const result = await service.generate(
      [{ role: 'user', content: 'Bonjour' }],
      { onToken: (delta) => deltas.push(delta) },
    );

    expect(result.text).toBe('Bonjour Aurex');
    expect(result.tokens).toBe(5);
    expect(deltas).toEqual(['Bonjour', ' Aurex']);
    const request = JSON.parse(fetchMock.mock.calls[0][1]?.body as string);
    expect(request).toMatchObject({ stream: true, stream_options: { include_usage: true } });
  });
});
