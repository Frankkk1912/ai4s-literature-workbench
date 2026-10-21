import { RateLimitedFetcher } from './http.js';
import type { ItemQuery, ListResult } from './web-client.js';

/**
 * What a probe of the desktop connection found.
 *   ok           Zotero answered
 *   forbidden    Zotero is running but "Allow other applications on this computer to
 *                communicate with Zotero" is off (it answers 403)
 *   unreachable  nothing answered: Zotero is closed, or on another port
 */
export type LocalState = 'ok' | 'forbidden' | 'unreachable';

export interface LocalProbe {
  state: LocalState;
  /** Set by Zotero 10 and later, which also accept writes through the local API. */
  serverId?: string;
  version?: string;
}

/** A non-2xx answer from the desktop connection. */
export class LocalApiError extends Error {
  constructor(readonly status: number, path: string) {
    super(`Local API ${status} for ${path}`);
    this.name = 'LocalApiError';
  }
}

export interface LocalApiClientOptions {
  port?: number;
  fetcher?: RateLimitedFetcher;
}

/**
 * Read-only client for the Zotero desktop local API (Zotero 7+).
 * Base: http://127.0.0.1:<port>/api ; the personal library is always users/0.
 * Every endpoint is GET; there is no native local write support.
 */
export class LocalApiClient {
  static readonly LOCAL_USER_ID = 0;
  private readonly base: string;
  private readonly fetcher: RateLimitedFetcher;

  constructor(opts: LocalApiClientOptions = {}) {
    this.base = `http://127.0.0.1:${opts.port ?? 23119}/api`;
    this.fetcher = opts.fetcher ?? new RateLimitedFetcher();
  }

  private headers(): Record<string, string> {
    return { 'Zotero-API-Version': '3', 'x-zotero-connector-api-version': '3' };
  }

  private buildQuery(
    params: Record<string, string | number | boolean | string[] | undefined>,
  ): string {
    const sp = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (v === undefined) continue;
      if (Array.isArray(v)) v.forEach((i) => sp.append(k, String(i)));
      else sp.append(k, typeof v === 'boolean' ? (v ? '1' : '0') : String(v));
    }
    const s = sp.toString();
    return s ? `?${s}` : '';
  }

  private async getJson(path: string, query = ''): Promise<{ json: any; headers: Headers }> {
    const res = await this.fetcher.fetch(
      `${this.base}${path}${query}`,
      { method: 'GET', headers: this.headers() },
      { maxRetries: 0 },
    );
    if (!res.ok) throw new LocalApiError(res.status, path);
    return { json: await res.json(), headers: res.headers };
  }

  private toListResult<T>(json: T[], headers: Headers): ListResult<T> {
    const tr = Number(headers.get('total-results'));
    const v = Number(headers.get('last-modified-version'));
    return {
      data: json,
      totalResults: Number.isFinite(tr) ? tr : json.length,
      lastModifiedVersion: Number.isFinite(v) ? v : 0,
    };
  }

  async probe(): Promise<LocalProbe> {
    try {
      const { headers } = await this.getJson('/users/0/items', this.buildQuery({ limit: 1 }));
      return {
        state: 'ok',
        serverId: headers.get('zotero-server-id') ?? undefined,
        version: headers.get('x-zotero-version') ?? undefined,
      };
    } catch (err) {
      return { state: err instanceof LocalApiError && err.status === 403 ? 'forbidden' : 'unreachable' };
    }
  }

  async ping(): Promise<boolean> {
    return (await this.probe()).state === 'ok';
  }

  async getItemChildren(key: string, query: ItemQuery = {}): Promise<ListResult> {
    const { top: _t, collectionKey: _c, ...rest } = query;
    const { json, headers } = await this.getJson(`/users/0/items/${key}/children`, this.buildQuery(rest as any));
    return this.toListResult(json, headers);
  }

  async listItems(query: ItemQuery = {}): Promise<ListResult> {
    const { top: _t, collectionKey, ...rest } = query;
    const base = collectionKey ? `/collections/${collectionKey}` : '';
    const segment = query.top ? `${base}/items/top` : `${base}/items`;
    const { json, headers } = await this.getJson(`/users/0${segment}`, this.buildQuery(rest as any));
    return this.toListResult(json, headers);
  }

  async getItem(key: string, query: { include?: string; format?: string } = {}): Promise<any> {
    const { json } = await this.getJson(`/users/0/items/${key}`, this.buildQuery(query));
    return json;
  }

  async listCollections(
    query: { top?: boolean; limit?: number; start?: number } = {},
  ): Promise<ListResult> {
    const segment = query.top ? '/collections/top' : '/collections';
    const { top: _t, ...rest } = query;
    const { json, headers } = await this.getJson(`/users/0${segment}`, this.buildQuery(rest as any));
    return this.toListResult(json, headers);
  }
}
