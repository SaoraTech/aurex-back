import { validateEnv } from './env';

const base = { DATABASE_URL: 'postgres://x', BETTER_AUTH_SECRET: 'x'.repeat(32), BETTER_AUTH_URL: 'http://localhost:3000' };
const saved = { ...process.env };
function withEnv(env: Record<string, string>) { process.env = { ...saved, ...base, ...env } as any; }
afterEach(() => { process.env = { ...saved }; });

describe('validateEnv', () => {
  it('accepts a minimal development configuration', () => { withEnv({ NODE_ENV: 'development' }); expect(validateEnv().ELEVENLABS_ENABLED).toBe('false'); });
  it('requires ElevenLabs key and voice when enabled', () => { withEnv({ ELEVENLABS_ENABLED: 'true' }); expect(() => validateEnv()).toThrow(); });
  it('requires all R2 credentials when enabled', () => { withEnv({ R2_ENABLED: 'true', R2_BUCKET: 'b' }); expect(() => validateEnv()).toThrow(); });
  it('requires a Tavily key when enabled', () => { withEnv({ TAVILY_ENABLED: 'true' }); expect(() => validateEnv()).toThrow(); });
  it('refuses to start in production without Arcjet unless explicitly acknowledged', () => {
    withEnv({ NODE_ENV: 'production' }); expect(() => validateEnv()).toThrow();
    withEnv({ NODE_ENV: 'production', ARCJET_ALLOW_DISABLED_IN_PRODUCTION: 'true' }); expect(() => validateEnv()).not.toThrow();
    withEnv({ NODE_ENV: 'production', ARCJET_KEY: 'ajkey_x' }); expect(() => validateEnv()).not.toThrow();
  });
  it('rejects non-mp3 ElevenLabs output formats', () => { withEnv({ ELEVENLABS_TTS_OUTPUT_FORMAT: 'pcm_16000' }); expect(() => validateEnv()).toThrow(); });
  it('rejects invalid PLAN_LIMITS_JSON', () => { withEnv({ PLAN_LIMITS_JSON: '{nope' }); expect(() => validateEnv()).toThrow(); });
});
