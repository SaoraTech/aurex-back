import { Body, Controller, Delete, Headers, Post, Res, HttpException } from '@nestjs/common';
import type { Response } from 'express';
import { ApiTags } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';
import { Protect } from '../security/protect.decorator';
import { GuestSessionService } from './guest-session.service';

class GuestMessageDto {
  @IsString() @MinLength(1) @MaxLength(20_000) content!: string;
}

@ApiTags('guest')
@Controller('guest')
export class GuestController {
  constructor(private readonly guests: GuestSessionService) {}

  @Post('sessions')
  @Protect('guest')
  createSession() { return this.guests.create(); }

  @Delete('sessions/current')
  @Protect('guest')
  revokeSession(@Headers('authorization') authorization?: string) { return this.guests.revoke(authorization); }

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
