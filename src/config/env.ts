import { z } from 'zod';

const bool = z.enum(['true', 'false']).default('false');

function isIpOrCidr(value: string): boolean {
  // IPv4 or IPv4/CIDR
  const ipv4 = /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}(\/(3[0-2]|[12]?\d))?$/;
  if (ipv4.test(value)) return true;
  // IPv6 (simplified) or IPv6/CIDR
  const ipv6 = /^[0-9a-fA-F:]+(\/(12[0-8]|1[01]\d|\d{1,2}))?$/;
  if (value.includes(':') && ipv6.test(value)) return true;
  return false;
}
const optStr = z.string().optional();

const DEFAULT_LIMITS =
  '{"free":{"dailyMessages":20,"monthlyMessages":300,"dailyWebSearches":5,"dailyDeepResearch":1},"plus":{"dailyMessages":100,"monthlyMessages":3000,"dailyWebSearches":30,"dailyDeepResearch":5},"pro":{"dailyMessages":300,"monthlyMessages":10000,"dailyWebSearches":100,"dailyDeepResearch":20}}';

export const EnvSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().positive().default(3000),
    LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
    SWAGGER_ENABLED: z.enum(['true', 'false']).optional(),
    DATABASE_URL: z.string().min(1).default('postgresql://localhost:5432/saora'),
    BETTER_AUTH_SECRET: z.string().min(32).default('a'.repeat(32)),
    BETTER_AUTH_URL: z.string().url().default('http://localhost:3000'),

    // Administrator Emails (comma-separated: e.g. "admin@saora.tech,fdiallo@saora.tech")
    ADMIN_EMAILS: z.string().optional().default(''),

    // Groq LLM (sole provider)
    GROQ_API_KEY: optStr,
    GROQ_MODEL: optStr,
    GROQ_LLM_MODEL: z.string().default('openai/gpt-oss-120b'),

    // SageMath (Computational Engine)
    SAGEMATH_SERVICE_URL: optStr,
    SAGEMATH_API_KEY: optStr,
    SAGEMATH_TIMEOUT_MS: z.coerce.number().optional().default(15000),

    // Audio (ElevenLabs only)
    ELEVENLABS_ENABLED: bool,
    ELEVENLABS_API_KEY: optStr,
    ELEVENLABS_VOICE_ID: optStr,
    ELEVENLABS_TTS_VOICE_ID: optStr,
    ELEVENLABS_TTS_MODEL_ID: z.string().default('eleven_multilingual_v2'),
    ELEVENLABS_TTS_OUTPUT_FORMAT: z
      .string()
      .regex(/^mp3_[0-9]+_[0-9]+$/, 'only mp3_* formats are supported')
      .default('mp3_44100_128'),
    ELEVENLABS_MAX_TEXT_CHARS: z.coerce.number().default(5000),
    AUDIO_MAX_UPLOAD_BYTES: z.coerce.number().default(20971520),
    AUDIO_DEFAULT_LANGUAGE: z.string().default('fr'),

    // Jɛmɛnipay (Mali)
    JEMENIPAY_API_KEY: optStr,
    JEMENIPAY_SECRET_KEY: optStr,
    JEMENIPAY_WEBHOOK_SECRET: optStr,
    JEMENIPAY_ENV: z.enum(['sandbox', 'live']).default('sandbox'),

    // Security & Arcjet
    ARCJET_KEY: optStr,
    ARCJET_MODE: z.enum(['live', 'dry_run', 'disabled']).optional(),
    ARCJET_ALLOW_DISABLED_IN_PRODUCTION: bool,

    // Cloudflare R2
    R2_ENABLED: bool,
    R2_ACCOUNT_ID: optStr,
    R2_BUCKET: optStr,
    R2_ACCESS_KEY_ID: optStr,
    R2_SECRET_ACCESS_KEY: optStr,

    // Research
    TAVILY_ENABLED: bool,
    TAVILY_API_KEY: optStr,
    RESEARCH_MAX_SEARCHES: z.coerce.number().default(5),
    RESEARCH_MAX_EXTRACTS: z.coerce.number().default(3),
    RESEARCH_DEADLINE_MS: z.coerce.number().default(60000),

    // Plan limits JSON
    PLAN_LIMITS_JSON: z.string().default(DEFAULT_LIMITS),
    PLAN_PRICES_JSON: z.string().default('{"free":0,"plus":5000,"pro":10000,"plus_promo":1500,"pro_promo":3000}'),

    // CORS & trusted origins/proxies
    TRUSTED_ORIGINS: z.string().optional().default(''),
    CORS_ORIGIN: z.string().optional().default(''),
    TRUSTED_PROXIES: z.string().optional().default(''),
  })
  .superRefine((v, ctx) => {
    const need = (cond: boolean, path: string, message: string) => {
      if (!cond) ctx.addIssue({ code: 'custom', path: [path], message });
    };

    if (v.ELEVENLABS_ENABLED === 'true') {
      need(!!v.ELEVENLABS_API_KEY, 'ELEVENLABS_API_KEY', 'Required when ELEVENLABS_ENABLED=true');
      const voiceId = v.ELEVENLABS_TTS_VOICE_ID ?? v.ELEVENLABS_VOICE_ID;
      need(
        !!voiceId && /^[A-Za-z0-9_-]{1,128}$/.test(voiceId),
        'ELEVENLABS_TTS_VOICE_ID',
        'Required (alphanumeric) when ELEVENLABS_ENABLED=true',
      );
    }

    if (v.R2_ENABLED === 'true') {
      for (const k of ['R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY'] as const) {
        need(!!v[k], k, 'Required when R2_ENABLED=true');
      }
    }

    if (v.TAVILY_ENABLED === 'true') {
      need(!!v.TAVILY_API_KEY, 'TAVILY_API_KEY', 'Required when TAVILY_ENABLED=true');
    }

    const mode = v.ARCJET_MODE ?? (v.ARCJET_KEY ? 'live' : 'disabled');
    if (mode !== 'disabled') {
      need(!!v.ARCJET_KEY, 'ARCJET_KEY', 'Required when ARCJET_MODE is live or dry_run');
    }

    if (v.NODE_ENV === 'production' && mode === 'disabled') {
      need(
        v.ARCJET_ALLOW_DISABLED_IN_PRODUCTION === 'true',
        'ARCJET_MODE',
        'Arcjet must be active in production (set ARCJET_KEY) or explicitly acknowledged with ARCJET_ALLOW_DISABLED_IN_PRODUCTION=true',
      );
    }

    // CORS safety: never allow wildcard origin.
    const origins = (v.CORS_ORIGIN ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    for (const o of origins) {
      if (o === '*') {
        ctx.addIssue({ code: 'custom', path: ['CORS_ORIGIN'], message: 'Wildcard CORS origin is not allowed' });
      } else {
        try {
          new URL(o);
        } catch {
          ctx.addIssue({ code: 'custom', path: ['CORS_ORIGIN'], message: `Invalid CORS origin: ${o}` });
        }
      }
    }

    // Trusted origins (Better Auth) validation.
    const trustedOrigins = (v.TRUSTED_ORIGINS ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    for (const o of trustedOrigins) {
      try {
        new URL(o);
      } catch {
        ctx.addIssue({ code: 'custom', path: ['TRUSTED_ORIGINS'], message: `Invalid trusted origin: ${o}` });
      }
    }

    // Trusted proxies must be valid IP addresses or CIDR ranges.
    const proxies = (v.TRUSTED_PROXIES ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    for (const p of proxies) {
      if (!isIpOrCidr(p)) {
        ctx.addIssue({ code: 'custom', path: ['TRUSTED_PROXIES'], message: `Invalid trusted proxy: ${p}` });
      }
    }
  });

export type Env = z.infer<typeof EnvSchema>;

export function validateEnv(raw?: Record<string, unknown>): Env {
  const target = raw ?? process.env;
  const result = EnvSchema.safeParse(target);
  if (!result.success) {
    console.error(
      'Invalid environment configuration:',
      JSON.stringify(result.error.flatten().fieldErrors),
    );
    throw new Error('Invalid environment configuration');
  }
  try {
    JSON.parse(result.data.PLAN_LIMITS_JSON);
    JSON.parse(result.data.PLAN_PRICES_JSON);
  } catch {
    throw new Error('PLAN_LIMITS_JSON and PLAN_PRICES_JSON must be valid JSON');
  }
  return result.data;
}
