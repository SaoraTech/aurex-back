import { Inject, Injectable, Logger, OnModuleInit, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import { MetricsService } from '../observability/metrics.service';
import { LocalLimiter } from './local-limiter';
import { POLICIES, ProtectCategory } from './arcjet.policies';

/** Injection token to replace the SDK loader in tests. */
export const ARCJET_SDK_LOADER = Symbol('ARCJET_SDK_LOADER');
// @arcjet/* packages are ESM-only while this project compiles to CommonJS: a real dynamic import() that
// TypeScript will not rewrite into require().
const nativeImport = new Function('specifier', 'return import(specifier)') as (s: string) => Promise<any>;

/** Minimal structural types for the part of the Arcjet SDK we use (we do not trust a blind `any`). */
interface ArcjetDecisionLike {
  isDenied(): boolean; isErrored(): boolean; id?: string;
  reason: { isRateLimit?(): boolean; isBot?(): boolean; isShield?(): boolean; reset?: number };
}
interface ArcjetClientLike { protect(req: unknown, props?: Record<string, unknown>): Promise<ArcjetDecisionLike> }

export interface SecurityVerdict {
  allowed: boolean;
  status?: 403 | 429 | 503;
  code?: 'RATE_LIMITED' | 'BOT_DETECTED' | 'REQUEST_BLOCKED' | 'SECURITY_UNAVAILABLE';
  retryAfterSeconds?: number;
  source: 'arcjet' | 'local' | 'none';
  degraded?: boolean;
  decisionId?: string;
}

@Injectable()
export class ArcjetService implements OnModuleInit {
  private readonly logger = new Logger(ArcjetService.name);
  private readonly clients = new Map<ProtectCategory, ArcjetClientLike>();
  private readonly local = new LocalLimiter();
  private active = false;

  constructor(
    private readonly config: ConfigService,
    private readonly metrics: MetricsService,
    @Optional() @Inject(ARCJET_SDK_LOADER) private readonly loader: (s: string) => Promise<any> = nativeImport,
  ) {}

  get mode(): 'live' | 'dry_run' | 'disabled' { return this.config.get('arcjetMode') ?? 'disabled'; }
  get isActive(): boolean { return this.active; }

  async onModuleInit() {
    if (this.mode === 'disabled') {
      this.logger.warn({ msg: 'arcjet_disabled', detail: 'Only the in-process limiter protects this instance (no Shield, no bot detection).' });
      return;
    }
    const key = this.config.get<string>('arcjetKey');
    if (!key) throw new Error('ARCJET_KEY is required when ARCJET_MODE is live or dry_run');
    try {
      const mod = await this.loader('@arcjet/node');
      const arcjet = mod.default ?? mod.arcjet;
      const mode = this.mode === 'live' ? 'LIVE' : 'DRY_RUN';
      const proxies: string[] = this.config.get('trustedProxies') ?? [];
      const botAllow: string[] = this.config.get('arcjetBotAllow') ?? ['CATEGORY:PROGRAMMATIC'];
      for (const [category, p] of Object.entries(POLICIES) as [ProtectCategory, (typeof POLICIES)[ProtectCategory]][]) {
        if (p.scope === 'none') continue;
        const rules: unknown[] = [];
        if (p.shield) rules.push(mod.shield({ mode }));
        if (p.bot) rules.push(mod.detectBot({ mode, allow: botAllow }));
        if (p.ipLimit) rules.push(mod.slidingWindow({ mode, interval: p.ipLimit.intervalSeconds, max: p.ipLimit.max, characteristics: ['ip.src'] }));
        if (p.userLimit) rules.push(mod.slidingWindow({ mode, interval: p.userLimit.intervalSeconds, max: p.userLimit.max, characteristics: ['userId'] }));
        this.clients.set(category, arcjet({ key, rules, ...(proxies.length ? { proxies } : {}) }));
      }
      this.active = true;
      this.logger.log({ msg: 'arcjet_ready', mode: this.mode, categories: this.clients.size, trustedProxies: proxies.length });
    } catch (error) {
      // Configuration/installation error: never silently run unprotected in production.
      this.logger.error({ msg: 'arcjet_init_failed', error: (error as Error).message });
      if (this.config.get('nodeEnv') === 'production') throw new Error('Arcjet failed to initialise in production');
    }
  }

  /** Evaluates a request. Pure decision: the caller (guard/middleware) turns a verdict into an HTTP response. */
  async decide(req: Request, category: ProtectCategory, userId?: string): Promise<SecurityVerdict> {
    const policy = POLICIES[category];
    if (policy.scope === 'none') return { allowed: true, source: 'none' };
    const client = this.clients.get(category);
    if (!this.active || !client) return this.decideLocal(req, category, userId, false);

    let decision: ArcjetDecisionLike;
    try {
      decision = await client.protect(req, policy.scope === 'user' ? { userId: userId ?? 'anonymous' } : {});
    } catch (error) {
      this.metrics.inc('aurex_arcjet_decisions_total', { category, result: 'unavailable' });
      this.logger.error({ msg: 'arcjet_protect_threw', category, error: (error as Error).message });
      return this.onArcjetError(req, category, userId);
    }
    if (decision.isErrored()) {
      this.metrics.inc('aurex_arcjet_decisions_total', { category, result: 'error' });
      this.logger.error({ msg: 'arcjet_decision_error', category, decisionId: decision.id });
      return this.onArcjetError(req, category, userId);
    }
    if (decision.isDenied()) {
      const r = decision.reason;
      const rate = !!r.isRateLimit?.(); const bot = !!r.isBot?.();
      this.metrics.inc('aurex_arcjet_decisions_total', { category, result: rate ? 'rate_limited' : bot ? 'bot' : 'denied' });
      this.logger.warn({ msg: 'arcjet_denied', category, decisionId: decision.id, reason: rate ? 'rate_limit' : bot ? 'bot' : r.isShield?.() ? 'shield' : 'other' });
      if (rate) return { allowed: false, status: 429, code: 'RATE_LIMITED', retryAfterSeconds: Math.max(1, Math.ceil(r.reset ?? 30)), source: 'arcjet', decisionId: decision.id };
      return { allowed: false, status: 403, code: bot ? 'BOT_DETECTED' : 'REQUEST_BLOCKED', source: 'arcjet', decisionId: decision.id };
    }
    this.metrics.inc('aurex_arcjet_decisions_total', { category, result: 'allowed' });
    return { allowed: true, source: 'arcjet', decisionId: decision.id };
  }

  private onArcjetError(req: Request, category: ProtectCategory, userId?: string): SecurityVerdict {
    const policy = POLICIES[category];
    if (this.config.get('arcjetFailMode') === 'deny' && policy.onError === 'local') {
      return { allowed: false, status: 503, code: 'SECURITY_UNAVAILABLE', retryAfterSeconds: 10, source: 'arcjet', degraded: true };
    }
    if (policy.onError === 'allow') return { allowed: true, source: 'arcjet', degraded: true };
    return this.decideLocal(req, category, userId, true);
  }

  private decideLocal(req: Request, category: ProtectCategory, userId: string | undefined, degraded: boolean): SecurityVerdict {
    const policy = POLICIES[category];
    const ip = req.ip ?? req.socket?.remoteAddress ?? 'unknown';
    // In degraded mode keep a stricter budget than the nominal one.
    const factor = degraded ? 0.5 : 1;
    const checks: Array<[string, { intervalSeconds: number; max: number } | undefined]> = [
      [`ip:${category}:${ip}`, policy.ipLimit], [`user:${category}:${userId}`, userId ? policy.userLimit : undefined],
    ];
    for (const [key, rule] of checks) {
      if (!rule) continue;
      const r = this.local.hit(key, rule.intervalSeconds, Math.max(1, Math.floor(rule.max * factor)));
      if (!r.allowed) {
        this.metrics.inc('aurex_local_limiter_total', { category, result: 'rate_limited', degraded: String(degraded) });
        return { allowed: false, status: 429, code: 'RATE_LIMITED', retryAfterSeconds: r.retryAfterSeconds, source: 'local', degraded };
      }
    }
    return { allowed: true, source: 'local', degraded };
  }
}
