import { CanActivate, ExecutionContext, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { fromNodeHeaders } from 'better-auth/node';
import { AUTH } from './auth.constants';
import { CurrentUser } from './current-user.decorator';

@Injectable()
export class RequireUserGuard implements CanActivate {
  constructor(@Inject(AUTH) private readonly auth: any) {}

  /** Resolves (once per request) the authenticated user from the Better Auth session (cookie or Bearer token). */
  async resolve(req: { headers: Record<string, any>; aurexUser?: CurrentUser }): Promise<CurrentUser> {
    if (req.aurexUser?.id) return req.aurexUser;
    // Cheap pre-check: unauthenticated floods must not cost a database round trip.
    if (!req.headers['authorization'] && !req.headers['cookie']) throw new UnauthorizedException({ code: 'UNAUTHENTICATED', message: 'Authentication required' });
    const session = await this.auth.api.getSession({ headers: fromNodeHeaders(req.headers) });
    if (!session?.user?.id) throw new UnauthorizedException({ code: 'UNAUTHENTICATED', message: 'Authentication required' });
    req.aurexUser = { id: session.user.id, email: session.user.email, name: session.user.name };
    return req.aurexUser;
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    await this.resolve(context.switchToHttp().getRequest());
    return true;
  }
}
