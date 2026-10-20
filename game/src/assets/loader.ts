/**
 * Web asset loader with concurrency limiting, in-flight request deduplication,
 * exponential backoff retry for transient network/5xx errors, and fail-fast on HTTP 404 (M2).
 */

export class AssetLoadError extends Error {
  constructor(
    message: string,
    readonly url: string,
    readonly kind: 'not-found' | 'corrupt' | 'timeout' | 'network',
    readonly status?: number,
  ) {
    super(message);
    this.name = 'AssetLoadError';
  }
}

export interface LoaderOptions {
  /** Maximum concurrent fetches allowed through this loader (default 12). */
  concurrency?: number;
  /** Maximum retry attempts for transient network / 5xx errors (default 2). */
  maxRetries?: number;
  /** Initial backoff delay in ms before retrying (default 150). */
  baseDelayMs?: number;
  /** Per-request timeout in ms (default 15000). */
  timeoutMs?: number;
  /** Custom fetch implementation (for unit tests). */
  fetchFn?: typeof fetch;
}

export class AssetLoader {
  private readonly concurrency: number;
  private readonly maxRetries: number;
  private readonly baseDelayMs: number;
  private readonly timeoutMs: number;
  private readonly fetchFn: typeof fetch;

  private active = 0;
  private queue: (() => void)[] = [];
  private inflightJson = new Map<string, Promise<unknown>>();

  constructor(opts: LoaderOptions = {}) {
    this.concurrency = Math.max(1, opts.concurrency ?? 12);
    this.maxRetries = Math.max(0, opts.maxRetries ?? 2);
    this.baseDelayMs = Math.max(10, opts.baseDelayMs ?? 150);
    this.timeoutMs = Math.max(500, opts.timeoutMs ?? 15000);
    this.fetchFn = opts.fetchFn ?? ((...args: Parameters<typeof fetch>) => fetch(...args));
  }

  /** Number of currently active requests and queued requests. */
  stats(): { active: number; queued: number } {
    return { active: this.active, queued: this.queue.length };
  }

  private acquire(): Promise<void> {
    if (this.active < this.concurrency) {
      this.active++;
      return Promise.resolve();
    }
    return new Promise<void>(resolve => {
      this.queue.push(() => {
        this.active++;
        resolve();
      });
    });
  }

  private release(): void {
    this.active = Math.max(0, this.active - 1);
    const next = this.queue.shift();
    if (next) next();
  }

  private async fetchWithRetry(url: string): Promise<Response> {
    let attempt = 0;
    for (;;) {
      await this.acquire();
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : undefined;
        const timeoutPromise = new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            ctrl?.abort();
            reject(new AssetLoadError(`載入超時 ${url}`, url, 'timeout'));
          }, this.timeoutMs);
        });
        const res = await Promise.race([
          this.fetchFn(url, ctrl ? { signal: ctrl.signal } : undefined),
          timeoutPromise,
        ]);
        if (res.ok) return res;
        // Permanent client errors (404, 403, 400): fail fast without retrying.
        if (res.status >= 400 && res.status < 500 && res.status !== 408 && res.status !== 429) {
          throw new AssetLoadError(
            `無法載入 ${url} (HTTP ${res.status}，請確認素材已就緒或執行 npm run assets)`,
            url,
            'not-found',
            res.status,
          );
        }
        throw new AssetLoadError(`伺服器回應錯誤 ${url} (HTTP ${res.status})`, url, 'network', res.status);
      } catch (err) {
        if (err instanceof AssetLoadError && err.kind === 'not-found') {
          throw err;
        }
        if (attempt >= this.maxRetries) {
          if (err instanceof AssetLoadError) throw err;
          throw new AssetLoadError(
            `網路錯誤：無法載入 ${url}（${(err as Error)?.message ?? String(err)}）`,
            url,
            'network',
          );
        }
        const delay = this.baseDelayMs * Math.pow(2, attempt);
        attempt++;
        await new Promise(r => setTimeout(r, delay));
      } finally {
        if (timer !== undefined) clearTimeout(timer);
        this.release();
      }
    }
  }

  /**
   * Fetches and parses a JSON resource with in-flight deduplication and retry.
   * Failed requests are evicted from the in-flight map so a manual retry can succeed.
   */
  fetchJson<T>(url: string): Promise<T> {
    const existing = this.inflightJson.get(url);
    if (existing) return existing as Promise<T>;
    const p = (async () => {
      const res = await this.fetchWithRetry(url);
      try {
        return (await res.json()) as T;
      } catch {
        throw new AssetLoadError(`資源清單損壞（JSON 解析失敗）：${url}`, url, 'corrupt');
      }
    })().finally(() => {
      this.inflightJson.delete(url);
    });
    this.inflightJson.set(url, p);
    return p;
  }
}

export const defaultAssetLoader = new AssetLoader();
