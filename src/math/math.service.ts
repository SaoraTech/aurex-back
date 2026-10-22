import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppException, badRequest } from '../common/errors';
import { fetchWithTimeout } from '../common/http';
import { ProviderError, kindFromStatus, providerErrorToHttp } from '../common/provider-error';
import { MetricsService } from '../observability/metrics.service';
import { UsageService } from '../observability/usage.service';

export type MathDomain = 'calculus' | 'algebra' | 'arithmetic' | 'linear_algebra' | 'statistics' | 'general';

export interface MathComputeResult {
  input: string;
  normalizedInput: string;
  result: string;
  domain: MathDomain;
  isVerified: boolean;
  provider: string;
  latencyMs: number;
}

@Injectable()
export class MathService {
  constructor(
    private readonly config: ConfigService,
    private readonly metrics: MetricsService,
    private readonly usage: UsageService,
  ) {}

  /**
   * Pre-validates and normalizes mathematical notation to prevent malformed queries
   * and save external API quota.
   */
  normalizeMathInput(rawInput: string): { normalized: string; domain: MathDomain } {
    const trimmed = rawInput.trim();
    if (!trimmed) {
      throw badRequest('EMPTY_MATH_INPUT', 'Expression mathématique vide.');
    }

    // Check unbalanced parentheses
    let balance = 0;
    for (const char of trimmed) {
      if (char === '(' || char === '[' || char === '{') balance++;
      if (char === ')' || char === ']' || char === '}') balance--;
      if (balance < 0) {
        throw badRequest('MALFORMED_MATH_EXPRESSION', 'Expression mathématique invalide : parenthèses non équilibrées.');
      }
    }
    if (balance !== 0) {
      throw badRequest('MALFORMED_MATH_EXPRESSION', 'Expression mathématique invalide : parenthèses non équilibrées.');
    }

    // Replace common Unicode math symbols with engine-compatible syntax
    const normalized = trimmed
      .replace(/[×·]/g, '*')
      .replace(/[÷]/g, '/')
      .replace(/[−–—]/g, '-')
      .replace(/π/g, 'pi')
      .replace(/√\(([^)]+)\)/g, 'sqrt($1)')
      .replace(/√([0-9a-zA-Z]+)/g, 'sqrt($1)')
      .replace(/≤/g, '<=')
      .replace(/≥/g, '>=')
      .replace(/≠/g, '!=');

    // Categorize domain based on operators and terms
    let domain: MathDomain = 'general';
    const lower = normalized.toLowerCase();
    if (/\b(derivative|diff|d\/dx|integrate|integral|lim|limit|series|taylor)\b/.test(lower)) {
      domain = 'calculus';
    } else if (/\b(matrix|det|eigenvalue|eigenvector|vector|dot|cross)\b/.test(lower) || /\{\{.*\}\}/.test(lower)) {
      domain = 'linear_algebra';
    } else if (/\b(solve|factor|expand|polynomial|roots|equation)\b/.test(lower) || /=[^=]/.test(lower)) {
      domain = 'algebra';
    } else if (/\b(mean|median|mode|variance|stddev|probability|binomial|normal)\b/.test(lower)) {
      domain = 'statistics';
    } else if (/^[0-9+\-*\/^().\s]+$/.test(normalized.replace(/\b(sqrt|pi|e|abs|log|ln|exp)\b/gi, ''))) {
      domain = 'arithmetic';
    }

    return { normalized, domain };
  }

  async compute(input: string, userId?: string, requestId?: string): Promise<MathComputeResult> {
    const { normalized, domain } = this.normalizeMathInput(input);

    const appId = this.config.get<string>('wolframAppId');
    if (!appId) {
      throw new AppException(503, 'MATH_ENGINE_NOT_CONFIGURED', "Le moteur de calcul n'est pas configuré.");
    }

    const started = Date.now();
    let outcome = 'ok';

    try {
      return await this.metrics.track('wolfram', 'result', async () => {
        const url = new URL('https://api.wolframalpha.com/v1/result');
        url.searchParams.set('appid', appId);
        url.searchParams.set('i', normalized);
        url.searchParams.set('units', 'metric');

        const res = await fetchWithTimeout('wolfram', url, {}, 12_000);

        // 501 = Wolfram|Alpha understood the query but has no short answer: a business outcome, not an outage.
        if (res.status === 501) {
          throw new AppException(422, 'NO_SHORT_RESULT', "Aucun résultat court n'est disponible pour cette entrée.");
        }
        if (!res.ok) {
          throw new ProviderError(
            'wolfram',
            res.status === 400 ? 'invalid_request' : kindFromStatus(res.status),
            `wolfram returned HTTP ${res.status}`,
            res.status,
          );
        }

        const rawText = await res.text();
        const duration = Date.now() - started;

        return {
          input,
          normalizedInput: normalized,
          result: rawText.trim(),
          domain,
          isVerified: true,
          provider: 'wolfram-alpha',
          latencyMs: duration,
        };
      });
    } catch (error) {
      outcome = error instanceof ProviderError ? error.kind : 'business_error';
      if (error instanceof ProviderError) throw providerErrorToHttp(error, 'Le moteur de calcul');
      throw error;
    } finally {
      if (userId) {
        void this.usage.record({
          userId,
          kind: 'math_call',
          provider: 'wolfram',
          latencyMs: Date.now() - started,
          outcome,
          requestId,
        });
      }
    }
  }
}
