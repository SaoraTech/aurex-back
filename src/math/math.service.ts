<<<<<<< LOCAL (Your changes)
import { Injectable, Logger } from '@nestjs/common';
import { UsageService } from '../observability/usage.service';
import {
  MathOperationInput,
  MathOperationType,
  MathResult,
} from './math-engine.interface';
import { SageMathEngine } from './sagemath.engine';

@Injectable()
export class MathService {
  private readonly logger = new Logger(MathService.name);

  constructor(
    private readonly sageMath: SageMathEngine,
    private readonly usage: UsageService,
  ) {}

  isAvailable(): boolean {
    return this.sageMath.isAvailable();
  }

  async compute(
    userId: string,
    input: MathOperationInput,
    requestId?: string,
  ): Promise<MathResult> {
    const started = Date.now();
    const result = await this.sageMath.execute(input);
    const latency = Date.now() - started;

    const outcome =
      result.status === 'verified'
        ? 'ok'
        : result.status === 'unsupported'
          ? 'unsupported'
          : 'error';

    await this.usage.record({
      userId,
      kind: 'math_call',
      provider: 'sagemath',
      units: 1,
      latencyMs: latency,
      outcome,
      requestId,
    });

    return result;
  }

  /**
   * Parses natural language mathematical questions into structured SageMath operations.
   * NEVER replaces unknown expressions with dummy hardcoded expressions.
   * Returns null if no structured operation can be reliably determined.
   */
  detectAndSolve(question: string): MathOperationInput | null {
    if (!question || typeof question !== 'string') return null;
    const q = question.trim().replace(/[?!.]+$/, '').trim();

    // 1. Derivative: e.g. "dérivée de 3x^2 + 5x", "dériver (sin(x))^2", "calcule la dérivée de x^3 - 4"
    const derivMatch = q.match(
      /(?:calcule[r]?\s+la\s+)?(?:dérivée\s+de|dériver|derive|différentier)\s+([a-zA-Z0-9^+\-*\/().,\s]+?)(?:\s+par\s+rapport\s+à\s+([a-zA-Z]))?$/i,
    );
    if (derivMatch && derivMatch[1]?.trim()) {
      return {
        operation: 'derivative',
        expression: derivMatch[1].trim(),
        variable: derivMatch[2]?.trim() || 'x',
      };
    }

    // 2. Integral with bounds: e.g. "intégrale de x^2 entre 0 et 1", "intégrale de 2x de 0 à 5"
    const boundedIntegralMatch = q.match(
      /(?:calcule[r]?\s+l')?(?:intégrale|integrer|primitive)\s+de\s+([a-zA-Z0-9^+\-*\/().\s]+?)\s+(?:entre|de)\s+([0-9a-zA-Z.\-]+)\s+(?:et|à)\s+([0-9a-zA-Z.\-]+)/i,
    );
    if (boundedIntegralMatch && boundedIntegralMatch[1]?.trim()) {
      return {
        operation: 'integral',
        expression: boundedIntegralMatch[1].trim(),
        variable: 'x',
        bounds: {
          lower: boundedIntegralMatch[2].trim(),
          upper: boundedIntegralMatch[3].trim(),
        },
      };
    }

    // 3. Indefinite Integral / Primitive: e.g. "primitive de 3x^2 + 2x", "intégrale de cos(x)"
    const integralMatch = q.match(
      /(?:calcule[r]?\s+l')?(?:intégrale|primitive)\s+de\s+([a-zA-Z0-9^+\-*\/().\s]+?)$/i,
    );
    if (integralMatch && integralMatch[1]?.trim()) {
      return {
        operation: 'integral',
        expression: integralMatch[1].trim(),
        variable: 'x',
      };
    }

    // 4. Factorization: e.g. "factorise 4x^2 - 9", "factoriser x^2 - 5x + 6"
    const factorMatch = q.match(
      /(?:factoriser|factorise|factor)\s+([a-zA-Z0-9^+\-*\/().\s]+?)$/i,
    );
    if (factorMatch && factorMatch[1]?.trim()) {
      return {
        operation: 'factor',
        expression: factorMatch[1].trim(),
        variable: 'x',
      };
    }

    // 5. Equation solving: e.g. "résous 2x + 5 = 15", "résoudre x^2 - 4 = 0"
    const solveMatch = q.match(
      /(?:résoudre|résous|solve)\s+(?:l'équation\s+)?([a-zA-Z0-9^+\-*\/().\s]+=[a-zA-Z0-9^+\-*\/().\s]+)/i,
    );
    if (solveMatch && solveMatch[1]?.trim()) {
      return {
        operation: 'solve',
        expression: solveMatch[1].trim(),
        variable: 'x',
      };
    }

    // 6. Matrix determinant: e.g. "déterminant de [[1, 2], [3, 4]]"
    const detMatch = q.match(
      /(?:déterminant|determinant|det)\s+(?:de\s+)?(\[\[.+?\]\])/i,
    );
    if (detMatch && detMatch[1]?.trim()) {
      return {
        operation: 'matrix_determinant',
        expression: detMatch[1].trim(),
      };
    }

    // 7. Simplification: e.g. "simplifier (x^2 - 1)/(x - 1)", "simplifie ..."
    const simplifyMatch = q.match(
      /(?:simplifier|simplifie|simplify)\s+([a-zA-Z0-9^+\-*\/().\s]+?)$/i,
    );
    if (simplifyMatch && simplifyMatch[1]?.trim()) {
      return {
        operation: 'simplify',
        expression: simplifyMatch[1].trim(),
        variable: 'x',
      };
    }

    // 8. Limit: e.g. "limite de sin(x)/x quand x tend vers 0"
    const limitMatch = q.match(
      /(?:limite\s+de|limit)\s+([a-zA-Z0-9^+\-*\/().\s]+?)\s+(?:quand|lorsque)\s+([a-zA-Z])\s+tend\s+vers\s+([0-9a-zA-Z.\-+]+)/i,
    );
    if (limitMatch && limitMatch[1]?.trim()) {
      return {
        operation: 'limit',
        expression: limitMatch[1].trim(),
        variable: limitMatch[2].trim(),
        parameters: { point: limitMatch[3].trim() },
      };
    }

    // NO fallback dummy expression is ever returned!
    return null;
  }
}

=======
import { Injectable, Logger } from '@nestjs/common';
import { UsageService } from '../observability/usage.service';
import {
  MathOperationInput,
  MathOperationType,
  MathResult,
} from './math-engine.interface';
import { SageMathEngine } from './sagemath.engine';

@Injectable()
export class MathService {
  private readonly logger = new Logger(MathService.name);

  constructor(
    private readonly sageMath: SageMathEngine,
    private readonly usage: UsageService,
  ) {}

  isAvailable(): boolean {
    return this.sageMath.isAvailable();
  }

  async compute(
    userId: string,
    input: MathOperationInput,
    requestId?: string,
  ): Promise<MathResult> {
    const started = Date.now();
    const result = await this.sageMath.execute(input);
    const latency = Date.now() - started;

    const outcome =
      result.status === 'verified'
        ? 'ok'
        : result.status === 'unsupported'
          ? 'unsupported'
          : 'error';

    await this.usage.record({
      userId,
      kind: 'math_call',
      provider: 'sagemath',
      units: 1,
      latencyMs: latency,
      outcome,
      requestId,
    });

    return result;
  }

  /**
   * Parses natural language mathematical questions into structured SageMath operations.
   * NEVER replaces unknown expressions with dummy hardcoded expressions.
   * Returns null if no structured operation can be reliably determined.
   */
  detectAndSolve(question: string): MathOperationInput | null {
    if (!question || typeof question !== 'string') return null;
    const q = question.trim();

    // 1. Derivative: e.g. "dérivée de 3x^2 + 5x", "dériver (sin(x))^2", "calcule la dérivée de x^3 - 4"
    const derivMatch = q.match(
      /(?:calcule[r]?\s+la\s+)?(?:dérivée\s+de|dériver|derive|différentier)\s+([a-zA-Z0-9^+\-*\/().,\s]+?)(?:\s+par\s+rapport\s+à\s+([a-zA-Z]))?$/i,
    );
    if (derivMatch && derivMatch[1]?.trim()) {
      return {
        operation: 'derivative',
        expression: derivMatch[1].trim(),
        variable: derivMatch[2]?.trim() || 'x',
      };
    }

    // 2. Integral with bounds: e.g. "intégrale de x^2 entre 0 et 1", "intégrale de 2x de 0 à 5"
    const boundedIntegralMatch = q.match(
      /(?:calcule[r]?\s+l')?(?:intégrale|integrer|primitive)\s+de\s+([a-zA-Z0-9^+\-*\/().\s]+?)\s+(?:entre|de)\s+([0-9a-zA-Z.\-]+)\s+(?:et|à)\s+([0-9a-zA-Z.\-]+)/i,
    );
    if (boundedIntegralMatch && boundedIntegralMatch[1]?.trim()) {
      return {
        operation: 'integral',
        expression: boundedIntegralMatch[1].trim(),
        variable: 'x',
        bounds: {
          lower: boundedIntegralMatch[2].trim(),
          upper: boundedIntegralMatch[3].trim(),
        },
      };
    }

    // 3. Indefinite Integral / Primitive: e.g. "primitive de 3x^2 + 2x", "intégrale de cos(x)"
    const integralMatch = q.match(
      /(?:calcule[r]?\s+l')?(?:intégrale|primitive)\s+de\s+([a-zA-Z0-9^+\-*\/().\s]+?)$/i,
    );
    if (integralMatch && integralMatch[1]?.trim()) {
      return {
        operation: 'integral',
        expression: integralMatch[1].trim(),
        variable: 'x',
      };
    }

    // 4. Factorization: e.g. "factorise 4x^2 - 9", "factoriser x^2 - 5x + 6"
    const factorMatch = q.match(
      /(?:factoriser|factorise|factor)\s+([a-zA-Z0-9^+\-*\/().\s]+?)$/i,
    );
    if (factorMatch && factorMatch[1]?.trim()) {
      return {
        operation: 'factor',
        expression: factorMatch[1].trim(),
        variable: 'x',
      };
    }

    // 5. Equation solving: e.g. "résous 2x + 5 = 15", "résoudre x^2 - 4 = 0"
    const solveMatch = q.match(
      /(?:résoudre|résous|solve)\s+(?:l'équation\s+)?([a-zA-Z0-9^+\-*\/().\s]+=[a-zA-Z0-9^+\-*\/().\s]+)/i,
    );
    if (solveMatch && solveMatch[1]?.trim()) {
      return {
        operation: 'solve',
        expression: solveMatch[1].trim(),
        variable: 'x',
      };
    }

    // 6. Matrix determinant: e.g. "déterminant de [[1, 2], [3, 4]]"
    const detMatch = q.match(
      /(?:déterminant|determinant|det)\s+(?:de\s+)?(\[\[.+?\]\])/i,
    );
    if (detMatch && detMatch[1]?.trim()) {
      return {
        operation: 'matrix_determinant',
        expression: detMatch[1].trim(),
      };
    }

    // 7. Simplification: e.g. "simplifier (x^2 - 1)/(x - 1)", "simplifie ..."
    const simplifyMatch = q.match(
      /(?:simplifier|simplifie|simplify)\s+([a-zA-Z0-9^+\-*\/().\s]+?)$/i,
    );
    if (simplifyMatch && simplifyMatch[1]?.trim()) {
      return {
        operation: 'simplify',
        expression: simplifyMatch[1].trim(),
        variable: 'x',
      };
    }

    // 8. Limit: e.g. "limite de sin(x)/x quand x tend vers 0"
    const limitMatch = q.match(
      /(?:limite\s+de|limit)\s+([a-zA-Z0-9^+\-*\/().\s]+?)\s+(?:quand|lorsque)\s+([a-zA-Z])\s+tend\s+vers\s+([0-9a-zA-Z.\-+]+)/i,
    );
    if (limitMatch && limitMatch[1]?.trim()) {
      return {
        operation: 'limit',
        expression: limitMatch[1].trim(),
        variable: limitMatch[2].trim(),
        parameters: { point: limitMatch[3].trim() },
      };
    }

    // NO fallback dummy expression is ever returned!
    return null;
  }
}

>>>>>>> REMOTE (Changes from GitHub)
