import { z } from 'zod';

const bool = z.enum(['true', 'false']).default('false');
const optStr = z.string().optional();
const DEFAULT_LIMITS = '{"free":{"dailyMessages":20,"monthlyMessages":300,"maxFileBytes":5000000,"maxStorageBytes":50000000,"dailyWebSearches":5,"dailyDeepResearch":1,"dailySpeechChars":5000,"dailyTranscriptions":5},"plus":{"dailyMessages":100,"monthlyMessages":3000,"maxFileBytes":25000000,"maxStorageBytes":500000000,"dailyWebSearches":30,"dailyDeepResearch":5,"dailySpeechChars":30000,"dailyTranscriptions":30},"pro":{"dailyMessages":300,"monthlyMessages":10000,"maxFileBytes":100000000,"maxStorageBytes":5000000000,"dailyWebSearches":100,"dailyDeepResearch":20,"dailySpeechChars":100000,"dailyTranscriptions":100}}';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  SWAGGER_ENABLED: z.enum(['true', 'false']).optional(),
  DATABASE_URL: z.string().min(1),
  BETTER_AUTH_SECRET: z.string().min(32),
  BETTER_AUTH_URL: z.string().url(),
  TRUSTED_ORIGINS: z.string().default(''),
  CORS_ORIGIN: z.string().default(''),
  /** Comma-separated IPs/CIDRs of reverse proxies / load balancers allowed to set X-Forwarded-For. */
  TRUSTED_PROXIES: z.string().default(''),
  METRICS_TOKEN: optStr,

  // --- Arcjet ---
  ARCJET_KEY: optStr,
  ARCJET_MODE: z.enum(['live', 'dry_run', 'disabled']).optional(),
  ARCJET_ALLOW_DISABLED_IN_PRODUCTION: bool,
  ARCJET_BOT_ALLOW: z.string().default('CATEGORY:PROGRAMMATIC'),
  ARCJET_FAIL_MODE: z.enum(['local', 'deny']).default('local'),

  // --- LLM providers ---
  AI_TIMEOUT_MS: z.coerce.number().int().min(1000).max(180000).default(45000),
  AI_MAX_FALLBACKS: z.coerce.number().int().min(0).max(3).default(1),
  GEMINI_API_KEY: optStr,
  GEMINI_MODEL: z.string().default('gemini-2.5-flash'),
  GROQ_API_KEY: optStr,
  GROQ_MODEL: z.string().default('llama-3.3-70b-versatile'),
  GROQ_BASE_URL: z.string().url().default('https://api.groq.com/openai/v1'),
  KIMI_API_KEY: optStr, KIMI_MODEL: z.string().default('moonshot-v1-8k'),
  KIMI_BASE_URL: z.string().url().default('https://api.moonshot.ai/v1'),
  QWEN_API_KEY: optStr, QWEN_MODEL: z.string().default('qwen-plus'),
  QWEN_BASE_URL: z.string().url().default('https://dashscope-intl.aliyuncs.com/compatible-mode/v1'),
  DEEPSEEK_API_KEY: optStr, DEEPSEEK_MODEL: z.string().default('deepseek-chat'),
  DEEPSEEK_BASE_URL: z.string().url().default('https://api.deepseek.com/v1'),
  GROK_API_KEY: optStr, GROK_MODEL: z.string().default('grok-3-mini'),
  GROK_BASE_URL: z.string().url().default('https://api.x.ai/v1'),

  // --- Voice: ElevenLabs (primary) + Groq (secondary) ---
  ELEVENLABS_ENABLED: bool,
  ELEVENLABS_API_KEY: optStr,
  ELEVENLABS_TTS_VOICE_ID: optStr,
  ELEVENLABS_TTS_MODEL_ID: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/).default('eleven_multilingual_v2'),
  ELEVENLABS_TTS_OUTPUT_FORMAT: z.string().regex(/^mp3_[0-9]+_[0-9]+$/, 'only mp3_* formats are supported').default('mp3_44100_128'),
  ELEVENLABS_STT_MODEL_ID: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/).default('scribe_v2'),
  ELEVENLABS_TIMEOUT_MS: z.coerce.number().int().min(1000).max(120000).default(30000),
  ELEVENLABS_MAX_TEXT_CHARS: z.coerce.number().int().min(1).max(20000).default(5000),
  AUDIO_DEFAULT_LANGUAGE: z.string().regex(/^[a-z]{2,3}$/).default('fr'),
  AUDIO_STT_PROVIDER: z.enum(['elevenlabs', 'groq']).default('elevenlabs'),
  AUDIO_STT_FALLBACK_PROVIDER: z.enum(['none', 'groq']).default('groq'),
  AUDIO_TTS_FALLBACK_PROVIDER: z.enum(['none', 'groq']).default('none'),
  AUDIO_MAX_UPLOAD_BYTES: z.coerce.number().int().min(1024).max(52428800).default(20971520),
  GROQ_SPEECH_ENABLED: bool,
  GROQ_STT_MODEL: z.string().default('whisper-large-v3-turbo'),
  GROQ_TTS_MODEL: z.string().default('playai-tts'),
  GROQ_TTS_VOICE: z.string().default('Fritz-PlayAI'),
  GROQ_SPEECH_TIMEOUT_MS: z.coerce.number().int().min(1000).max(120000).default(30000),

  // --- Cloudflare R2 (private object storage) ---
  R2_ENABLED: bool,
  R2_ACCOUNT_ID: optStr, R2_BUCKET: optStr, R2_ACCESS_KEY_ID: optStr, R2_SECRET_ACCESS_KEY: optStr,
  /** Optional override (e.g. EU jurisdiction: https://<account>.eu.r2.cloudflarestorage.com). */
  R2_ENDPOINT: z.string().url().optional().or(z.literal('')),
  R2_PRESIGNED_URL_TTL_SECONDS: z.coerce.number().int().min(30).max(3600).default(300),
  R2_TIMEOUT_MS: z.coerce.number().int().min(1000).max(120000).default(30000),
  /** Hard server-side ceiling for one upload held in memory; plan limits are capped by it. */
  UPLOAD_MAX_BYTES: z.coerce.number().int().min(1024).max(104857600).default(26214400),

  // --- Tavily (web search / research) ---
  TAVILY_ENABLED: bool,
  TAVILY_API_KEY: optStr,
  TAVILY_TIMEOUT_MS: z.coerce.number().int().min(1000).max(60000).default(15000),
  TAVILY_SEARCH_DEPTH: z.enum(['basic', 'advanced', 'fast', 'ultra-fast']).default('basic'),
  TAVILY_MAX_RESULTS: z.coerce.number().int().min(1).max(10).default(5),
  TAVILY_CACHE_TTL_SECONDS: z.coerce.number().int().min(0).max(3600).default(600),
  RESEARCH_MAX_SEARCHES: z.coerce.number().int().min(1).max(10).default(5),
  RESEARCH_MAX_EXTRACTS: z.coerce.number().int().min(0).max(5).default(3),
  RESEARCH_DEADLINE_MS: z.coerce.number().int().min(5000).max(180000).default(60000),

  WOLFRAM_APP_ID: optStr,
  NOVU_API_KEY: optStr, NOVU_APP_IDENTIFIER: optStr, NOVU_API_URL: z.string().url().default('https://api.novu.co'), RESEND_API_KEY: optStr,
  ADMIN_EMAILS: z.string().default(''),
  QUOTA_POLICIES_JSON: optStr,
  PAYMENT_PROVIDER: z.enum(['disabled', 'intouch', 'cinetpay', 'paytech', 'custom']).default('disabled'),
  PAYMENT_WEBHOOK_SECRET: optStr,
  PAYMENT_RETURN_URL: z.string().url().optional(),
  PLAN_LIMITS_JSON: z.string().default(DEFAULT_LIMITS),
  PLAN_PRICES_JSON: z.string().default('{"free":0,"plus":1500,"pro":3000}'),
}).superRefine((v, ctx) => {
  const need = (cond: boolean, path: string, message: string) => { if (!cond) ctx.addIssue({ code: 'custom', path: [path], message }); };
  if (v.ELEVENLABS_ENABLED === 'true') {
    need(!!v.ELEVENLABS_API_KEY, 'ELEVENLABS_API_KEY', 'Required when ELEVENLABS_ENABLED=true');
    need(!!v.ELEVENLABS_TTS_VOICE_ID && /^[A-Za-z0-9_-]{1,128}$/.test(v.ELEVENLABS_TTS_VOICE_ID), 'ELEVENLABS_TTS_VOICE_ID', 'Required (alphanumeric) when ELEVENLABS_ENABLED=true');
  }
  if (v.GROQ_SPEECH_ENABLED === 'true') need(!!v.GROQ_API_KEY, 'GROQ_API_KEY', 'Required when GROQ_SPEECH_ENABLED=true');
  if (v.AUDIO_STT_PROVIDER === 'groq') need(v.GROQ_SPEECH_ENABLED === 'true', 'GROQ_SPEECH_ENABLED', 'Required when AUDIO_STT_PROVIDER=groq');
  if (v.R2_ENABLED === 'true') {
    for (const k of ['R2_ACCOUNT_ID', 'R2_BUCKET', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY'] as const) need(!!v[k], k, 'Required when R2_ENABLED=true');
  }
  if (v.TAVILY_ENABLED === 'true') need(!!v.TAVILY_API_KEY, 'TAVILY_API_KEY', 'Required when TAVILY_ENABLED=true');
  const mode = v.ARCJET_MODE ?? (v.ARCJET_KEY ? 'live' : 'disabled');
  if (mode !== 'disabled') need(!!v.ARCJET_KEY, 'ARCJET_KEY', 'Required when ARCJET_MODE is live or dry_run');
  if (v.NODE_ENV === 'production' && mode === 'disabled') {
    need(v.ARCJET_ALLOW_DISABLED_IN_PRODUCTION === 'true', 'ARCJET_MODE',
      'Arcjet must be active in production (set ARCJET_KEY) or explicitly acknowledged with ARCJET_ALLOW_DISABLED_IN_PRODUCTION=true');
  }
});
export type Env = z.infer<typeof schema>;

export function validateEnv(): Env {
  const result = schema.safeParse(process.env);
  if (!result.success) {
    console.error('Invalid environment configuration:', JSON.stringify(result.error.flatten().fieldErrors));
    throw new Error('Invalid environment configuration');
  }
  try {
    JSON.parse(result.data.PLAN_LIMITS_JSON);
    JSON.parse(result.data.PLAN_PRICES_JSON);
  } catch {
    throw new Error('PLAN_LIMITS_JSON and PLAN_PRICES_JSON must be valid JSON');
  }
  Object.assign(process.env, Object.fromEntries(Object.entries(result.data).filter(([, v]) => v !== undefined).map(([k, v]) => [k, String(v)])));
  return result.data;
}
