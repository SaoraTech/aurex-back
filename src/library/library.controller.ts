import { BadRequestException, Controller, Delete, Get, Headers, HttpCode, Param, ParseUUIDPipe, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { RequireUserGuard } from '../auth/require-user.guard';
import { CurrentUserId, RequestId } from '../common/user.decorator';
import { Protect } from '../security/protect.decorator';
import { LibraryService } from './library.service';

@ApiTags('library') @ApiBearerAuth() @UseGuards(RequireUserGuard)
@Controller('library')
export class LibraryController {
  constructor(private readonly service: LibraryService) {}

  @Get('documents') @Protect('files')
  list(@CurrentUserId() uid: string) { return this.service.list(uid); }

  /** Raw bytes body (Content-Type ignored); metadata in headers: X-File-Content-Type, X-File-Name (URL-encoded). */
  @Post('documents') @Protect('upload') @HttpCode(201)
  upload(
    @CurrentUserId() uid: string, @RequestId() rid: string, @Req() req: Request,
    @Headers('x-file-content-type') mime?: string, @Headers('x-file-name') name?: string,
  ) {
    if (!mime) throw new BadRequestException({ code: 'FILE_MIME_REQUIRED', message: 'X-File-Content-Type est requis.' });
    let filename: string | undefined;
    try { filename = name ? decodeURIComponent(name) : undefined; } catch { throw new BadRequestException({ code: 'INVALID_FILE_NAME', message: 'X-File-Name invalide.' }); }
    return this.service.upload(uid, Buffer.isBuffer(req.body) ? req.body : undefined, { declaredMime: mime, filename }, rid);
  }

  @Get('documents/:id') @Protect('files')
  get(@CurrentUserId() uid: string, @Param('id', new ParseUUIDPipe()) id: string) { return this.service.get(uid, id); }

  @Get('documents/:id/download-url') @Protect('files')
  downloadUrl(@CurrentUserId() uid: string, @RequestId() rid: string, @Param('id', new ParseUUIDPipe()) id: string) { return this.service.downloadUrl(uid, id, rid); }

  @Delete('documents/:id') @Protect('files')
  remove(@CurrentUserId() uid: string, @RequestId() rid: string, @Param('id', new ParseUUIDPipe()) id: string) { return this.service.remove(uid, id, rid); }
}
