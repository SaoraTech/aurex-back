import { validateEnv } from './env';
const base={DATABASE_URL:'postgres://x',BETTER_AUTH_SECRET:'x'.repeat(32),BETTER_AUTH_URL:'http://localhost:3000'};
const saved={...process.env};
function withEnv(env:Record<string,string>){process.env={...saved,...base,...env} as any;}
afterEach(()=>{process.env={...saved};});
describe('validateEnv',()=>{
 it('accepts minimal development config with Azure Speech and Brave Search disabled',()=>{withEnv({NODE_ENV:'development'});const env=validateEnv();expect(env.AZURE_SPEECH_ENABLED).toBe('false');expect(env.BRAVE_SEARCH_ENABLED).toBe('false');});
 it('requires Azure Speech key, region and resource name when enabled',()=>{
  withEnv({AZURE_SPEECH_ENABLED:'true'});expect(()=>validateEnv()).toThrow();
  withEnv({AZURE_SPEECH_ENABLED:'true',AZURE_SPEECH_KEY:'key',AZURE_SPEECH_REGION:'eastus',AZURE_SPEECH_RESOURCE_NAME:'aurex-speech'});
  expect(validateEnv().AZURE_SPEECH_ENABLED).toBe('true');
 });
 it('requires R2 credentials when enabled',()=>{withEnv({R2_ENABLED:'true',R2_BUCKET:'b'});expect(()=>validateEnv()).toThrow();});
 it('requires Brave Search key when enabled',()=>{withEnv({BRAVE_SEARCH_ENABLED:'true'});expect(()=>validateEnv()).toThrow();});
 it('accepts Brave Search credentials and validates its context budget',()=>{withEnv({BRAVE_SEARCH_ENABLED:'true',BRAVE_SEARCH_API_KEY:'brave-test'});expect(validateEnv().BRAVE_SEARCH_ENABLED).toBe('true');withEnv({BRAVE_SEARCH_MAX_TOKENS:'99999'});expect(()=>validateEnv()).toThrow();});
 it('refuses production without Arcjet unless explicitly acknowledged',()=>{
  withEnv({NODE_ENV:'production'});expect(()=>validateEnv()).toThrow();
  withEnv({NODE_ENV:'production',ARCJET_ALLOW_DISABLED_IN_PRODUCTION:'true'});expect(()=>validateEnv()).not.toThrow();
  withEnv({NODE_ENV:'production',ARCJET_KEY:'ajkey_x'});expect(()=>validateEnv()).not.toThrow();
 });
 it('rejects unsupported Azure Speech output formats',()=>{withEnv({AZURE_SPEECH_TTS_OUTPUT_FORMAT:'raw-header-value'});expect(()=>validateEnv()).toThrow();});
 it('rejects invalid PLAN_LIMITS_JSON',()=>{withEnv({PLAN_LIMITS_JSON:'{nope'});expect(()=>validateEnv()).toThrow();});
});
