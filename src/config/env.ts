import { z } from 'zod';
const bool = z.enum(['true', 'false']).default('false');
function isIpOrCidr(value: string): boolean {
  const ipv4 = /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}(\/(3[0-2]|[12]?\d))?$/;
  if (ipv4.test(value)) return true;
  const ipv6 = /^[0-9a-fA-F:]+(\/(12[0-8]|1[01]\d|\d{1,2}))?$/;
  return value.includes(':') && ipv6.test(value);
}
const optStr = z.string().optional();
const DEFAULT_LIMITS = '{"free":{"dailyMessages":20,"monthlyMessages":300,"dailyWebSearches":5,"dailyDeepResearch":1},"plus":{"dailyMessages":100,"monthlyMessages":3000,"dailyWebSearches":30,"dailyDeepResearch":5},"pro":{"dailyMessages":300,"monthlyMessages":10000,"dailyWebSearches":100,"dailyDeepResearch":20}}';
export const EnvSchema = z.object({
  NODE_ENV: z.enum(['development','test','production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  LOG_LEVEL: z.enum(['debug','info','warn','error']).default('info'),
  SWAGGER_ENABLED: z.enum(['true','false']).optional(),
  DATABASE_URL: z.string().min(1).default('postgresql://localhost:5432/saora'),
  BETTER_AUTH_SECRET: z.string().min(32).default('a'.repeat(32)),
  BETTER_AUTH_URL: z.string().url().default('http://localhost:3000'),
  ADMIN_EMAILS: z.string().optional().default(''),
  GROQ_API_KEY: optStr, GROQ_MODEL: optStr, GROQ_LLM_MODEL: z.string().default('openai/gpt-oss-120b'),
  SAGEMATH_SERVICE_URL: optStr, SAGEMATH_API_KEY: optStr, SAGEMATH_TIMEOUT_MS: z.coerce.number().optional().default(15000),
  AZURE_SPEECH_ENABLED: bool,
  AZURE_SPEECH_KEY: optStr, AZURE_SPEECH_REGION: optStr, AZURE_SPEECH_RESOURCE_NAME: optStr,
  AZURE_SPEECH_TIMEOUT_MS: z.coerce.number().int().positive().default(30000),
  AZURE_SPEECH_MAX_TEXT_CHARS: z.coerce.number().int().positive().default(5000),
  AZURE_SPEECH_TTS_VOICE_FR: z.string().default('fr-FR-DeniseNeural'),
  AZURE_SPEECH_TTS_VOICE_EN: z.string().default('en-US-JennyNeural'),
  AZURE_SPEECH_TTS_OUTPUT_FORMAT: z.string().regex(/^audio-(8|16|24|48)khz-[0-9]+kbitrate-mono-mp3$/).default('audio-16khz-128kbitrate-mono-mp3'),
  AUDIO_MAX_UPLOAD_BYTES: z.coerce.number().int().positive().default(20971520),
  AUDIO_DEFAULT_LANGUAGE: z.enum(['fr','en']).default('fr'),
  JEMENIPAY_API_KEY: optStr, JEMENIPAY_SECRET_KEY: optStr, JEMENIPAY_WEBHOOK_SECRET: optStr,
  JEMENIPAY_ENV: z.enum(['sandbox','live']).default('sandbox'),
  ARCJET_KEY: optStr, ARCJET_MODE: z.enum(['live','dry_run','disabled']).optional(),
  ARCJET_ALLOW_DISABLED_IN_PRODUCTION: bool,
  R2_ENABLED: bool, R2_ACCOUNT_ID: optStr, R2_BUCKET: optStr, R2_ACCESS_KEY_ID: optStr, R2_SECRET_ACCESS_KEY: optStr,
  TAVILY_ENABLED: bool, TAVILY_API_KEY: optStr,
  RESEARCH_MAX_SEARCHES: z.coerce.number().default(5), RESEARCH_MAX_EXTRACTS: z.coerce.number().default(3),
  RESEARCH_DEADLINE_MS: z.coerce.number().default(60000),
  PLAN_LIMITS_JSON: z.string().default(DEFAULT_LIMITS),
  PLAN_PRICES_JSON: z.string().default('{"free":0,"plus":5000,"pro":10000,"plus_promo":1500,"pro_promo":3000}'),
  TRUSTED_ORIGINS: z.string().optional().default(''), CORS_ORIGIN: z.string().optional().default(''),
  TRUSTED_PROXIES: z.string().optional().default(''),
}).superRefine((v,ctx)=>{
  const need=(cond:boolean,path:string,message:string)=>{if(!cond)ctx.addIssue({code:'custom',path:[path],message});};
  if(v.AZURE_SPEECH_ENABLED==='true'){
    need(!!v.AZURE_SPEECH_KEY,'AZURE_SPEECH_KEY','Required when AZURE_SPEECH_ENABLED=true');
    need(!!v.AZURE_SPEECH_REGION && /^[a-z0-9-]+$/i.test(v.AZURE_SPEECH_REGION),'AZURE_SPEECH_REGION','A valid Azure region is required when AZURE_SPEECH_ENABLED=true');
    need(!!v.AZURE_SPEECH_RESOURCE_NAME && /^[a-z0-9-]{2,64}$/i.test(v.AZURE_SPEECH_RESOURCE_NAME),'AZURE_SPEECH_RESOURCE_NAME','A valid Speech resource name is required when AZURE_SPEECH_ENABLED=true');
  }
  if(v.R2_ENABLED==='true') for(const k of ['R2_ACCOUNT_ID','R2_ACCESS_KEY_ID','R2_SECRET_ACCESS_KEY'] as const) need(!!v[k],k,'Required when R2_ENABLED=true');
  if(v.TAVILY_ENABLED==='true') need(!!v.TAVILY_API_KEY,'TAVILY_API_KEY','Required when TAVILY_ENABLED=true');
  const mode=v.ARCJET_MODE??(v.ARCJET_KEY?'live':'disabled');
  if(mode!=='disabled')need(!!v.ARCJET_KEY,'ARCJET_KEY','Required when ARCJET_MODE is live or dry_run');
  if(v.NODE_ENV==='production'&&mode==='disabled')need(v.ARCJET_ALLOW_DISABLED_IN_PRODUCTION==='true','ARCJET_MODE','Arcjet must be active in production or explicitly acknowledged');
  for(const o of (v.CORS_ORIGIN??'').split(',').map(s=>s.trim()).filter(Boolean)){
    if(o==='*')ctx.addIssue({code:'custom',path:['CORS_ORIGIN'],message:'Wildcard CORS origin is not allowed'});
    else try{new URL(o)}catch{ctx.addIssue({code:'custom',path:['CORS_ORIGIN'],message:\`Invalid CORS origin: \${o}\`});}
  }
  for(const o of (v.TRUSTED_ORIGINS??'').split(',').map(s=>s.trim()).filter(Boolean)){
    try{new URL(o)}catch{ctx.addIssue({code:'custom',path:['TRUSTED_ORIGINS'],message:\`Invalid trusted origin: \${o}\`});}
  }
  for(const p of (v.TRUSTED_PROXIES??'').split(',').map(s=>s.trim()).filter(Boolean))
    if(!isIpOrCidr(p))ctx.addIssue({code:'custom',path:['TRUSTED_PROXIES'],message:\`Invalid trusted proxy: \${p}\`});
});
export type Env=z.infer<typeof EnvSchema>;
export function validateEnv(raw?:Record<string,unknown>):Env{
  const result=EnvSchema.safeParse(raw??process.env);
  if(!result.success){console.error('Invalid environment configuration:',JSON.stringify(result.error.flatten().fieldErrors));throw new Error('Invalid environment configuration');}
  try{JSON.parse(result.data.PLAN_LIMITS_JSON);JSON.parse(result.data.PLAN_PRICES_JSON);}
  catch{throw new Error('PLAN_LIMITS_JSON and PLAN_PRICES_JSON must be valid JSON');}
  return result.data;
}
