import { MathService } from './math.service';
import { SmpMathEngine } from './smp.engine';

describe('MathService & SmpMathEngine', () => {
  let svc: MathService;
  let usage: { record: jest.Mock };
  beforeEach(() => {
    svc = new MathService(new SmpMathEngine(), (usage = { record: jest.fn().mockResolvedValue(undefined) }) as any);
  });
  it('reports SMP as not implemented and never returns a computed result', async () => {
    const result = await svc.compute('u1', { operation: 'derivative', expression: 'x^3 + 2x^2 - 5x', variable: 'x' });
    expect(result).toEqual(expect.objectContaining({ engine: 'smp', status: 'failed', errorCode: 'NOT_CONFIGURED' }));
    expect(result.plainText).toBeUndefined();
    expect(result.latex).toBeUndefined();
    expect(result.steps).toBeUndefined();
    expect(svc.isAvailable()).toBe(false);
    expect(usage.record).toHaveBeenCalledWith(expect.objectContaining({ provider: 'smp', outcome: 'error' }));
  });
  it('detects derivative intent without executing a calculation', () => {
    expect(svc.detectAndSolve('Calcule la dérivée de x^4 - 3x^2 + 7')).toEqual({ operation: 'derivative', expression: 'x^4 - 3x^2 + 7', variable: 'x' });
  });
  it('detects bounded integral intent and preserves expression and bounds', () => {
    expect(svc.detectAndSolve('intégrale de 4x^3 entre 1 et 3')).toEqual({ operation: 'integral', expression: '4x^3', variable: 'x', bounds: { lower: '1', upper: '3' } });
  });
  it('detects equation solving intent and preserves the equation', () => {
    expect(svc.detectAndSolve('résous 5x - 20 = 0')).toEqual({ operation: 'solve', expression: '5x - 20 = 0', variable: 'x' });
  });
  it('returns null for non-mathematical questions', () => {
    expect(svc.detectAndSolve('Bonjour, qui es-tu et que peux-tu faire ?')).toBeNull();
  });
});
