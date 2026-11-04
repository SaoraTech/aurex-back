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
import { PaymentMethodType } from './providers/payment-provider.interface';

class CheckoutDto {
  @IsIn(['plus', 'pro', 'plus_promo', 'pro_promo'])
  plan!: 'plus' | 'pro' | 'plus_promo' | 'pro_promo';

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
  constructor(private readonly billing: BillingService) {}

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
      dto.paymentMethod ?? 'orange_money_mali',
      dto.returnUrl,
      idempotencyKey,
    );
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
