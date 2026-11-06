import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { RequireUserGuard } from '../auth/require-user.guard';
import { CurrentUserId } from '../common/user.decorator';
import { Protect } from '../security/protect.decorator';
import { EntitlementsService } from './entitlements.service';

@ApiTags('entitlements')
@ApiBearerAuth()
@UseGuards(RequireUserGuard)
@Controller('entitlements')
export class EntitlementsController {
  constructor(private readonly entitlements: EntitlementsService) {}

  @Get('me')
  @Protect('read')
  getMine(@CurrentUserId() userId: string) {
    return this.entitlements.getForUser(userId);
  }
}
