import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  MathEngine,
  MathErrorCode,
  MathOperationInput,
  MathResult,
} from './math-engine.interface';

const MAX_EXPRESSION_LENGTH = 1000;

@Injectable()
export class SageMathEngine implements MathEngine {
  readonly engineName = 'sagemath' as const;
  private readonly logger = new Logger(SageMathEngine.name);

  constructor(private readonly config: ConfigService) {}

  isAvailable(): boolean {
    return Boolean(this.config.get<string>('sagemathServiceUrl'));
  }

  async execute(input: MathOperationInput): Promise<MathResult> {
    const started = Date.now();

    // 1. Validate and sanitize input
    const sanitized = this.sanitizeInput(input.expression);
    if (!sanitized.safe) {
      return {
        engine: 'sagemath',
        status: 'failed',
        errorCode: sanitized.errorCode ?? 'SECURITY_REJECTED',
        computationTimeMs: Date.now() - started,
        error: `Expression rejetée : ${sanitized.reason}`,
      };
    }

    // 2. Check service configuration
    const serviceUrl = this.config.get<string>('sagemathServiceUrl');
    if (!serviceUrl) {
      return {
        engine: 'sagemath',
        status: 'failed',
        errorCode: 'NOT_CONFIGURED',
        computationTimeMs: Date.now() - started,
        error: 'Le moteur de calcul SageMath n’est pas configuré sur ce serveur.',
      };
    }

    // 3. Remote execution via SageMath RPC
    return this.callRemoteSageMath(serviceUrl, input, sanitized.cleanExpr, started);
  }

  private sanitizeInput(expr: string): {
    safe: boolean;
    cleanExpr: string;
    reason?: string;
    errorCode?: MathErrorCode;
  } {
    if (!expr || !expr.trim()) {
      return {
        safe: false,
        cleanExpr: '',
        reason: 'Expression vide',
        errorCode: 'INVALID_INPUT',
      };
    }

    const clean = expr.trim();
    if (clean.length > MAX_EXPRESSION_LENGTH) {
      return {
        safe: false,
        cleanExpr: '',
        reason: `Expression trop longue (max ${MAX_EXPRESSION_LENGTH} caractères)`,
        errorCode: 'INVALID_INPUT',
      };
    }

    // Strict blacklisting of system / python runtime execution commands
    const forbidden = [
      '__',
      'import',
      'exec',
      'eval',
      'open',
      'system',
      'os.',
      'sys.',
      'subprocess',
      'shutil',
      'globals',
      'locals',
      'compile',
      'getattr',
      'setattr',
      'builtins',
      ';',
      '\n',
      '\r',
      'pty',
      'socket',
      'pickle',
    ];

    const lower = clean.toLowerCase();
    for (const f of forbidden) {
      if (lower.includes(f)) {
        return {
          safe: false,
          cleanExpr: '',
          reason: `Symbole ou commande interdite détectée : ${f}`,
          errorCode: 'SECURITY_REJECTED',
        };
      }
    }

    // Parentheses and bracket balance verification
    let roundBalance = 0;
    let squareBalance = 0;
    let curlyBalance = 0;
    for (const char of clean) {
      if (char === '(') roundBalance++;
      else if (char === ')') roundBalance--;
      else if (char === '[') squareBalance++;
      else if (char === ']') squareBalance--;
      else if (char === '{') curlyBalance++;
      else if (char === '}') curlyBalance--;

      if (roundBalance < 0 || squareBalance < 0 || curlyBalance < 0) {
        return {
          safe: false,
          cleanExpr: '',
          reason: 'Parenthèses ou crochets déséquilibrés',
          errorCode: 'INVALID_INPUT',
        };
      }
    }

    if (roundBalance !== 0 || squareBalance !== 0 || curlyBalance !== 0) {
      return {
        safe: false,
        cleanExpr: '',
        reason: 'Parenthèses ou crochets non fermés',
        errorCode: 'INVALID_INPUT',
      };
    }

    return { safe: true, cleanExpr: clean };
  }

