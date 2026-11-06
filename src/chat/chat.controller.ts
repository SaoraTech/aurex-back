import { Body, Controller, Get, HttpException, Param, Post, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { RequireUserGuard } from '../auth/require-user.guard';
import { CurrentUserId, RequestId } from '../common/user.decorator';
import { Protect } from '../security/protect.decorator';
import { ChatService } from './chat.service';

class SendMessageDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  conversationId?: string;

  @IsString()
  @MinLength(1)
  @MaxLength(20000)
  content!: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  requestId?: string;

  @IsOptional()
  @IsString()
  model?: string;

  @IsOptional()
  @IsIn(['off', 'on', 'auto'])
  webSearch?: 'off' | 'on' | 'auto';
}

@ApiTags('chat')
@ApiBearerAuth()
@UseGuards(RequireUserGuard)
@Controller('chat')
export class ChatController {
  constructor(private readonly chat: ChatService) {}


  @Post('messages/stream')
  @Protect('chat')
  async stream(
    @CurrentUserId() userId: string,
    @RequestId() rid: string,
    @Body() dto: SendMessageDto,
    @Res() response: Response,
  ) {
    const { model: _ignored, ...rest } = dto;
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
      const result = await this.chat.send(
        userId,
        { ...rest, requestId: rest.requestId ?? rid, model: 'groq' },
        rid,
        {
          signal: abortController.signal,
          onToken: (delta) => {
            if (!response.writableEnded && !response.destroyed) {
              response.write('event: delta\ndata: ' + JSON.stringify({ delta }) + '\n\n');
            }
          },
        },
      );
      if (!response.writableEnded) {
        response.write('event: done\ndata: ' + JSON.stringify(result) + '\n\n');
      }
    } catch (error) {
      if (!response.writableEnded) {
        const payload = error instanceof HttpException
          ? error.getResponse()
          : { code: 'CHAT_GENERATION_FAILED', message: 'La génération a échoué.' };
        response.write('event: error\ndata: ' + JSON.stringify(payload) + '\n\n');
      }
    } finally {
      if (!response.writableEnded && !response.destroyed) response.end();
    }
  }

  @Get('generations/:requestId')
  @Protect('chat')
  generationStatus(@CurrentUserId() userId: string, @Param('requestId') requestId: string) {
    return this.chat.generationStatus(userId, requestId);
  }

  @Post('generations/:requestId/cancel')
  @Protect('chat')
  cancel(@CurrentUserId() userId: string, @Param('requestId') requestId: string) {
    return this.chat.cancelGeneration(userId, requestId);
  }

  @Post('conversations/:conversationId/messages/:messageId/regenerate')
  @Protect('chat')
  regenerate(
    @CurrentUserId() userId: string,
    @RequestId() rid: string,
    @Param('conversationId') conversationId: string,
    @Param('messageId') messageId: string,
  ) {
    return this.chat.regenerate(userId, conversationId, messageId, rid);
  }

  @Post('messages')
  @Protect('chat')
  send(@CurrentUserId() userId: string, @RequestId() rid: string, @Body() dto: SendMessageDto) {
    const { model: _ignored, ...rest } = dto;
    return this.chat.send(userId, { ...rest, model: 'groq' }, rid);
  }
}
