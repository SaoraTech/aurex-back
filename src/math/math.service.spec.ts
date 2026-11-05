import { MathService } from './math.service';
import { SageMathEngine } from './sagemath.engine';

describe('MathService & SageMathEngine', () => {
  let svc: MathService;
  let engine: SageMathEngine;
  let usage: any;

  beforeEach(() => {
    const cfg: any = {
      get: jest.fn((key: string) => {
        if (key === 'sagemathServiceUrl') return undefined; // unconfigured
        return undefined;
      }),
    };
    engine = new SageMathEngine(cfg);
    usage = { record: jest.fn().mockResolvedValue(undefined) };
    svc = new MathService(engine, usage);
  });

  it('fails explicitly when SageMath is not configured (no local fake fallback)', async () => {
    const r = await svc.compute('u1', {
      operation: 'derivative',
      expression: 'x^3 + 2x^2 - 5x',
      variable: 'x',
    });
    expect(r.status).toBe('failed');
    expect(r.errorCode).toBe('NOT_CONFIGURED');
    expect(r.error).toContain('pas configuré');
    expect(usage.record).toHaveBeenCalledWith(
      expect.objectContaining({ provider: 'sagemath', outcome: 'error' }),
    );
  });

  it('blocks dangerous Python keywords and expressions', async () => {
    const r = await svc.compute('u1', {
      operation: 'derivative',
      expression: '__import__("os").system("ls")',
    });
    expect(r.status).toBe('failed');
    expect(r.errorCode).toBe('SECURITY_REJECTED');
    expect(r.error).toContain('interdite');
  });

  it('rejects unbalanced parentheses', async () => {
    const r = await svc.compute('u1', {
      operation: 'derivative',
      expression: '((x + 2) * (x - 3)',
    });
    expect(r.status).toBe('failed');
    expect(r.errorCode).toBe('INVALID_INPUT');
  });

  it('returns verified result when remote SageMath responds with authentic output', async () => {
    const cfg: any = {
      get: jest.fn((key: string) => {
        if (key === 'sagemathServiceUrl') return 'https://sagemath.internal';
        if (key === 'sagemathApiKey') return 'test_key';
        return undefined;
      }),
    };
    const remoteEngine = new SageMathEngine(cfg);
    const remoteSvc = new MathService(remoteEngine, usage);

    const mockFetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        status: 'verified',
        latex: '3x^2 + 4x - 5',
        plainText: '3*x^2 + 4*x - 5',
        steps: ['Derivation term by term'],
      }),
    });
    global.fetch = mockFetch;

    const r = await remoteSvc.compute('u1', {
      operation: 'derivative',
      expression: 'x^3 + 2x^2 - 5x',
      variable: 'x',
    });

    expect(r.status).toBe('verified');
    expect(r.latex).toBe('3x^2 + 4x - 5');
    expect(r.plainText).toBe('3*x^2 + 4*x - 5');
    expect(r.steps).toEqual(['Derivation term by term']);
    expect(usage.record).toHaveBeenCalledWith(
      expect.objectContaining({ provider: 'sagemath', outcome: 'ok' }),
    );
  });

  it('handles remote HTTP error gracefully without throwing unhandled exceptions', async () => {
    const cfg: any = {
      get: jest.fn((key: string) => {
        if (key === 'sagemathServiceUrl') return 'https://sagemath.internal';
        return undefined;
      }),
    };
    const remoteEngine = new SageMathEngine(cfg);
    const remoteSvc = new MathService(remoteEngine, usage);

    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 503,
      json: async () => ({ error: 'Service Unavailable' }),
    });

    const r = await remoteSvc.compute('u1', {
      operation: 'factor',
      expression: 'x^2 - 5x + 6',
    });

    expect(r.status).toBe('failed');
    expect(r.errorCode).toBe('UNAVAILABLE');
    expect(r.error).toContain('503');
  });

  it('detects derivative intent and extracts exact user expression', () => {
    const detected = svc.detectAndSolve('Calcule la dérivée de x^4 - 3x^2 + 7');
    expect(detected).not.toBeNull();
    expect(detected?.operation).toBe('derivative');
    expect(detected?.expression).toBe('x^4 - 3x^2 + 7');
  });

  it('detects bounded integral and extracts exact user expression and bounds', () => {
    const detected = svc.detectAndSolve('intégrale de 4x^3 entre 1 et 3');
    expect(detected).not.toBeNull();
    expect(detected?.operation).toBe('integral');
    expect(detected?.expression).toBe('4x^3');
    expect(detected?.bounds).toEqual({ lower: '1', upper: '3' });
  });

  it('detects equation solving with exact equation', () => {
    const detected = svc.detectAndSolve('résous 5x - 20 = 0');
    expect(detected).not.toBeNull();
    expect(detected?.operation).toBe('solve');
    expect(detected?.expression).toBe('5x - 20 = 0');
  });

  it('returns null for non-mathematical questions without substituting demo expressions', () => {
    const detected = svc.detectAndSolve('Bonjour, qui es-tu et que peux-tu faire ?');
    expect(detected).toBeNull();
  });
});
