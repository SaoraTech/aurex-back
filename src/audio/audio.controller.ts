import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { FileInterceptor } from '@nestjs/platform-express';
import { Response } from 'express';
import { IsIn, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { RequireUserGuard } from '../auth/require-user.guard';
import { AudioService } from './audio.service';

export class SynthesizeDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(4000)
  text!: string;

  @IsString()
  @IsOptional()
  voice?: string;

  @IsString()
  @IsOptional()
  model?: string;

  @IsString()
  @IsOptional()
  @IsIn(['elevenlabs', 'groq'])
  provider?: 'elevenlabs' | 'groq';
}

@ApiTags('audio')
@ApiBearerAuth()
@UseGuards(RequireUserGuard)
@Controller('audio')
export class AudioController {
  constructor(private readonly audioService: AudioService) {}

  @Get('status')
  @ApiOperation({ summary: 'État des fournisseurs de synthèse et transcription vocale' })
  getStatus() {
    return this.audioService.getStatus();
  }

  @Post('speech')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Synthèse vocale (TTS) via ElevenLabs avec repli automatique sur Groq' })
  async synthesize(@Body() body: SynthesizeDto, @Res() res: Response) {
    const result = await this.audioService.synthesize(body.text, {
      voice: body.voice,
      model: body.model,
      provider: body.provider,
    });

    res.setHeader('Content-Type', result.contentType);
    res.setHeader('X-Audio-Provider', result.provider);
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.send(result.audio);
  }

  @Post('transcriptions')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(FileInterceptor('file'))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Transcription vocale (STT) avec Whisper/Groq' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: { type: 'string', format: 'binary' },
      },
    },
  })
  async transcribe(@UploadedFile() file: Express.Multer.File) {
    return this.audioService.transcribe(file);
  }
}
