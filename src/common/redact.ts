const SENSITIVE_KEY = /pass(word)?|secret|token|authorization|api[-_]?key|cookie|credential|signature|x-amz|private/i;
const BEARER = /Bearer\s+[A-Za-z0-9._~+/=-]{8,}/g;
const KEY_LIKE = /\b(sk|tvly|xi|gsk|AIza)[-_A-Za-z0-9]{16,}\b/g;

export function redactString(value: string): string {
  return value.replace(BEARER, 'Bearer [REDACTED]').replace(KEY_LIKE, '[REDACTED]');
}

/** Deep, depth-limited redaction for log payloads. Message/conversation content must not be logged at all. */
export function redact(value: unknown, depth = 0): unknown {
  if (value == null) return value;
  if (typeof value === 'string') return redactString(value).slice(0, 2000);
  if (typeof value !== 'object') return value;
  if (depth > 4) return '[TRUNCATED]';
  if (value instanceof Error) return { name: value.name, message: redactString(value.message) };
  if (Array.isArray(value)) return value.slice(0, 20).map(v => redact(v, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = SENSITIVE_KEY.test(k) ? '[REDACTED]' : redact(v, depth + 1);
  }
  return out;
}
