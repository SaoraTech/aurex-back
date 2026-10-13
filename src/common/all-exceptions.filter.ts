import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import type { Request, Response } from 'express';
import { AppException } from './errors';
import { redactString } from './redact';

const STATUS_TEXT: Record<number, string> = {
  400: 'Bad Request', 401: 'Unauthorized', 403: 'Forbidden', 404: 'Not Found', 409: 'Conflict',
  413: 'Payload Too Large', 415: 'Unsupported Media Type', 422: 'Unprocessable Entity', 429: 'Too Many Requests',
  500: 'Internal Server Error', 502: 'Bad Gateway', 503: 'Service Unavailable', 504: 'Gateway Timeout',
};

/**
 * Single error contract for the whole API:
 *   { statusCode, error, code, message, details?, requestId }
 * (`statusCode` + `message` stay compatible with the default Nest shape.) 5xx details are logged server-side
 * only; clients receive generic messages.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('Exceptions');

  catch(exception: unknown, host: ArgumentsHost) {
    const http = host.switchToHttp();
    const res = http.getResponse<Response>();
    const req = http.getRequest<Request & { requestId?: string }>();
    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let code = 'INTERNAL_ERROR';
    let message = 'Une erreur interne est survenue.';
    let details: unknown;

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const body = exception.getResponse();
      if (typeof body === 'string') { message = body; code = defaultCode(status); }
      else {
        const b = body as Record<string, unknown>;
        code = typeof b.code === 'string' ? b.code : defaultCode(status);
        if (Array.isArray(b.message)) { code = 'VALIDATION_ERROR'; message = 'Requête invalide.'; details = b.message; }
        else if (typeof b.message === 'string') message = b.message;
        if (b.details !== undefined) details = b.details;
      }
      if (exception instanceof AppException && exception.retryAfterSeconds != null) {
        res.setHeader('Retry-After', String(Math.ceil(exception.retryAfterSeconds)));
      }
    } else if (isHttpError(exception)) {
      // Errors raised by Express middleware (body-parser: entity.too.large, entity.parse.failed, ...).
      status = exception.status ?? exception.statusCode ?? 400;
      code = exception.type === 'entity.too.large' ? 'PAYLOAD_TOO_LARGE' : defaultCode(status);
      message = status === 413 ? 'Le corps de la requête dépasse la taille autorisée.' : 'Requête invalide.';
    }

    if (status >= 500) {
      const err = exception instanceof Error ? exception : new Error(String(exception));
      this.logger.error({ msg: 'unhandled_error', code, status, path: req?.path, error: redactString(err.message) }, err.stack);
    } else if (status === 429 || status === 403) {
      this.logger.warn({ msg: 'request_rejected', code, status, path: req?.path });
    }
    if (res.headersSent) return;
    res.status(status).json({
      statusCode: status, error: STATUS_TEXT[status] ?? 'Error', code, message,
      ...(details !== undefined ? { details } : {}), requestId: req?.requestId,
    });
  }
}

function defaultCode(status: number): string {
  const map: Record<number, string> = {
    400: 'BAD_REQUEST', 401: 'UNAUTHENTICATED', 403: 'FORBIDDEN', 404: 'NOT_FOUND', 409: 'CONFLICT',
    413: 'PAYLOAD_TOO_LARGE', 415: 'UNSUPPORTED_MEDIA_TYPE', 429: 'RATE_LIMITED', 503: 'SERVICE_UNAVAILABLE',
  };
  return map[status] ?? (status >= 500 ? 'INTERNAL_ERROR' : 'REQUEST_ERROR');
}
function isHttpError(e: unknown): e is { status?: number; statusCode?: number; type?: string } {
  return typeof e === 'object' && e !== null && (typeof (e as any).status === 'number' || typeof (e as any).statusCode === 'number');
}
