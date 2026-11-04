import { Module } from '@nestjs/common';
import { ObservabilityModule } from '../observability/observability.module';
import { PlansModule } from '../plans/plans.module';
import { AudioController } from './audio.controller';
import { AudioService } from './audio.service';
import { ElevenLabsService } from './elevenlabs.service';

@Module({
  imports: [PlansModule, ObservabilityModule],
  controllers: [AudioController],
  providers: [ElevenLabsService, AudioService],
  exports: [AudioService],
})
export class AudioModule {}
