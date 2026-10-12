import { createParamDecorator, ExecutionContext } from '@nestjs/common';

export type CurrentUser = { id: string; email?: string; name?: string };

export const UserFromRequest = createParamDecorator((_data: unknown, ctx: ExecutionContext): CurrentUser | null => {
  const request = ctx.switchToHttp().getRequest();
  return request.aurexUser ?? null;
});
