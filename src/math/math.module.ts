import { Module } from '@nestjs/common';
import { ObservabilityModule } from '../observability/observability.module';
import { MathController } from './math.controller';
import { MathService } from './math.service';
import { SageMathEngine } from './sagemath.engine';

@Module({
  imports: [ObservabilityModule],
  controllers: [MathController],
  providers: [SageMathEngine, MathService],
  exports: [SageMathEngine, MathService],
})
export class MathModule {}
