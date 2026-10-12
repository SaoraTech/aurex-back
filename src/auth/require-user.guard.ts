import { CanActivate, ExecutionContext, Injectable, UnauthorizedException, Inject } from '@nestjs/common';
import { fromNodeHeaders } from 'better-auth/node';
import { AUTH } from './auth.constants';

@Injectable()
export class RequireUserGuard implements CanActivate {
  constructor(@Inject(AUTH) private readonly auth: any) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    const session = await this.auth.api.getSession({ headers: fromNodeHeaders(req.headers) });
    if (!session?.user?.id) throw new UnauthorizedException('Authentication required');
    req.aurexUser = { id: session.user.id, email: session.user.email, name: session.user.name };
    return true;
  }
}
