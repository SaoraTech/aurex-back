import { AurexIdentity, AUREX_FACTS } from './aurex-identity';

describe('AurexIdentity', () => {
  it('returns valid immutable official product facts', () => {
    const facts = AurexIdentity.getFacts();
    expect(facts.name).toBe('Aurex');
    expect(facts.organization).toBe('Saora');
    expect(facts.creator).toBe('Fousseyni DIALLO');
    expect(facts.nature).toContain('mathématiques');
  });

  it('builds a comprehensive system instruction maintaining Aurex identity', () => {
    const instruction = AurexIdentity.buildSystemInstruction({
      configuredProviders: ['Google Gemini', 'ElevenLabs', 'Cloudflare R2'],
      activeCapabilities: {
        mathEngine: true,
        audioTts: true,
        storage: true,
      },
      userCustomPreferences: 'Niveau Licence 2 Mathématiques, préfère les démonstrations rédigées.',
    });

    expect(instruction).toContain('Tu es Aurex');
    expect(instruction).toContain('Fousseyni DIALLO');
    expect(instruction).toContain('Saora');
    expect(instruction).toContain('LaTeX');
    expect(instruction).toContain('Wolfram|Alpha');
    expect(instruction).toContain('Licence 2');
    expect(instruction).toContain('ton identité reste uniquement Aurex');
  });
});
