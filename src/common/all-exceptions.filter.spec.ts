import { BadRequestException, HttpException } from '@nestjs/common';
import { AllExceptionsFilter } from './all-exceptions.filter';
import { AppException, tooManyRequests } from './errors';

function run(exception: unknown) {
  const res: any = { headersSent: false, headers: {} as Record<string, string>, setHeader(k: string, v: string) { this.headers[k] = v; }, status(c: number) { this.code = c; return this; }, json(b: unknown) { this.body = b; } };
  const host: any = { switchToHttp: () => ({ getResponse: () => res, getRequest: () => ({ requestId: 'req-12345678', path: '/x' }) }) };
  new AllExceptionsFilter().catch(exception, host);
  return res;
}

describe('AllExceptionsFilter', () => {
  it('returns the unified contract with code and requestId', () => {
    const r = run(new AppException(404, 'DOCUMENT_NOT_FOUND', 'Document introuvable.'));
    expect(r.code).toBe(404);
    expect(r.body).toMatchObject({ statusCode: 404, code: 'DOCUMENT_NOT_FOUND', message: 'Document introuvable.', requestId: 'req-12345678' });
  });
  it('sets Retry-After for 429 errors', () => {
    const r = run(tooManyRequests('RATE_LIMITED', 'slow down', 12));
    expect(r.headers['Retry-After']).toBe('12');
  });
  it('turns class-validator arrays into VALIDATION_ERROR with details', () => {
    const r = run(new BadRequestException(['text must be a string']));
    expect(r.body).toMatchObject({ code: 'VALIDATION_ERROR', details: ['text must be a string'] });
  });
  it('never leaks internal error messages on 500', () => {
    const r = run(new Error('password=hunter2 at db.ts:10'));
    expect(r.code).toBe(500);
    expect(JSON.stringify(r.body)).not.toContain('hunter2');
    expect(r.body.code).toBe('INTERNAL_ERROR');
  });
  it('maps body-parser style errors (413)', () => {
    const r = run(Object.assign(new Error('too large'), { status: 413, type: 'entity.too.large' }));
    expect(r.code).toBe(413); expect(r.body.code).toBe('PAYLOAD_TOO_LARGE');
  });
  it('keeps plain HttpException compatible', () => {
    const r = run(new HttpException('Nope', 403));
    expect(r.code).toBe(403); expect(r.body.message).toBe('Nope');
  });
});
