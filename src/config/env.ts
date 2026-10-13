import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().min(1),
  BETTER_AUTH_SECRET: z.string().min(32),
  BETTER_AUTH_URL: z.string().url(),
  TRUSTED_ORIGINS: z.string().default(''),
  CORS_ORIGIN: z.string().default(''),
  GEMINI_API_KEY: z.string().optional(),
  GEMINI_MODEL: z.string().default('gemini-2.5-flash'),
  GROQ_API_KEY: z.string().optional(),
  GROQ_MODEL: z.string().default('llama-3.3-70b-versatile'),
  GROQ_BASE_URL: z.string().url().default('https://api.groq.com/openai/v1'),
  KIMI_API_KEY: z.string().optional(),
  KIMI_MODEL: z.string().default('moonshot-v1-8k'),
  KIMI_BASE_URL: z.string().url().default('https://api.moonshot.ai/v1'),
  QWEN_API_KEY: z.string().optional(),
  QWEN_MODEL: z.string().default('qwen-plus'),
  QWEN_BASE_URL: z.string().url().default('https://dashscope-intl.aliyuncs.com/compatible-mode/v1'),
  DEEPSEEK_API_KEY: z.string().optional(),
  DEEPSEEK_MODEL: z.string().default('deepseek-chat'),
  DEEPSEEK_BASE_URL: z.string().url().default('https://api.deepseek.com/v1'),
  GROK_API_KEY: z.string().optional(),
  GROK_MODEL: z.string().default('grok-3-mini'),
  GROK_BASE_URL: z.string().url().default('https://api.x.ai/v1'),
  GROQ_STT_MODEL: z.string().default('whisper-large-v3-turbo'),
  GROQ_TTS_MODEL: z.string().default('playai-tts'),
  ELEVENLABS_API_KEY: z.string().optional(),
  ELEVENLABS_VOICE_ID: z.string().default('21m00Tcm4TlvDq8ikWAM'),
  ELEVENLABS_MODEL_ID: z.string().default('eleven_multilingual_v2'),
  ELEVENLABS_BASE_URL: z.string().url().default('https://api.elevenlabs.io/v1'),
  AUDIO_MAX_FILE_BYTES: z.coerce.number().int().positive().default(25_000_000),
  AUDIO_MAX_TTS_CHARS: z.coerce.number().int().positive().default(4000),
  WOLFRAM_APP_ID: z.string().optional(),
  NOVU_API_KEY: z.string().optional(),
  NOVU_APP_IDENTIFIER: z.string().optional(),
  RESEND_API_KEY: z.string().optional(),
  R2_ACCOUNT_ID: z.string().optional(),
  R2_ACCESS_KEY_ID: z.string().optional(),
  R2_SECRET_ACCESS_KEY: z.string().optional(),
  R2_BUCKET: z.string().optional(),
  R2_ENDPOINT: z.string().optional(),
  R2_PUBLIC_BASE_URL: z.string().optional(),
  PAYMENT_PROVIDER: z.enum(['disabled', 'intouch', 'cinetpay', 'paytech', 'custom']).default('disabled'),
  PAYMENT_WEBHOOK_SECRET: z.string().optional(),
  PAYMENT_RETURN_URL: z.string().url().optional(),
  PLAN_LIMITS_JSON: z.string().default('{"free":{"dailyMessages":20,"monthlyMessages":300,"maxFileBytes":5000000},"plus":{"dailyMessages":100,"monthlyMessages":3000,"maxFileBytes":25000000},"pro":{"dailyMessages":300,"monthlyMessages":10000,"maxFileBytes":100000000}}'),
  PLAN_PRICES_JSON: z.string().default('{"free":0,"plus":1500,"pro":3000}'),
});

export type Env = z.infer<typeof schema>;

export function validateEnv(): Env {
  const result = schema.safeParse(process.env);
  if (!result.success) {
    console.error('Invalid environment configuration:', result.error.flatten().fieldErrors);
    throw new Error('Invalid environment configuration');
  }
  try {
    JSON.parse(result.data.PLAN_LIMITS_JSON);
    JSON.parse(result.data.PLAN_PRICES_JSON);
  } catch {
    throw new Error('PLAN_LIMITS_JSON and PLAN_PRICES_JSON must be valid JSON');
  }
  Object.assign(process.env, result.data);
  return result.data;
}
