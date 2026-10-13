import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

const storage = new AsyncLocalStorage<{ requestId: string }>();
const VALID_ID = /^[A-Za-z0-9._-]{8,64}$/;

export const getRequestId = (): string | undefined => storage.getStore()?.requestId;

/**
 * First middleware of the stack: assigns/propagates a correlation id (client-supplied ids are accepted only
 * if they are short and URL-safe) and emits one structured access-log line per request. Query strings and
 * bodies are never logged (they may hold presigned URLs, prompts or personal data).
 */
export function requestContext(logger: { log: (m: unknown) => void }) {
  return (req: Request, res: Response, next: NextFunction) => {
    const inbound = req.headers['x-request-id'];
    const requestId = typeof inbound === 'string' && VALID_ID.test(inbound) ? inbound : randomUUID();
    (req as Request & { requestId: string }).requestId = requestId;
    res.setHeader('X-Request-Id', requestId);
    const started = process.hrtime.bigint();
    res.on('finish', () => {
      const durationMs = Number((process.hrtime.bigint() - started) / 1_000_000n);
      const user = (req as Request & { aurexUser?: { id: string } }).aurexUser;
      logger.log({
        msg: 'http_request', requestId, method: req.method,
        route: req.route?.path ?? req.baseUrl ?? req.path, status: res.statusCode, durationMs,
        ...(user ? { userId: user.id } : {}),
      });
    });
    storage.run({ requestId }, next);
  };
}
