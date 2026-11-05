import { ForbiddenException } from '@nestjs/common';
import { RequireAdminGuard } from './require-admin.guard';

describe('RequireAdminGuard', () => {
  let guard: RequireAdminGuard;
  let mockUserGuard: any;
  let mockConfig: any;

  beforeEach(() => {
    mockUserGuard = {
      resolve: jest.fn(),
    };
    mockConfig = {
      get: jest.fn((key: string) => {
        if (key === 'adminEmails') return ['admin@saora.tech', 'fdiallo@saora.tech'];
        return undefined;
      }),
    };
    guard = new RequireAdminGuard(mockUserGuard, mockConfig);
  });

  const makeContext = (userObj: any) => {
    mockUserGuard.resolve.mockResolvedValue(userObj);
    return {
      switchToHttp: () => ({
        getRequest: () => ({ headers: {} }),
      }),
    } as any;
  };

  it('allows access when user email matches configured admin email list', async () => {
    const ctx = makeContext({ id: 'u1', email: 'Admin@Saora.tech' });
    const result = await guard.canActivate(ctx);
    expect(result).toBe(true);
  });

  it('throws ForbiddenException when user email is not in admin email list', async () => {
    const ctx = makeContext({ id: 'u2', email: 'regular@user.com' });
    await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenException);
  });

  it('throws ForbiddenException when user has no email', async () => {
    const ctx = makeContext({ id: 'u3' });
    await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenException);
  });

  it('throws ForbiddenException when adminEmails is empty or unconfigured', async () => {
    mockConfig.get.mockReturnValue([]);
    const ctx = makeContext({ id: 'u1', email: 'admin@saora.tech' });
    await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenException);
  });
});
