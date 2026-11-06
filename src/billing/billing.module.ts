import { Module } from '@nestjs/common';
import { PlansModule } from '../plans/plans.module';
import { BillingController } from './billing.controller';
import { BillingService } from './billing.service';
import { JemenipayProvider } from './providers/jemenipay.provider';
import { DodoPaymentsProvider } from './providers/dodo-payments.provider';
import { RevenueCatProvider } from './providers/revenuecat.provider';
import { HuaweiIapProvider } from './providers/huawei-iap.provider';
import { BillingWebhooksService } from './billing-webhooks.service';

@Module({
  imports: [PlansModule],
  controllers: [BillingController],
  providers: [JemenipayProvider, DodoPaymentsProvider, RevenueCatProvider, HuaweiIapProvider, BillingService, BillingWebhooksService],
  exports: [BillingService, BillingWebhooksService, JemenipayProvider, DodoPaymentsProvider, RevenueCatProvider, HuaweiIapProvider],
})
export class BillingModule {}
