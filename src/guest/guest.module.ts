import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module';
import { IdentityModule } from '../identity/identity.module';
import { GuestController } from './guest.controller';
import { GuestImportService } from './guest-import.service';
import { GuestSessionService } from './guest-session.service';

@Module({
  imports: [AiModule, IdentityModule],
  controllers: [GuestController],
  providers: [GuestSessionService, GuestImportService],
  exports: [GuestSessionService],
})
export class GuestModule {}
