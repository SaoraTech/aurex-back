import { MathService } from './math.service';
import { SageMathEngine } from './sagemath.engine';

describe('MathService & SageMathEngine', () => {
  let svc: MathService;
  let engine: SageMathEngine;
  let usage: any;

  beforeEach(() => {
    const cfg: any = { get: jest.fn(() => undefined) };
    engine = new SageMathEngine(cfg);
    usage = { record: jest.fn().mockResolvedValue(undefined) };
    svc = new MathService(engine, usage);
  });

  it('computes polynomial derivative with verified steps', async () => {
    const r = await svc.compute('u1', {
      operation: 'derivative',
      expression: 'x^3 + 2x^2 - 5x',
      variable: 'x',
    });
    expect(r.status).toBe('verified');
    expect(r.latex).toBe('3x^2 + 4x - 5');
    expect(r.steps?.length).toBeGreaterThan(0);
    expect(usage.record).toHaveBeenCalledWith(
      expect.objectContaining({ provider: 'sagemath', outcome: 'ok' }),
    );
  });

  it('computes definite integral with verified status', async () => {
    const r = await svc.compute('u1', {
      operation: 'integral',
      expression: '3x^2 + 2x',
      variable: 'x',
      bounds: { lower: '0', upper: '1' },
    });
    expect(r.status).toBe('verified');
    expect(r.latex).toBe('2');
  });

  it('factors quadratic polynomial', async () => {
    const r = await svc.compute('u1', {
      operation: 'factor',
      expression: 'x^2 - 5x + 6',
    });
    expect(r.status).toBe('verified');
    expect(r.latex).toBe('(x - 2)(x - 3)');
  });

  it('solves linear equation', async () => {
    const r = await svc.compute('u1', {
      operation: 'solve',
      expression: '2x + 5 = 15',
    });
    expect(r.status).toBe('verified');
    expect(r.latex).toBe('x = 5');
  });

  it('computes 2x2 matrix determinant', async () => {
    const r = await svc.compute('u1', {
      operation: 'matrix_determinant',
      expression: '[[1, 2], [3, 4]]',
    });
    expect(r.status).toBe('verified');
    expect(r.latex).toBe('-2');
  });

  it('blocks dangerous Python keywords and expressions', async () => {
    const r = await svc.compute('u1', {
      operation: 'derivative',
      expression: '__import__("os").system("ls")',
    });
    expect(r.status).toBe('failed');
    expect(r.error).toContain('interdit');
  });

  it('detects derivative intent from natural language', () => {
    const detected = svc.detectAndSolve('Calcule la dérivée de x^3 + 2x^2 - 5x');
    expect(detected).not.toBeNull();
    expect(detected?.operation).toBe('derivative');
  });
});