  private async callRemoteSageMath(
    url: string,
    input: MathOperationInput,
    cleanExpr: string,
    started: number,
  ): Promise<MathResult> {
    const apiKey = this.config.get<string>('sagemathApiKey');
    const timeoutMs =
      input.timeoutMs ??
      this.config.get<number>('sagemathTimeoutMs') ??
      15000;

    const controller = new AbortController();
    const timeoutTimer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const endpoint = `${url.replace(/\/+$/, '')}/api/v1/compute`;
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
        },
        body: JSON.stringify({
          operation: input.operation,
          expression: cleanExpr,
          variable: input.variable ?? 'x',
          bounds: input.bounds,
          parameters: input.parameters,
        }),
        signal: controller.signal,
      });

      const computationTimeMs = Date.now() - started;

      if (!response.ok) {
        if (response.status === 400) {
          let errDetail = 'Entrée mathématique invalide';
          try {
            const errJson = await response.json();
            errDetail = errJson.error ?? errJson.message ?? errDetail;
          } catch {
            // ignore JSON parse error on error response
          }
          return {
            engine: 'sagemath',
            status: 'failed',
            errorCode: 'INVALID_INPUT',
            computationTimeMs,
            error: errDetail,
          };
        }

        if (response.status === 404 || response.status === 501) {
          return {
            engine: 'sagemath',
            status: 'unsupported',
            errorCode: 'UNSUPPORTED_OPERATION',
            computationTimeMs,
            error: `Opération mathématique non prise en charge : ${input.operation}`,
          };
        }

        return {
          engine: 'sagemath',
          status: 'failed',
          errorCode: 'UNAVAILABLE',
          computationTimeMs,
          error: `Le service SageMath a retourné une erreur HTTP ${response.status}`,
        };
      }

      // Validate JSON response strictly
      let data: any;
      try {
        data = await response.json();
      } catch {
        return {
          engine: 'sagemath',
          status: 'failed',
          errorCode: 'UNAVAILABLE',
          computationTimeMs,
          error: 'Réponse SageMath malformée (non JSON)',
        };
      }

      // Check schema contract: must be a plain object
      if (!data || typeof data !== 'object' || Array.isArray(data)) {
        return {
          engine: 'sagemath',
          status: 'failed',
          errorCode: 'UNAVAILABLE',
          computationTimeMs,
          error: 'Réponse SageMath invalide (type objet attendu)',
        };
      }

      // Validate field types strictly: reject malformed objects
      if (typeof data.status !== 'string') {
        return {
          engine: 'sagemath',
          status: 'failed',
          errorCode: 'COMPUTATION_ERROR',
          computationTimeMs,
          error: 'Le service SageMath n’a pas retourné de statut valide.',
        };
      }

      if (data.plainText !== undefined && typeof data.plainText !== 'string') {
        return {
          engine: 'sagemath',
          status: 'failed',
          errorCode: 'COMPUTATION_ERROR',
          computationTimeMs,
          error: 'Type de champ plainText invalide (chaîne attendue).',
        };
      }

      if (data.result !== undefined && typeof data.result !== 'string' && typeof data.result !== 'number') {
        return {
          engine: 'sagemath',
          status: 'failed',
          errorCode: 'COMPUTATION_ERROR',
          computationTimeMs,
          error: 'Type de champ result invalide (chaîne ou nombre attendu).',
        };
      }

      if (data.latex !== undefined && typeof data.latex !== 'string') {
        return {
          engine: 'sagemath',
          status: 'failed',
          errorCode: 'COMPUTATION_ERROR',
          computationTimeMs,
          error: 'Type de champ latex invalide (chaîne attendue).',
        };
      }

      if (data.steps !== undefined) {
        if (!Array.isArray(data.steps) || data.steps.some((s: unknown) => typeof s !== 'string')) {
          return {
            engine: 'sagemath',
            status: 'failed',
            errorCode: 'COMPUTATION_ERROR',
            computationTimeMs,
            error: 'Type de champ steps invalide (tableau de chaînes attendu).',
          };
        }
      }

      // Explicit statuses reported by the remote engine must be honoured.
      if (data.status === 'unsupported') {
        return {
          engine: 'sagemath',
          status: 'unsupported',
          errorCode: 'UNSUPPORTED_OPERATION',
          computationTimeMs,
          error: typeof data.error === 'string' ? data.error : 'Opération non prise en charge par SageMath',
        };
      }

      if (data.status === 'failed' || data.status === 'error' || data.error) {
        return {
          engine: 'sagemath',
          status: 'failed',
          errorCode: 'COMPUTATION_ERROR',
          computationTimeMs,
          error: typeof data.error === 'string' ? data.error : 'Erreur lors du calcul symbolique SageMath',
        };
      }

      // A result is considered verified ONLY when the remote engine explicitly
      // confirms it with status === 'verified'. Any other/missing status is rejected.
      if (data.status !== 'verified') {
        return {
          engine: 'sagemath',
          status: 'failed',
          errorCode: 'COMPUTATION_ERROR',
          computationTimeMs,
          error: `Statut SageMath non vérifié ou inconnu : ${data.status}`,
        };
      }

      // Operation correspondence: if the engine echoes an operation, it must match.
      if (typeof data.operation === 'string' && data.operation !== input.operation) {
        return {
          engine: 'sagemath',
          status: 'failed',
          errorCode: 'COMPUTATION_ERROR',
          computationTimeMs,
          error: 'La réponse SageMath ne correspond pas à l’opération demandée.',
        };
      }

      // Extract verified result strings without arbitrary object coercion
      let plainText = '';
      if (typeof data.plainText === 'string') {
        plainText = data.plainText.trim();
      } else if (typeof data.result === 'string') {
        plainText = data.result.trim();
      } else if (typeof data.result === 'number' && Number.isFinite(data.result)) {
        plainText = String(data.result);
      } else if (typeof data.plain_text === 'string') {
        plainText = data.plain_text.trim();
      }

      const latexStr = typeof data.latex === 'string' ? data.latex.trim() : '';

      // A verified calculation MUST have an actual, non-empty result.
      if (!plainText && !latexStr) {
        return {
          engine: 'sagemath',
          status: 'failed',
          errorCode: 'COMPUTATION_ERROR',
          computationTimeMs,
          error: 'Le service SageMath n’a retourné aucun résultat mathématique exploitable.',
        };
      }

      // Size guards for result text.
      if (plainText.length > 50000 || latexStr.length > 50000) {
        return {
          engine: 'sagemath',
          status: 'failed',
          errorCode: 'COMPUTATION_ERROR',
          computationTimeMs,
          error: 'Résultat SageMath trop volumineux.',
        };
      }

      // Size guards for steps.
      let steps: string[] | undefined;
      if (Array.isArray(data.steps)) {
        if (data.steps.length > 50 || data.steps.some((s: string) => s.length > 5000)) {
          return {
            engine: 'sagemath',
            status: 'failed',
            errorCode: 'COMPUTATION_ERROR',
            computationTimeMs,
            error: 'Étapes de calcul SageMath trop volumineuses.',
          };
        }
        steps = data.steps.map((s: string) => s.trim());
      }

      return {
        engine: 'sagemath',
        status: 'verified',
        latex: latexStr || undefined,
        plainText: plainText || latexStr,
        steps,
        computationTimeMs,
      };
    } catch (err: any) {
      const computationTimeMs = Date.now() - started;
      if (err.name === 'AbortError') {
        this.logger.warn(`SageMath timeout after ${timeoutMs}ms`);
        return {
          engine: 'sagemath',
          status: 'failed',
          errorCode: 'TIMEOUT',
          computationTimeMs,
          error: `Délai d’attente dépassé pour le calcul SageMath (${timeoutMs}ms)`,
        };
      }

      this.logger.warn(`SageMath RPC network error: ${err.message}`);
      return {
        engine: 'sagemath',
        status: 'failed',
        errorCode: 'UNAVAILABLE',
        computationTimeMs,
        error: `Moteur SageMath inaccessible : ${err.message}`,
      };
    } finally {
      clearTimeout(timeoutTimer);
    }
  }
}

