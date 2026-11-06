import { Module } from '@nestjs/common';
import { ObservabilityModule } from '../observability/observability.module';
import { MathController } from './math.controller';
import { MathService } from './math.service';
import { SmpMathEngine } from './smp.engine';

@Module({
  imports: [ObservabilityModule],
  controllers: [MathController],
  providers: [SmpMathEngine, MathService],
  exports: [SmpMathEngine, MathService],
})
export class MathModule {}
