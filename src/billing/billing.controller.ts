import {
  Body,
  Controller,
  Headers,
  HttpCode,
  Post,
  RawBodyRequest,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiTags } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString } from 'class-validator';
import type { Request } from 'express';
import { RequireUserGuard } from '../auth/require-user.guard';
import { CurrentUserId } from '../common/user.decorator';
import { BillingService } from './billing.service';
import { BillingWebhooksService } from './billing-webhooks.service';
import { PaymentMethodType } from './providers/payment-provider.interface';

class CheckoutDto {
  @IsIn(['plus', 'pro', 'plus_promo', 'pro_promo'])
  plan!: 'plus' | 'pro' | 'plus_promo' | 'pro_promo';

  @IsOptional()
  @IsIn(['jemenipay', 'dodo_payments'])
  provider?: 'jemenipay' | 'dodo_payments';

  @IsOptional()
  @IsIn(['orange_money_mali', 'moov_africa_mali', 'card'])
  paymentMethod?: PaymentMethodType;

  @IsOptional()
  @IsString()
  returnUrl?: string;
}

@ApiTags('billing')
@Controller('billing')
export class BillingController {
  constructor(
    private readonly billing: BillingService,
    private readonly webhooks: BillingWebhooksService,
  ) {}

  @ApiBearerAuth()
  @UseGuards(RequireUserGuard)
  @Post('checkout')
  async checkout(
    @CurrentUserId() userId: string,
    @Body() dto: CheckoutDto,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    return this.billing.checkout(
      userId,
      dto.plan,
      dto.paymentMethod ?? (dto.provider === 'dodo_payments' ? 'card' : 'orange_money_mali'),
      dto.returnUrl,
      idempotencyKey,
      dto.provider ?? 'jemenipay',
    );
  }

  @Post('webhook/dodo-payments')
  @HttpCode(200)
  async dodoPaymentsWebhook(
    @Req() req: RawBodyRequest<Request>,
    @Headers('webhook-id') webhookId?: string,
    @Headers('webhook-timestamp') webhookTimestamp?: string,
    @Headers('webhook-signature') webhookSignature?: string,
  ) {
    const raw = req.rawBody ?? Buffer.from(JSON.stringify(req.body ?? {}));
    return this.webhooks.handleDodo(raw, { webhookId, webhookTimestamp, webhookSignature });
  }

  @Post('webhook/revenuecat')
  @HttpCode(200)
  async revenueCatWebhook(
    @Req() req: RawBodyRequest<Request>,
    @Headers('authorization') authorization?: string,
    @Headers('x-revenuecat-webhook-signature') signature?: string,
  ) {
    const raw = req.rawBody ?? Buffer.from(JSON.stringify(req.body ?? {}));
    return this.webhooks.handleRevenueCat(raw, authorization, signature);
  }

  @Post('webhook/huawei-iap')
  @HttpCode(200)
  async huaweiIapWebhook(@Req() req: RawBodyRequest<Request>) {
    const raw = req.rawBody ?? Buffer.from(JSON.stringify(req.body ?? {}));
    const result = await this.webhooks.handleHuawei(raw);
    return { responseCode: '0', result };
  }

  @Post('webhook/jemenipay')
  @HttpCode(200)
  @ApiHeader({ name: 'x-jemeni-signature', required: false })
  @ApiHeader({ name: 'x-jemenipay-signature', required: false })
  async jemenipayWebhook(
    @Req() req: RawBodyRequest<Request>,
    @Headers('x-jemeni-signature') jemeniSig?: string,
    @Headers('x-jemenipay-signature') jemenipaySig?: string,
    @Headers('auth-timestamp') authTimestamp?: string,
    @Headers('x-jemenipay-timestamp') jemenipayTimestamp?: string,
  ) {
    const signature = jemeniSig || jemenipaySig || '';
    const timestamp = authTimestamp || jemenipayTimestamp;
    const raw = req.rawBody ?? Buffer.from(JSON.stringify(req.body ?? {}));
    return this.billing.handleJemenipayWebhook(raw, signature, timestamp);
  }
}
