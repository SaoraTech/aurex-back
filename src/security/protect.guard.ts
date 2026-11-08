import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request, Response } from 'express';
import { AppException } from '../common/errors';
import { RequireUserGuard } from '../auth/require-user.guard';
import { ArcjetService, SecurityVerdict } from './arcjet.service';
import { POLICIES, ProtectCategory } from './arcjet.policies';
import { PROTECT_KEY } from './protect.decorator';

/**
 * Global guard: unauthenticated traffic to user-scoped endpoints first passes a coarse IP gate,
 * preventing invalid Bearer/cookie floods from reaching Better Auth and Neon. The route-specific
 * policy then applies its verified-user and IP budgets.
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
    if (policy.scope === 'user') {
      const preAuth = await this.security.decide(req, 'preauth');
      this.assertAllowed(preAuth, http.getResponse<Response>());
    }

    let userId: string | undefined;
    if (policy.scope === 'user') userId = (await this.users.resolve(req)).id;

    const verdict = await this.security.decide(req, category, userId);
    this.assertAllowed(verdict, http.getResponse<Response>());
    return true;
  }

  private assertAllowed(verdict: SecurityVerdict, response: Response) {
    if (verdict.allowed) return;
    const messages = {
      RATE_LIMITED: 'Trop de requêtes. Réessayez dans quelques instants.',
      BOT_DETECTED: 'Requête automatisée refusée.',
      REQUEST_BLOCKED: 'Requête refusée.',
      SECURITY_UNAVAILABLE: 'Protection de sécurité momentanément indisponible. Réessayez plus tard.',
    } as const;
    if (verdict.retryAfterSeconds) response.setHeader('Retry-After', String(verdict.retryAfterSeconds));
    throw new AppException(verdict.status ?? 403, verdict.code ?? 'REQUEST_BLOCKED', messages[verdict.code ?? 'REQUEST_BLOCKED'], undefined, verdict.retryAfterSeconds);
  }
}
