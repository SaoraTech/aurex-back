import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request, Response } from 'express';
import { AppException } from '../common/errors';
import { RequireUserGuard } from '../auth/require-user.guard';
import { ArcjetService } from './arcjet.service';
import { POLICIES, ProtectCategory } from './arcjet.policies';
import { PROTECT_KEY } from './protect.decorator';

/**
 * Global guard (APP_GUARD): every route goes through it. User-scoped categories authenticate the caller first
 * (so Arcjet/local limits are keyed by the verified user id, never by a client-supplied id), then evaluate
 * Shield / bot / rate-limit rules. Per-controller RequireUserGuard remains as defence in depth and reuses the
 * session resolved here.
 */
@Injectable()
export class ProtectGuard implements CanActivate {
  constructor(private readonly reflector: Reflector, private readonly security: ArcjetService, private readonly users: RequireUserGuard) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return true;
    const category = this.reflector.getAllAndOverride<ProtectCategory | undefined>(PROTECT_KEY, [context.getHandler(), context.getClass()]) ?? 'default';
    const policy = POLICIES[category];
    if (policy.scope === 'none') return true;

    const http = context.switchToHttp();
    const req = http.getRequest<Request & { aurexUser?: { id: string } }>();
    let userId: string | undefined;
    if (policy.scope === 'user') userId = (await this.users.resolve(req)).id;

    const verdict = await this.security.decide(req, category, userId);
    if (!verdict.allowed) {
      const messages = {
        RATE_LIMITED: 'Trop de requêtes. Réessayez dans quelques instants.',
        BOT_DETECTED: 'Requête automatisée refusée.',
        REQUEST_BLOCKED: 'Requête refusée.',
        SECURITY_UNAVAILABLE: 'Protection de sécurité momentanément indisponible. Réessayez plus tard.',
      } as const;
      const res = http.getResponse<Response>();
      if (verdict.retryAfterSeconds) res.setHeader('Retry-After', String(verdict.retryAfterSeconds));
      throw new AppException(verdict.status ?? 403, verdict.code ?? 'REQUEST_BLOCKED', messages[verdict.code ?? 'REQUEST_BLOCKED'], undefined, verdict.retryAfterSeconds);
    }
    return true;
  }
}
