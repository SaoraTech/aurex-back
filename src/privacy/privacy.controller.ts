import { Controller, Get, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { RequireUserGuard } from '../auth/require-user.guard';
import { CurrentUserId } from '../common/user.decorator';
import { Protect } from '../security/protect.decorator';
import { PrivacyService } from './privacy.service';

@ApiTags('privacy')
@ApiBearerAuth()
@UseGuards(RequireUserGuard)
@Protect('files')
@Controller('privacy')
export class PrivacyController {
  constructor(private readonly service: PrivacyService) {}

  @Get('export')
  export(@CurrentUserId() uid: string) {
    return this.service.exportUserData(uid);
  }

  @Post('delete-account')
  requestDeletion(@CurrentUserId() uid: string) {
    return this.service.requestDeletion(uid);
  }

  @Get('deletion-status')
  getDeletionStatus(@CurrentUserId() uid: string) {
    return this.service.getDeletionStatus(uid);
  }
}
