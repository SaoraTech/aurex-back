import { Global, Module } from '@nestjs/common';
import { IdentityService } from './identity.service';
import { IdentityController } from './identity.controller';

@Global()
@Module({ providers: [IdentityService], controllers: [IdentityController], exports: [IdentityService] })
export class IdentityModule {}
