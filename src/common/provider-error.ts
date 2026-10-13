import { AppException } from './errors';

export type ProviderErrorKind =
  | 'not_configured' | 'invalid_request' | 'auth' | 'rate_limited'
  | 'quota' | 'timeout' | 'unavailable' | 'bad_response';

/** Error raised by an external-provider adapter. Never carries provider response bodies. */
export class ProviderError extends Error {
  constructor(
    public readonly provider: string,
    public readonly kind: ProviderErrorKind,
    message: string,
    public readonly status?: number,
    public readonly retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}

/**
 * A fallback provider may take over only when the failure is about the provider (availability, quota,
 * credentials, bad output) and NOT about the request itself. An invalid or unauthorised request must
 * never trigger a second billed call elsewhere.
 */
export function isFallbackEligible(kind: ProviderErrorKind): boolean {
  return kind === 'rate_limited' || kind === 'quota' || kind === 'timeout'
    || kind === 'unavailable' || kind === 'auth' || kind === 'bad_response';
}

export function kindFromStatus(status: number): ProviderErrorKind {
  if (status === 401 || status === 403) return 'auth';
  if (status === 402 || status === 432 || status === 433) return 'quota';
  if (status === 429) return 'rate_limited';
  if (status === 408 || status === 504) return 'timeout';
  if (status >= 500) return 'unavailable';
  if (status >= 400) return 'invalid_request';
  return 'bad_response';
}

export function isTimeoutError(error: unknown): boolean {
  return typeof error === 'object' && error !== null
    && ((error as { name?: string }).name === 'TimeoutError' || (error as { name?: string }).name === 'AbortError');
}

/** Wraps any thrown value from a fetch-based adapter into a ProviderError. */
export function toProviderError(provider: string, error: unknown): ProviderError {
  if (error instanceof ProviderError) return error;
  if (isTimeoutError(error)) return new ProviderError(provider, 'timeout', `${provider} request timed out`);
  const status = (error as { status?: number; statusCode?: number })?.status ?? (error as { statusCode?: number })?.statusCode;
  if (typeof status === 'number') return new ProviderError(provider, kindFromStatus(status), `${provider} request failed`, status);
  return new ProviderError(provider, 'unavailable', `${provider} is unreachable`);
}

/** Maps a provider failure to the HTTP error returned to Aurex clients (generic, no provider internals). */
export function providerErrorToHttp(error: ProviderError, publicName = 'Le fournisseur'): AppException {
  switch (error.kind) {
    case 'invalid_request': return new AppException(400, 'PROVIDER_REJECTED_REQUEST', `${publicName} a refusé la requête.`);
    case 'not_configured': return new AppException(503, 'PROVIDER_NOT_CONFIGURED', `${publicName} n'est pas configuré sur ce serveur.`);
    case 'rate_limited': return new AppException(503, 'PROVIDER_RATE_LIMITED', `${publicName} est temporairement saturé. Réessayez plus tard.`, undefined, error.retryAfterSeconds ?? 5);
    case 'timeout': return new AppException(504, 'PROVIDER_TIMEOUT', `${publicName} n'a pas répondu à temps.`);
    default: return new AppException(502, 'PROVIDER_UNAVAILABLE', `${publicName} est momentanément indisponible.`);
  }
}
