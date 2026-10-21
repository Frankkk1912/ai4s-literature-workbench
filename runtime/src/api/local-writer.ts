import { RateLimitedFetcher } from './http.js';
import type { FetchLike } from './http.js';
import { WebApiClient } from './web-client.js';
import type { WebApiClientOptions } from './web-client.js';
import { ZoteroApiError } from './errors.js';

/**
 * Saving through Zotero 10 and later, with no Web API key.
 *
 * Zotero 10 accepts writes on the desktop connection. It asks the user once, in a dialog inside
 * Zotero, and then hands out a write key. This file adds that key (and the server id that
 * Zotero requires on every write) to requests, so the same client code that saves through the
 * Web API saves through the desktop. Nothing here is written to disk or logged: the write key
 * lives in this process only.
 *
 * Written from Zotero's local API page (zotero.org/support/dev/web_api/v3/local_api). Zotero
 * 9 and earlier answer without a server id, and then saving needs a Zotero key.
 */

export const LOCAL_WRITE_UNSUPPORTED =
  'This version of Zotero cannot save through the desktop connection (that needs Zotero 10 or later). Add a Zotero key (call setup_status), or update Zotero.';
export const LOCAL_WRITE_DENIED =
  'You declined the request in Zotero, so nothing was saved. Ask again and choose "Allow" or "Always Allow" in the Zotero window.';
const ZOTERO_CLOSED =
  'Zotero is not open. Open Zotero on this computer (and tick "Allow other applications on this computer to communicate with Zotero" in Settings > Advanced), then try again.';

export interface LocalWriteOptions {
  port?: number;
  /** Name Zotero shows in the permission dialog. */
  appName?: string;
  /** Plain fetch, replaceable in tests. */
  fetchImpl?: FetchLike;
  /** How long to wait for the user to answer the dialog. */
  authorizeTimeoutMs?: number;
  /** Time budget for the request itself, after any dialog. */
  requestTimeoutMs?: number;
}

const isRead = (method?: string) => !method || method === 'GET' || method === 'HEAD';

