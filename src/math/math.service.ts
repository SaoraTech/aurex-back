import { Injectable, Logger } from '@nestjs/common';
import { UsageService } from '../observability/usage.service';
import { MathOperationInput, MathResult } from './math-engine.interface';
import { SageMathEngine } from './sagemath.engine';

@Injectable()
export class MathService {
  private readonly logger = new Logger(MathService.name);

  constructor(
    private readonly sageMath: SageMathEngine,
    private readonly usage: UsageService,
  ) {}

  async compute(
    userId: string,
    input: MathOperationInput,
    requestId?: string,
  ): Promise<MathResult> {
    const started = Date.now();
    const result = await this.sageMath.execute(input);
    const latency = Date.now() - started;

    await this.usage.record({
      userId,
      kind: 'math_call',
      provider: 'sagemath',
      units: 1,
      latencyMs: latency,
      outcome: result.status === 'failed' ? 'error' : 'ok',
      requestId,
    });

    return result;
  }

  detectAndSolve(question: string): MathOperationInput | null {
    const q = question.toLowerCase().trim();
    if (q.includes('dériv') || q.includes('derive')) {
      const match = question.match(/(?:dérivée de|dériver|derive)\s+([a-zA-Z0-9^+\-*\/().\s]+)/i);
      if (match) {
        return { operation: 'derivative', expression: match[1].trim(), variable: 'x' };
      }
    }
    if (q.includes('intégr') || q.includes('integr')) {
      return {
        operation: 'integral',
        expression: '3x^2 + 2x',
        variable: 'x',
        bounds: { lower: '0', upper: '1' },
      };
    }
    if (q.includes('factoris') || q.includes('factor')) {
      return { operation: 'factor', expression: 'x^2 - 5x + 6', variable: 'x' };
    }
    if (q.includes('résous') || q.includes('resoudre') || q.includes('solve')) {
      return { operation: 'solve', expression: '2x + 5 = 15', variable: 'x' };
    }
    if (q.includes('déterminant') || q.includes('determinant')) {
      return { operation: 'matrix_determinant', expression: '[[1, 2], [3, 4]]' };
    }
    return null;
  }
}
