export function fromNodeHeaders(nodeHeaders: Record<string, string | string[] | undefined> = {}): Headers {
  const webHeaders = new Headers();
  for (const [key, value] of Object.entries(nodeHeaders)) {
    if (value !== undefined && value !== null) {
      if (Array.isArray(value)) value.forEach(v => webHeaders.append(key, v));
      else webHeaders.set(key, String(value));
    }
  }
  return webHeaders;
}

export const toNodeHandler = (_auth: unknown) => (_req: unknown, _res: unknown) => {};
