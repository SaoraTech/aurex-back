const num = (v: string | undefined, d: number) => (v === undefined || v === '' ? d : Number(v));
const list = (v: string | undefined) => (v ?? '').split(',').map(s => s.trim()).filter(Boolean);
const flag = (v: string | undefined) => v === 'true';

export const envFactory = () => {
  const e = process.env;
  const arcjetMode = (e.ARCJET_MODE as 'live' | 'dry_run' | 'disabled' | undefined) ?? (e.ARCJET_KEY ? 'live' : 'disabled');
  return {
    port: num(e.PORT, 3000),
    nodeEnv: e.NODE_ENV ?? 'development',
    databaseUrl: e.DATABASE_URL,
    betterAuthSecret: e.BETTER_AUTH_SECRET,
    betterAuthUrl: e.BETTER_AUTH_URL,
    trustedOrigins: list(e.TRUSTED_ORIGINS),
    corsOrigin: e.CORS_ORIGIN ?? '',
    trustedProxies: list(e.TRUSTED_PROXIES),
    metricsToken: e.METRICS_TOKEN,

    arcjetKey: e.ARCJET_KEY, arcjetMode,
    arcjetBotAllow: list(e.ARCJET_BOT_ALLOW ?? 'CATEGORY:PROGRAMMATIC'),
    arcjetFailMode: (e.ARCJET_FAIL_MODE as 'local' | 'deny' | undefined) ?? 'local',

    aiTimeoutMs: num(e.AI_TIMEOUT_MS, 45000), aiMaxFallbacks: num(e.AI_MAX_FALLBACKS, 1),
    geminiApiKey: e.GEMINI_API_KEY, geminiModel: e.GEMINI_MODEL ?? 'gemini-2.5-flash',
    groqApiKey: e.GROQ_API_KEY, groqModel: e.GROQ_MODEL ?? 'llama-3.3-70b-versatile',
    groqBaseUrl: e.GROQ_BASE_URL ?? 'https://api.groq.com/openai/v1',
    kimiApiKey: e.KIMI_API_KEY, kimiModel: e.KIMI_MODEL ?? 'moonshot-v1-8k', kimiBaseUrl: e.KIMI_BASE_URL ?? 'https://api.moonshot.ai/v1',
    qwenApiKey: e.QWEN_API_KEY, qwenModel: e.QWEN_MODEL ?? 'qwen-plus', qwenBaseUrl: e.QWEN_BASE_URL ?? 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',
    deepseekApiKey: e.DEEPSEEK_API_KEY, deepseekModel: e.DEEPSEEK_MODEL ?? 'deepseek-chat', deepseekBaseUrl: e.DEEPSEEK_BASE_URL ?? 'https://api.deepseek.com/v1',
    grokApiKey: e.GROK_API_KEY, grokModel: e.GROK_MODEL ?? 'grok-3-mini', grokBaseUrl: e.GROK_BASE_URL ?? 'https://api.x.ai/v1',

    elevenLabsEnabled: flag(e.ELEVENLABS_ENABLED), elevenLabsApiKey: e.ELEVENLABS_API_KEY,
    elevenLabsTtsVoiceId: e.ELEVENLABS_TTS_VOICE_ID,
    elevenLabsTtsModelId: e.ELEVENLABS_TTS_MODEL_ID ?? 'eleven_multilingual_v2',
    elevenLabsTtsOutputFormat: e.ELEVENLABS_TTS_OUTPUT_FORMAT ?? 'mp3_44100_128',
    elevenLabsSttModelId: e.ELEVENLABS_STT_MODEL_ID ?? 'scribe_v2',
    elevenLabsTimeoutMs: num(e.ELEVENLABS_TIMEOUT_MS, 30000), elevenLabsMaxTextChars: num(e.ELEVENLABS_MAX_TEXT_CHARS, 5000),
    audioDefaultLanguage: e.AUDIO_DEFAULT_LANGUAGE ?? 'fr',
    audioSttProvider: (e.AUDIO_STT_PROVIDER as 'elevenlabs' | 'groq' | undefined) ?? 'elevenlabs',
    audioSttFallbackProvider: (e.AUDIO_STT_FALLBACK_PROVIDER as 'none' | 'groq' | undefined) ?? 'groq',
    audioTtsFallbackProvider: (e.AUDIO_TTS_FALLBACK_PROVIDER as 'none' | 'groq' | undefined) ?? 'none',
    audioMaxUploadBytes: num(e.AUDIO_MAX_UPLOAD_BYTES, 20971520),
    groqSpeechEnabled: flag(e.GROQ_SPEECH_ENABLED), groqSttModel: e.GROQ_STT_MODEL ?? 'whisper-large-v3-turbo',
    groqTtsModel: e.GROQ_TTS_MODEL ?? 'playai-tts', groqTtsVoice: e.GROQ_TTS_VOICE ?? 'Fritz-PlayAI',
    groqSpeechTimeoutMs: num(e.GROQ_SPEECH_TIMEOUT_MS, 30000),

    r2Enabled: flag(e.R2_ENABLED), r2AccountId: e.R2_ACCOUNT_ID, r2Bucket: e.R2_BUCKET,
    r2AccessKeyId: e.R2_ACCESS_KEY_ID, r2SecretAccessKey: e.R2_SECRET_ACCESS_KEY, r2Endpoint: e.R2_ENDPOINT || undefined,
    r2PresignedUrlTtlSeconds: num(e.R2_PRESIGNED_URL_TTL_SECONDS, 300), r2TimeoutMs: num(e.R2_TIMEOUT_MS, 30000),
    uploadMaxBytes: num(e.UPLOAD_MAX_BYTES, 26214400),

    tavilyEnabled: flag(e.TAVILY_ENABLED), tavilyApiKey: e.TAVILY_API_KEY,
    tavilyTimeoutMs: num(e.TAVILY_TIMEOUT_MS, 15000),
    tavilySearchDepth: (e.TAVILY_SEARCH_DEPTH as 'basic' | 'advanced' | 'fast' | 'ultra-fast' | undefined) ?? 'basic',
    tavilyMaxResults: num(e.TAVILY_MAX_RESULTS, 5), tavilyCacheTtlSeconds: num(e.TAVILY_CACHE_TTL_SECONDS, 600),
    researchMaxSearches: num(e.RESEARCH_MAX_SEARCHES, 5), researchMaxExtracts: num(e.RESEARCH_MAX_EXTRACTS, 3),
    researchDeadlineMs: num(e.RESEARCH_DEADLINE_MS, 60000),

    wolframAppId: e.WOLFRAM_APP_ID,
    novuApiKey: e.NOVU_API_KEY, novuAppIdentifier: e.NOVU_APP_IDENTIFIER,
    paymentProvider: e.PAYMENT_PROVIDER ?? 'disabled',
  };
};
