import { LoggerService } from '@nestjs/common';
import { getRequestId } from './request-context';
import { redact } from './redact';

type Level = 'debug' | 'info' | 'warn' | 'error';
const ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

/** Structured JSON-lines logger (stdout/stderr) with redaction and request-id correlation. */
export class JsonLogger implements LoggerService {
  constructor(private readonly minLevel: Level = 'info') {}

  private write(level: Level, message: unknown, context?: string, extra?: Record<string, unknown>) {
    if (ORDER[level] < ORDER[this.minLevel]) return;
    const base: Record<string, unknown> = { ts: new Date().toISOString(), level, requestId: getRequestId(), context };
    const body = typeof message === 'object' && message !== null ? (message as Record<string, unknown>) : { msg: String(message) };
    const line = JSON.stringify({ ...base, ...(redact(body) as object), ...(extra ? (redact(extra) as object) : {}) });
    (level === 'error' || level === 'warn' ? process.stderr : process.stdout).write(line + '\n');
  }
  private ctx(params: unknown[]): string | undefined {
    const last = params[params.length - 1];
    return typeof last === 'string' ? last : undefined;
  }
  log(message: unknown, ...p: unknown[]) { this.write('info', message, this.ctx(p)); }
  error(message: unknown, ...p: unknown[]) {
    const stack = typeof p[0] === 'string' && p.length > 1 ? p[0] : undefined;
    this.write('error', message, this.ctx(p), stack ? { stack: stack.split('\n').slice(0, 8).join('\n') } : undefined);
  }
  warn(message: unknown, ...p: unknown[]) { this.write('warn', message, this.ctx(p)); }
  debug(message: unknown, ...p: unknown[]) { this.write('debug', message, this.ctx(p)); }
  verbose(message: unknown, ...p: unknown[]) { this.write('debug', message, this.ctx(p)); }
  fatal(message: unknown, ...p: unknown[]) { this.write('error', message, this.ctx(p)); }
}
