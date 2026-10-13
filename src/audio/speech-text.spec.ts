import { normalizeForSpeech } from './speech-text';
describe('normalizeForSpeech', () => {
  it('verbalises fractions and powers in French', () => {
    expect(normalizeForSpeech('$\\frac{1}{2}$ et x^2', 'fr')).toContain('1 sur 2');
    expect(normalizeForSpeech('x^2', 'fr')).toContain('au carré');
  });
  it('verbalises in English', () => { expect(normalizeForSpeech('\\frac{a}{b}', 'en')).toContain('a over b'); });
  it('removes code blocks and markdown noise', () => {
    const out = normalizeForSpeech('Voici ```code``` **gras** [lien](http://x.y)', 'fr');
    expect(out).not.toContain('```'); expect(out).not.toContain('http'); expect(out).toContain('lien');
  });
  it('keeps the power of a variable', () => { expect(normalizeForSpeech('x^n', 'fr')).toContain('puissance n'); });
});
