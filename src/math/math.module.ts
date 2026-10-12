import { Module } from '@nestjs/common';
import { MathService } from './math.service';
import { MathController } from './math.controller';
@Module({ providers: [MathService], controllers: [MathController], exports: [MathService] })
export class MathModule {}
