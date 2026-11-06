import { Injectable } from '@nestjs/common';
import { MathEngine, MathOperationInput, MathResult } from './math-engine.interface';

/** Placeholder for the future SMP integration. It performs no computation. */
@Injectable()
export class SmpMathEngine implements MathEngine {
  readonly engineName = 'smp' as const;
  isAvailable(): boolean { return false; }
  async execute(_input: MathOperationInput): Promise<MathResult> {
    return {
      engine: 'smp',
      status: 'failed',
      errorCode: 'NOT_CONFIGURED',
      computationTimeMs: 0,
      error: 'La Saora Mathematics Platform (SMP) n’est pas encore opérationnelle.',
    };
  }
}
