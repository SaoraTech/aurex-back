import { validateEnv } from './env';
export const envFactory=()=>{
 const env=validateEnv(process.env);
 return {
  nodeEnv:env.NODE_ENV,port:env.PORT,logLevel:env.LOG_LEVEL,swaggerEnabled:env.SWAGGER_ENABLED,databaseUrl:env.DATABASE_URL,
  adminEmails:(env.ADMIN_EMAILS??'').split(',').map(e=>e.trim().toLowerCase()).filter(Boolean),
  trustedOrigins:(env.TRUSTED_ORIGINS??'').split(',').map(e=>e.trim()).filter(Boolean),
  corsOrigin:env.CORS_ORIGIN??'',trustedProxies:(env.TRUSTED_PROXIES??'').split(',').map(e=>e.trim()).filter(Boolean),
  groqApiKey:env.GROQ_API_KEY,groqLlmModel:env.GROQ_MODEL??env.GROQ_LLM_MODEL,
  azureSpeechEnabled:env.AZURE_SPEECH_ENABLED,azureSpeechKey:env.AZURE_SPEECH_KEY,
  azureSpeechRegion:env.AZURE_SPEECH_REGION,azureSpeechResourceName:env.AZURE_SPEECH_RESOURCE_NAME,
  azureSpeechTimeoutMs:env.AZURE_SPEECH_TIMEOUT_MS,azureSpeechMaxTextChars:env.AZURE_SPEECH_MAX_TEXT_CHARS,
  azureSpeechTtsVoiceFr:env.AZURE_SPEECH_TTS_VOICE_FR,azureSpeechTtsVoiceEn:env.AZURE_SPEECH_TTS_VOICE_EN,
  azureSpeechTtsOutputFormat:env.AZURE_SPEECH_TTS_OUTPUT_FORMAT,audioMaxUploadBytes:env.AUDIO_MAX_UPLOAD_BYTES,
  audioDefaultLanguage:env.AUDIO_DEFAULT_LANGUAGE,
  jemenipayApiKey:env.JEMENIPAY_API_KEY,jemenipaySecretKey:env.JEMENIPAY_SECRET_KEY,
  jemenipayWebhookSecret:env.JEMENIPAY_WEBHOOK_SECRET,jemenipayEnv:env.JEMENIPAY_ENV,
  novuApiKey:env.NOVU_API_KEY,novuApiUrl:env.NOVU_API_URL,novuAppIdentifier:env.NOVU_APP_IDENTIFIER,
  arcjetKey:env.ARCJET_KEY,arcjetMode:env.ARCJET_MODE,r2Enabled:env.R2_ENABLED,r2AccountId:env.R2_ACCOUNT_ID,
  r2Bucket:env.R2_BUCKET,r2AccessKeyId:env.R2_ACCESS_KEY_ID,r2SecretAccessKey:env.R2_SECRET_ACCESS_KEY,
  braveSearchEnabled:env.BRAVE_SEARCH_ENABLED,braveSearchApiKey:env.BRAVE_SEARCH_API_KEY,
  braveSearchTimeoutMs:env.BRAVE_SEARCH_TIMEOUT_MS,braveSearchMaxTokens:env.BRAVE_SEARCH_MAX_TOKENS,
  braveSearchLanguage:env.BRAVE_SEARCH_LANGUAGE,braveSearchCountry:env.BRAVE_SEARCH_COUNTRY,
  researchMaxSearches:env.RESEARCH_MAX_SEARCHES,researchDeadlineMs:env.RESEARCH_DEADLINE_MS,
 };
};
export default envFactory;
