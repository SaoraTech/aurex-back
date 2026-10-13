import type { NextFunction, Request, Response } from 'express';
import { ArcjetService } from './arcjet.service';

/**
 * Express-level protection for the Better Auth routes (/api/auth/*), which are served outside Nest's router
 * and therefore cannot use guards. Sign-up gets the strictest policy.
 */
export function authProtection(security: ArcjetService) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const url = req.originalUrl ?? req.url ?? '';
      const category = /\/sign-up/i.test(url) ? 'signup' : 'auth';
      const verdict = await security.decide(req, category);
      if (verdict.allowed) return next();
      if (verdict.retryAfterSeconds) res.setHeader('Retry-After', String(verdict.retryAfterSeconds));
      const status = verdict.status ?? 403;
      res.status(status).json({
        statusCode: status, code: verdict.code ?? 'REQUEST_BLOCKED',
        message: status === 429 ? 'Trop de requêtes. Réessayez dans quelques instants.' : 'Requête refusée.',
        requestId: (req as Request & { requestId?: string }).requestId,
      });
    } catch (error) { next(error); }
  };
}
