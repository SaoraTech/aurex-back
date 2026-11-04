import { Module } from '@nestjs/common';
import { ObservabilityModule } from '../observability/observability.module';
import { MathService } from './math.service';
import { SageMathEngine } from './sagemath.engine';

@Module({
  imports: [ObservabilityModule],
  providers: [SageMathEngine, MathService],
  exports: [SageMathEngine, MathService],
})
export class MathModule {}
