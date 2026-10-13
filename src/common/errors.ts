import { HttpException } from '@nestjs/common';

/**
 * Typed application error. `code` is a stable machine-readable identifier that clients may branch on;
 * `message` is safe to show to a user (never contains secrets, provider bodies or stack traces).
 */
export class AppException extends HttpException {
  constructor(
    status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
    public readonly retryAfterSeconds?: number,
  ) {
    super({ code, message, ...(details !== undefined ? { details } : {}) }, status);
  }
}

export const badRequest = (code: string, message: string, details?: unknown) => new AppException(400, code, message, details);
export const notFound = (code: string, message: string) => new AppException(404, code, message);
export const conflict = (code: string, message: string) => new AppException(409, code, message);
export const payloadTooLarge = (code: string, message: string) => new AppException(413, code, message);
export const unsupportedMedia = (code: string, message: string) => new AppException(415, code, message);
export const tooManyRequests = (code: string, message: string, retryAfterSeconds?: number) =>
  new AppException(429, code, message, undefined, retryAfterSeconds);
export const serviceUnavailable = (code: string, message: string, retryAfterSeconds?: number) =>
  new AppException(503, code, message, undefined, retryAfterSeconds);
