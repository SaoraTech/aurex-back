import { createParamDecorator, ExecutionContext, UnauthorizedException } from '@nestjs/common';
export const CurrentUserId = createParamDecorator((_data: unknown, ctx: ExecutionContext): string => {
  const user = ctx.switchToHttp().getRequest().aurexUser;
  if (!user?.id) throw new UnauthorizedException();
  return user.id as string;
});

export const RequestId = createParamDecorator((_data: unknown, ctx: ExecutionContext): string | undefined =>
  ctx.switchToHttp().getRequest().requestId);
