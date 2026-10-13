import { ProviderError, toProviderError } from './provider-error';

/** fetch with a hard timeout and normalised failure. The provider response body is never surfaced. */
export async function fetchWithTimeout(
  provider: string, url: string | URL, init: RequestInit, timeoutMs: number,
): Promise<Response> {
  try {
    return await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  } catch (error) {
    throw toProviderError(provider, error);
  }
}

export function retryAfterSeconds(res: Response): number | undefined {
  const raw = res.headers?.get?.('retry-after');
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) && n >= 0 && n <= 300 ? n : undefined;
}

export function assertOk(provider: string, res: Response, kindFromStatusFn: (s: number) => ProviderError['kind']): void {
  if (res.ok) return;
  throw new ProviderError(provider, kindFromStatusFn(res.status), `${provider} returned HTTP ${res.status}`, res.status, retryAfterSeconds(res));
}