export function createLocalWriteFetch(opts: LocalWriteOptions = {}): FetchLike {
  const root = `http://127.0.0.1:${opts.port ?? 23119}`;
  const base = `${root}/api`;
  const raw: FetchLike = opts.fetchImpl ?? (globalThis.fetch as FetchLike);
  const appName = opts.appName ?? 'AI4S Literature Workbench';
  const authorizeTimeoutMs = opts.authorizeTimeoutMs ?? 120_000;
  const requestTimeoutMs = opts.requestTimeoutMs ?? 25_000;

  let serverId: string | undefined;
  let key: { value: string; remember: boolean } | undefined;
  let authorizing: Promise<void> | undefined;

  const reach = async (url: string, init: RequestInit, slowMessage = 'Zotero did not answer in time.'): Promise<Response> => {
    try {
      return await raw(url, init);
    } catch (err) {
      if (err instanceof ZoteroApiError) throw err;
      if (err instanceof Error && err.name === 'TimeoutError') throw new ZoteroApiError({ status: 408, message: slowMessage });
      throw new ZoteroApiError({ status: 503, message: ZOTERO_CLOSED });
    }
  };

  const learnServerId = async (): Promise<string> => {
    const res = await reach(`${base}/`, { method: 'GET', signal: AbortSignal.timeout(requestTimeoutMs) });
    const id = res.headers.get('zotero-server-id');
    if (res.status === 403) {
      throw new ZoteroApiError({
        status: 403,
        message:
          'Zotero is open, but it is not allowing other applications to talk to it. In Zotero, open Settings > Advanced and tick "Allow other applications on this computer to communicate with Zotero".',
      });
    }
    if (!id) throw new ZoteroApiError({ status: 501, message: LOCAL_WRITE_UNSUPPORTED });
    serverId = id;
    return id;
  };

  const authorize = async (retried = false): Promise<void> => {
    const id = serverId ?? (await learnServerId());
    const res = await reach(`${base}/local/authorize`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Zotero-Server-ID': id },
      body: JSON.stringify({ appName }),
      // The user has to find the dialog and answer it, so this waits much longer than a request.
      signal: AbortSignal.timeout(authorizeTimeoutMs),
    }, 'Nobody answered the question in the Zotero window, so nothing was saved. Try again and choose "Allow" or "Always Allow".');
    if (res.status === 403) throw new ZoteroApiError({ status: 403, message: LOCAL_WRITE_DENIED });
    if (res.status === 429) {
      const wait = res.headers.get('retry-after');
      throw new ZoteroApiError({
        status: 429,
        message: `Zotero is asking too often. Wait ${wait ?? 'a minute'} seconds and try again; choosing "Always Allow" in the Zotero window avoids repeated questions.`,
      });
    }
    if (res.status === 412 || res.status === 428) {
      // Zotero was restarted since we last looked: take its new id and ask again, once.
      serverId = res.headers.get('zotero-server-id') ?? undefined;
      if (!retried) return authorize(true);
      throw new ZoteroApiError({ status: res.status, message: 'Zotero restarted or changed while asking; try again.' });
    }
    if (!res.ok) throw new ZoteroApiError({ status: res.status, message: `Zotero did not give a write permission (${res.status}).` });
    const body = (await res.json().catch(() => ({}))) as { key?: unknown; remember?: unknown };
    if (typeof body.key !== 'string' || body.key.length === 0) {
      throw new ZoteroApiError({ status: 502, message: 'Zotero answered the permission request without a key.' });
    }
    key = { value: body.key, remember: body.remember === true };
  };

  const ensureKey = async () => {
    if (key) return;
    // One dialog at a time, however many writes are waiting.
    authorizing ??= authorize().finally(() => {
      authorizing = undefined;
    });
    await authorizing;
  };

  return async (url, init = {}) => {
    if (!url.startsWith(base) || isRead(init.method)) return reach(url, init);

    for (let attempt = 0; ; attempt += 1) {
      await ensureKey();
      const id = serverId ?? (await learnServerId());
      const headers = { ...(init.headers as Record<string, string> | undefined), 'Zotero-Server-ID': id, 'Zotero-API-Key': key!.value };
      const sentKey = key;
      const res = await reach(url, { ...init, headers, signal: AbortSignal.timeout(requestTimeoutMs) });
      if (res.status === 401 && attempt === 0) {
        // Used up (a single-use key) or revoked: ask again once.
        if (key === sentKey) key = undefined;
        continue;
      }
      if ((res.status === 412 || res.status === 428) && attempt === 0 && res.headers.get('zotero-server-id') !== id) {
        // Zotero was restarted; whatever we cached about it is stale.
        serverId = res.headers.get('zotero-server-id') ?? undefined;
        key = undefined;
        continue;
      }
      // A single-use key is spent by the write that used it.
      if (res.ok && key === sentKey && key && !key.remember) key = undefined;
      return res;
    }
  };
}

/**
 * The Web API client, pointed at the desktop connection. Used only when there is no Web API
 * key and Zotero is running. Everything that is not a library call (the item-type schema)
 * still comes from the public schema endpoint.
 */
export class LocalWebClient extends WebApiClient {
  private readonly schemaClient: WebApiClient;

  constructor(opts: WebApiClientOptions & LocalWriteOptions = {}) {
    const fetcher = new RateLimitedFetcher({ fetchImpl: createLocalWriteFetch(opts), logger: opts.logger });
    super({ ...opts, apiKey: undefined, baseUrl: `http://127.0.0.1:${opts.port ?? 23119}/api`, fetcher });
    this.schemaClient = new WebApiClient({ logger: opts.logger });
  }

  /** Saving is attempted; Zotero says whether it can. */
  override get canWrite(): boolean {
    return true;
  }

  override getSchema(): Promise<any> {
    return this.schemaClient.getSchema();
  }
}
