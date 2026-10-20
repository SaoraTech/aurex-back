import { Module } from '@nestjs/common';
import { PlansModule } from '../plans/plans.module';
import { QuotasController } from './quotas.controller';
import { QuotasService } from './quotas.service';

@Module({
  imports: [PlansModule],
  controllers: [QuotasController],
  providers: [QuotasService],
  exports: [QuotasService],
})
export class QuotasModule {}
