import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { RequireUserGuard } from '../auth/require-user.guard';
import { CurrentUserId } from '../common/user.decorator';
import { LibraryService } from './library.service';
@ApiTags('library') @ApiBearerAuth() @UseGuards(RequireUserGuard)
@Controller('library')
export class LibraryController {
  constructor(private readonly service:LibraryService) {}
  @Get('documents') list(@CurrentUserId() uid:string){return this.service.list(uid);}
}
