import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module';
import { PlansModule } from '../plans/plans.module';
import { AudioController } from './audio.controller';
import { AudioService } from './audio.service';
import { ElevenLabsService } from './elevenlabs.service';
@Module({ imports: [AiModule, PlansModule], controllers: [AudioController], providers: [AudioService, ElevenLabsService] })
export class AudioModule {}
