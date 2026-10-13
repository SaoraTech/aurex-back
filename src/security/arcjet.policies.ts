/**
 * Central, documented protection policy. Limits depend on cost, sensitivity and operation type.
 * `scope: 'user'` => authenticated route, limits keyed by the verified user id (plus an IP ceiling).
 * `scope: 'ip'`   => public route, limits keyed by client IP (an IP is NOT a reliable identity: shared NAT
 *                    networks exist; limits here are deliberately generous and combined with Shield/bot rules).
 * `onError`: what happens when Arcjet cannot decide (outage/timeout/config error):
 *   'local' => enforce the in-process limiter (degraded mode, never "allow everything");
 *   'allow' => low-risk reads only.
 * Bot detection: native mobile clients use HTTP libraries (OkHttp, URLSession...). They are treated as
 * `CATEGORY:PROGRAMMATIC` and allowed by default (ARCJET_BOT_ALLOW); scrapers/headless/crawlers are denied.
 */
export type ProtectCategory =
  | 'exempt' | 'default' | 'public' | 'signup' | 'auth'
  | 'read' | 'chat' | 'math' | 'research' | 'deep_research' | 'tts' | 'stt' | 'upload' | 'files';

export interface RateRule { intervalSeconds: number; max: number }
export interface CategoryPolicy {
  scope: 'ip' | 'user' | 'none';
  shield: boolean;
  bot: boolean;
  ipLimit?: RateRule;
  userLimit?: RateRule;
  onError: 'local' | 'allow';
}

export const POLICIES: Record<ProtectCategory, CategoryPolicy> = {
  exempt:        { scope: 'none', shield: false, bot: false, onError: 'allow' },
  default:       { scope: 'ip',   shield: true,  bot: true,  ipLimit: { intervalSeconds: 60, max: 90 }, onError: 'local' },
  public:        { scope: 'ip',   shield: true,  bot: true,  ipLimit: { intervalSeconds: 60, max: 120 }, onError: 'allow' },
  signup:        { scope: 'ip',   shield: true,  bot: true,  ipLimit: { intervalSeconds: 600, max: 8 }, onError: 'local' },
  auth:          { scope: 'ip',   shield: true,  bot: true,  ipLimit: { intervalSeconds: 60, max: 20 }, onError: 'local' },
  read:          { scope: 'user', shield: true,  bot: false, userLimit: { intervalSeconds: 60, max: 120 }, ipLimit: { intervalSeconds: 60, max: 300 }, onError: 'allow' },
  files:         { scope: 'user', shield: true,  bot: false, userLimit: { intervalSeconds: 60, max: 60 }, ipLimit: { intervalSeconds: 60, max: 200 }, onError: 'allow' },
  chat:          { scope: 'user', shield: true,  bot: false, userLimit: { intervalSeconds: 60, max: 10 }, ipLimit: { intervalSeconds: 60, max: 60 }, onError: 'local' },
  math:          { scope: 'user', shield: true,  bot: false, userLimit: { intervalSeconds: 60, max: 20 }, ipLimit: { intervalSeconds: 60, max: 80 }, onError: 'local' },
  research:      { scope: 'user', shield: true,  bot: false, userLimit: { intervalSeconds: 60, max: 10 }, ipLimit: { intervalSeconds: 60, max: 40 }, onError: 'local' },
  deep_research: { scope: 'user', shield: true,  bot: false, userLimit: { intervalSeconds: 600, max: 5 }, ipLimit: { intervalSeconds: 600, max: 15 }, onError: 'local' },
  tts:           { scope: 'user', shield: true,  bot: false, userLimit: { intervalSeconds: 60, max: 10 }, ipLimit: { intervalSeconds: 60, max: 40 }, onError: 'local' },
  stt:           { scope: 'user', shield: true,  bot: false, userLimit: { intervalSeconds: 60, max: 10 }, ipLimit: { intervalSeconds: 60, max: 40 }, onError: 'local' },
  upload:        { scope: 'user', shield: true,  bot: false, userLimit: { intervalSeconds: 60, max: 10 }, ipLimit: { intervalSeconds: 60, max: 30 }, onError: 'local' },
};
