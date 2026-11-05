export type FetchTransport = (
  url: string,
  init: RequestInit,
) => Promise<Response>;
export type IntegrationErrorCode =
  | 'denied'
  | 'missing'
  | 'rate_limited'
  | 'timeout'
  | 'malformed'
  | 'unavailable'
  | 'scope';
export class IntegrationError extends Error {
  constructor(
    readonly code: IntegrationErrorCode,
    readonly retryAfterMs = 0,
  ) {
    super(`Integration request failed: ${code}.`);
  }
}

export async function boundedJson(response: Response): Promise<unknown> {
  const reader = response.body?.getReader();
  if (!reader) throw new IntegrationError('malformed');
  const parts: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      const bytes: unknown = chunk.value;
      if (!(bytes instanceof Uint8Array))
        throw new IntegrationError('malformed');
      size += bytes.byteLength;
      if (size > 1_048_576) throw new IntegrationError('malformed');
      parts.push(bytes);
    }
    return JSON.parse(Buffer.concat(parts).toString('utf8')) as unknown;
  } catch {
    throw new IntegrationError('malformed');
  } finally {
    await reader.cancel();
  }
}
export function retryDelay(value: string | null, now = Date.now()): number {
  if (!value) return 250;
  const seconds = Number(value);
  const delay = Number.isFinite(seconds)
    ? seconds * 1000
    : Date.parse(value) - now;
  return Number.isFinite(delay) ? Math.max(0, Math.ceil(delay)) : 250;
}

export class ReadOnlyHttp {
  constructor(
    private readonly transport: FetchTransport = fetch,
    private readonly wait: (ms: number) => Promise<void> = (ms) =>
      new Promise((resolve) => {
        setTimeout(resolve, ms);
      }),
  ) {}
  async get(url: string, headers: Record<string, string>): Promise<unknown> {
    for (let attempt = 0; attempt < 3; attempt++) {
      const signal = AbortSignal.timeout(5000);
      let response: Response;
      try {
        response = await this.transport(url, {
          method: 'GET',
          headers,
          redirect: 'error',
          signal,
        });
      } catch {
        if (signal.aborted) throw new IntegrationError('timeout');
        if (attempt === 2) throw new IntegrationError('unavailable');
        await this.wait(250 * 2 ** attempt);
        continue;
      }
      if (response.status === 401 || response.status === 403) {
        await response.body?.cancel();
        throw new IntegrationError('denied');
      }
      if (response.status === 404) {
        await response.body?.cancel();
        throw new IntegrationError('missing');
      }
      if (response.status === 429 || response.status >= 500) {
        const delay = retryDelay(response.headers.get('retry-after'));
        await response.body?.cancel();
        if (attempt === 2 || delay > 2000)
          throw new IntegrationError(
            response.status === 429 ? 'rate_limited' : 'unavailable',
            delay,
          );
        await this.wait(Math.max(delay, 250 * 2 ** attempt));
        continue;
      }
      if (!response.ok) {
        await response.body?.cancel();
        throw new IntegrationError('unavailable');
      }
      return boundedJson(response);
    }
    throw new IntegrationError('unavailable');
  }
}
