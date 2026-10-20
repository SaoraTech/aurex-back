import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RequireUserGuard } from './require-user.guard';

@Injectable()
export class RequireAdminGuard implements CanActivate {
  constructor(
    private readonly users: RequireUserGuard,
    private readonly config: ConfigService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    const user = await this.users.resolve(req);
    const adminEmails = this.config.get<string[]>('adminEmails') ?? [];

    if (!user.email || !adminEmails.includes(user.email.toLowerCase().trim())) {
      throw new ForbiddenException({
        code: 'ADMIN_ACCESS_REQUIRED',
        message: 'Privilèges administrateur requis pour effectuer cette action.',
      });
    }

    return true;
  }
}
