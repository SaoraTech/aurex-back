import { Module } from '@nestjs/common';
import { PlansModule } from '../plans/plans.module';
import { BillingController } from './billing.controller';
import { BillingService } from './billing.service';
import { JemenipayProvider } from './providers/jemenipay.provider';
import { DodoPaymentsProvider } from './providers/dodo-payments.provider';
import { RevenueCatProvider } from './providers/revenuecat.provider';
import { HuaweiIapProvider } from './providers/huawei-iap.provider';

@Module({
  imports: [PlansModule],
  controllers: [BillingController],
  providers: [JemenipayProvider, DodoPaymentsProvider, RevenueCatProvider, HuaweiIapProvider, BillingService],
  exports: [BillingService, JemenipayProvider, DodoPaymentsProvider, RevenueCatProvider, HuaweiIapProvider],
})
export class BillingModule {}
