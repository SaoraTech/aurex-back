import { validateEnv } from './env';

export const envFactory = () => {
  const env = validateEnv(process.env);
  return {
    nodeEnv: env.NODE_ENV,
    port: env.PORT,
    logLevel: env.LOG_LEVEL,
    swaggerEnabled: env.SWAGGER_ENABLED,
    databaseUrl: env.DATABASE_URL,
    adminEmails: (env.ADMIN_EMAILS ?? '')
      .split(',')
      .map(e => e.trim().toLowerCase())
      .filter(Boolean),
    groqApiKey: env.GROQ_API_KEY,
    groqLlmModel: env.GROQ_MODEL ?? env.GROQ_LLM_MODEL,
    sagemathServiceUrl: env.SAGEMATH_SERVICE_URL,
    sagemathApiKey: env.SAGEMATH_API_KEY,
    sagemathTimeoutMs: env.SAGEMATH_TIMEOUT_MS,
    elevenLabsApiKey: env.ELEVENLABS_API_KEY,
    elevenLabsTtsVoiceId: env.ELEVENLABS_VOICE_ID ?? env.ELEVENLABS_TTS_VOICE_ID,
    elevenLabsEnabled: env.ELEVENLABS_ENABLED,
    elevenLabsTtsOutputFormat: env.ELEVENLABS_TTS_OUTPUT_FORMAT,
    elevenLabsMaxTextChars: env.ELEVENLABS_MAX_TEXT_CHARS,
    audioMaxUploadBytes: env.AUDIO_MAX_UPLOAD_BYTES,
    audioDefaultLanguage: env.AUDIO_DEFAULT_LANGUAGE,
    jemenipayApiKey: env.JEMENIPAY_API_KEY,
    jemenipaySecretKey: env.JEMENIPAY_SECRET_KEY,
    jemenipayWebhookSecret: env.JEMENIPAY_WEBHOOK_SECRET,
    jemenipayEnv: env.JEMENIPAY_ENV,
    arcjetKey: env.ARCJET_KEY,
    arcjetMode: env.ARCJET_MODE,
    r2Enabled: env.R2_ENABLED,
    r2AccountId: env.R2_ACCOUNT_ID,
    r2Bucket: env.R2_BUCKET,
    r2AccessKeyId: env.R2_ACCESS_KEY_ID,
    r2SecretAccessKey: env.R2_SECRET_ACCESS_KEY,
    tavilyEnabled: env.TAVILY_ENABLED,
    tavilyApiKey: env.TAVILY_API_KEY,
    researchMaxSearches: env.RESEARCH_MAX_SEARCHES,
    researchMaxExtracts: env.RESEARCH_MAX_EXTRACTS,
    researchDeadlineMs: env.RESEARCH_DEADLINE_MS,
  };
};

export default envFactory;
