import { Body, Controller, Header, HttpCode, Post, Query, Req, Res, StreamableFile, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';
import type { Request, Response } from 'express';
import { RequireUserGuard } from '../auth/require-user.guard';
import { CurrentUserId, RequestId } from '../common/user.decorator';
import { Protect } from '../security/protect.decorator';
import { AudioService } from './audio.service';

/** Voice and model are server-side configuration; unknown properties are rejected by the global ValidationPipe. */
class SpeechDto {
  @IsString() @MinLength(1) @MaxLength(20000) text!: string;
  @IsOptional() @Matches(/^[a-z]{2,3}$/) languageCode?: string;
}
class TranscriptionQuery { @IsOptional() @Matches(/^[a-z]{2,3}$/) languageCode?: string }

@ApiTags('audio') @ApiBearerAuth() @UseGuards(RequireUserGuard)
@Controller('audio')
export class AudioController {
  constructor(private readonly audio: AudioService) {}

  @Post('speech') @Protect('tts') @HttpCode(200) @Header('Cache-Control', 'no-store')
  async speech(@CurrentUserId() uid: string, @RequestId() rid: string, @Body() dto: SpeechDto, @Res({ passthrough: true }) res: Response) {
    const r = await this.audio.synthesize(uid, dto.text, dto.languageCode, rid);
    res.setHeader('X-Aurex-Audio-Provider', r.provider);
    res.setHeader('X-Aurex-Audio-Fallback', String(r.fallback));
    return new StreamableFile(r.audio, { type: r.contentType, length: r.audio.length });
  }

  /** Raw audio bytes in the body (any Content-Type; the container is identified from the bytes). */
  @Post('transcriptions') @Protect('stt') @HttpCode(200) @Header('Cache-Control', 'no-store')
  transcribe(@CurrentUserId() uid: string, @RequestId() rid: string, @Req() req: Request, @Query() query: TranscriptionQuery) {
    return this.audio.transcribe(uid, Buffer.isBuffer(req.body) ? req.body : undefined, query.languageCode, rid);
  }
}
