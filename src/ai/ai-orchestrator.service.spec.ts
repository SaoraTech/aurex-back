import { BadRequestException } from '@nestjs/common';
import { AiOrchestratorService } from './ai-orchestrator.service';

describe('AiOrchestratorService model policy', () => {
  const gemini = { generate: jest.fn().mockResolvedValue({ text: 'ok', provider: 'gemini', model: 'test' }) } as any;
  const compatible = { generate: jest.fn().mockResolvedValue({ text: 'ok', provider: 'groq', model: 'test' }) } as any;
  const service = new AiOrchestratorService(gemini, compatible);

  it('exposes four Free models', () => expect(service.listModels('free')).toHaveLength(4));
  it('exposes Gemini and Groq for Plus/Pro', () => {
    expect(service.listModels('plus').map(m => m.id)).toEqual(['gemini', 'groq']);
    expect(service.listModels('pro').map(m => m.id)).toEqual(['gemini', 'groq']);
  });
  it('rejects a paid model for Free', async () => {
    await expect(service.generate('free', [{ role: 'user', content: 'hi' }], 'gemini')).rejects.toBeInstanceOf(BadRequestException);
  });
});
