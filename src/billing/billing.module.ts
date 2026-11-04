import { Module } from '@nestjs/common';
import { PlansModule } from '../plans/plans.module';
import { BillingController } from './billing.controller';
import { BillingService } from './billing.service';
import { JemenipayProvider } from './providers/jemenipay.provider';

@Module({
  imports: [PlansModule],
  controllers: [BillingController],
  providers: [JemenipayProvider, BillingService],
  exports: [BillingService, JemenipayProvider],
})
export class BillingModule {}
