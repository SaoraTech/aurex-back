import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from '@better-auth/drizzle-adapter';
import { bearer } from 'better-auth/plugins';
import { DRIZZLE } from '../db/db.constants';
import { AUTH } from './auth.constants';
import { RequireUserGuard } from './require-user.guard';

@Global()
@Module({
  providers: [RequireUserGuard, {
    provide: AUTH,
    inject: [DRIZZLE, ConfigService],
    useFactory: (db: any, config: ConfigService) => betterAuth({
      database: drizzleAdapter(db, { provider: 'pg' }),
      secret: config.get<string>('betterAuthSecret'),
      baseURL: config.get<string>('betterAuthUrl'),
      trustedOrigins: config.get<string[]>('trustedOrigins') ?? [],
      emailAndPassword: { enabled: true, requireEmailVerification: false },
      session: { expiresIn: 60 * 60 * 24 * 30, updateAge: 60 * 60 * 24 },
      plugins: [bearer()],
    }),
  }],
  exports: [AUTH, RequireUserGuard],
})
export class AuthModule {}
