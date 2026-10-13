import { Protect } from '../security/protect.decorator';
import { Body, Controller, Get, Headers, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsIn, IsString, MaxLength } from 'class-validator';
import { RequireUserGuard } from '../auth/require-user.guard';
import { CurrentUserId } from '../common/user.decorator';
import { BillingService } from './billing.service';

class CheckoutDto {
  @IsIn(['plus','pro']) plan!: 'plus'|'pro';
}
@ApiTags('billing')
@ApiBearerAuth()
@UseGuards(RequireUserGuard)
@Protect('read')
@Controller('billing')
export class BillingController {
  constructor(private readonly billing: BillingService) {}
  @Post('checkout')
  checkout(@CurrentUserId() userId: string, @Headers('idempotency-key') key: string, @Body() dto: CheckoutDto) {
    return this.billing.createCheckout(userId, dto.plan, key);
  }
  @Get('history') history(@CurrentUserId() userId: string) { return this.billing.history(userId); }
}
