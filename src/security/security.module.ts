import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ArcjetService } from './arcjet.service';
import { ProtectGuard } from './protect.guard';

@Module({
  providers: [ArcjetService, { provide: APP_GUARD, useClass: ProtectGuard }],
  exports: [ArcjetService],
})
export class SecurityModule {}
