import { ConfigService } from '@nestjs/config';
import { MathService } from './math.service';
import { MetricsService } from '../observability/metrics.service';
import { UsageService } from '../observability/usage.service';

describe('MathService - Mathematical Precision & Quality Verification', () => {
  let service: MathService;
  let configMock: any;
  let metricsMock: any;
  let usageMock: any;

  beforeEach(() => {
    configMock = {
      get: jest.fn().mockImplementation((key: string) => {
        if (key === 'wolframAppId') return 'test_wolfram_app_id';
        return undefined;
      }),
    };

    metricsMock = {
      track: jest.fn().mockImplementation((provider, op, fn) => fn()),
    };

    usageMock = {
      record: jest.fn().mockResolvedValue(undefined),
    };

    service = new MathService(
      configMock as unknown as ConfigService,
      metricsMock as unknown as MetricsService,
      usageMock as unknown as UsageService,
    );
  });

  describe('normalizeMathInput & Domain Categorization', () => {
    it('normalizes Unicode math symbols into engine-compatible syntax', () => {
      const { normalized, domain } = service.normalizeMathInput('2 × π × 5 − 3 ÷ √16');
      expect(normalized).toBe('2 * pi * 5 - 3 / sqrt(16)');
      expect(domain).toBe('arithmetic');
    });

    it('categorizes calculus problems accurately (derivatives, integrals)', () => {
      const d1 = service.normalizeMathInput('d/dx (x^3 + 2x - 5)');
      expect(d1.domain).toBe('calculus');

      const d2 = service.normalizeMathInput('integrate sin(x) dx');
      expect(d2.domain).toBe('calculus');
    });

    it('categorizes algebra problems accurately (polynomials, equations)', () => {
      const { domain } = service.normalizeMathInput('solve x^2 - 5x + 6 = 0');
      expect(domain).toBe('algebra');
    });

    it('categorizes linear algebra problems accurately (matrices, determinants)', () => {
      const { domain } = service.normalizeMathInput('det({{1, 2}, {3, 4}})');
      expect(domain).toBe('linear_algebra');
    });

    it('throws BadRequestException for unbalanced parentheses before calling external API', () => {
      expect(() => service.normalizeMathInput('(2 + 3 * (4 - 1)')).toThrow(
        'Expression mathématique invalide : parenthèses non équilibrées.',
      );
    });

    it('throws BadRequestException for empty input', () => {
      expect(() => service.normalizeMathInput('   ')).toThrow('Expression mathématique vide.');
    });
  });

  describe('compute (Deterministic Verification)', () => {
    it('throws 503 when wolframAppId is unconfigured', async () => {
      configMock.get.mockReturnValue(undefined);
      await expect(service.compute('2 + 2')).rejects.toThrow("Le moteur de calcul n'est pas configuré.");
    });
  });
});
