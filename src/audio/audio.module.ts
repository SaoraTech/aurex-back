import { Module } from '@nestjs/common';
import { ObservabilityModule } from '../observability/observability.module';
import { PlansModule } from '../plans/plans.module';
import { QuotasModule } from '../quotas/quotas.module';
import { AudioController } from './audio.controller';
import { AudioService } from './audio.service';
import { AzureSpeechService } from './azure-speech.service';
@Module({imports:[PlansModule,QuotasModule,ObservabilityModule],controllers:[AudioController],providers:[AzureSpeechService,AudioService],exports:[AudioService]})
export class AudioModule {}
