import { Body, Controller, Delete, Headers, Post, Res, HttpException, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsDateString, IsIn, IsString, IsUUID, MaxLength, MinLength, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { CurrentUserId } from '../common/user.decorator';
import { RequireUserGuard } from '../auth/require-user.guard';
import { Protect } from '../security/protect.decorator';
import { GuestSessionService } from './guest-session.service';
import { GuestImportService } from './guest-import.service';

class GuestMessageDto {
  @IsString() @MinLength(1) @MaxLength(20_000) content!: string;
}
class GuestImportMessageDto {
  @IsIn(['user', 'assistant']) role!: 'user' | 'assistant';
  @IsString() @MinLength(1) @MaxLength(20_000) content!: string;
  @IsDateString() createdAt!: string;
}
class GuestImportDto {
  @IsUUID('4') transferId!: string;
  @IsArray() @ArrayMaxSize(20)
  @ValidateNested({ each: true }) @Type(() => GuestImportMessageDto)
  messages!: GuestImportMessageDto[];
}

@ApiTags('guest')
@Controller('guest')
export class GuestController {
  constructor(private readonly guests: GuestSessionService, private readonly imports: GuestImportService) {}

  @Post('sessions')
  @Protect('guest')
  createSession() { return this.guests.create(); }

  @Delete('sessions/current')
  @Protect('guest')
  revokeSession(@Headers('authorization') authorization?: string) { return this.guests.revoke(authorization); }

  @Post('sessions/current/import')
  @UseGuards(RequireUserGuard)
  @Protect('chat')
  @ApiBearerAuth()
  importCurrentSession(
    @Headers('x-guest-session-token') guestToken: string | undefined,
    @CurrentUserId() userId: string,
    @Body() dto: GuestImportDto,
  ) {
    return this.imports.importConversation(guestToken ? `Bearer ${guestToken}` : undefined, userId, dto);
  }

  @Post('chat/messages')
  @Protect('guest')
  send(@Headers('authorization') authorization: string | undefined, @Body() dto: GuestMessageDto) {
    return this.guests.send(authorization, dto);
  }

  @Post('chat/messages/stream')
  @Protect('guest')
  async stream(@Headers('authorization') authorization: string | undefined, @Body() dto: GuestMessageDto, @Res() response: Response) {
    const abortController = new AbortController();
    response.status(200).set({
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    response.flushHeaders();
    response.on('close', () => {
      if (!response.writableEnded && !response.destroyed) abortController.abort();
    });
    try {
      const result = await this.guests.send(authorization, dto, {
        signal: abortController.signal,
        onToken: delta => { if (!response.writableEnded && !response.destroyed) response.write('event: delta\ndata: ' + JSON.stringify({ delta }) + '\n\n'); },
      });
      if (!response.writableEnded) response.write('event: done\ndata: ' + JSON.stringify(result) + '\n\n');
    } catch (error) {
      if (!response.writableEnded) {
        const payload = error instanceof HttpException ? error.getResponse() : { code: 'GUEST_CHAT_FAILED', message: 'La génération a échoué.' };
        response.write('event: error\ndata: ' + JSON.stringify(payload) + '\n\n');
      }
    } finally {
      if (!response.writableEnded && !response.destroyed) response.end();
    }
  }
}
