import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AudioController } from './audio.controller';
import { AudioService } from './audio.service';
import { GroqSpeechService } from '../ai/groq-speech.service';

@Module({
  imports: [ConfigModule],
  controllers: [AudioController],
  providers: [AudioService, GroqSpeechService],
  exports: [AudioService],
})
export class AudioModule {}
