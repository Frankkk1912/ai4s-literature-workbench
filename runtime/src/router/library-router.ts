import type { ZoteusConfig } from '../config.js';
import type { Capabilities } from './capabilities.js';
import type {
  WebApiClient,
  LibraryRef,
  ItemQuery,
  ItemResult,
  ListResult,
  KeyInfo,
} from '../api/web-client.js';
import { LocalApiError } from '../api/local-client.js';
import type { LocalApiClient, LocalProbe } from '../api/local-client.js';

export interface LibraryRouterOptions {
  config: ZoteusConfig;
  capabilities: Capabilities;
  web: WebApiClient;
  local?: LocalApiClient;
  /** Milliseconds-since-epoch source, replaceable in tests. */
  now?: () => number;
}

export interface ReadOpts {
  library?: LibraryRef;
}

/** How often a closed or switched-off desktop connection is looked at again. */
const REPROBE_AFTER_MS = 20_000;

/** Bound cloud preference to 30 seconds: desktop/cloud version scales may never converge. */
export const CLOUD_WRITE_TTL_MS = 30_000;
export type ReadSource = 'local' | 'cloud';

/**
 * Decides whether a READ is served by the desktop local API or the cloud Web API.
 * Rule: use local only for the default personal (user) library when the local API
 * is up and not disabled; everything else (group libraries, or local down) -> cloud.
 *
 * The desktop connection is not fixed at start: Zotero may be opened (or the setting
 * switched on) later, or closed mid-session, so it is looked at again when it is down
 * and dropped when a call to it fails.
 */
export class LibraryRouter {
  private readonly config: ZoteusConfig;
  private readonly capabilities: Capabilities;
  private readonly web: WebApiClient;
  private readonly local?: LocalApiClient;
  private readonly now: () => number;
  private lastProbeAt = 0;
  private probing?: Promise<void>;
  private readonly cloudWrites = new Map<string, { version: number; at: number }>();

  constructor(opts: LibraryRouterOptions) {
    this.config = opts.config;
    this.capabilities = opts.capabilities;
    this.web = opts.web;
    this.local = opts.local;
    this.now = opts.now ?? Date.now;
    this.lastProbeAt = this.now();
    this.web.onCloudWrite((library, version) => this.recordCloudWrite(library, version));
  }

  private libraryKey(library: LibraryRef): string {
    return this.isPersonal(library) ? 'personal' : `${library.type}/${library.id}`;
  }

  recordCloudWrite(library: LibraryRef, version: number): void {
    const key = this.libraryKey(library);
    const previous = this.cloudWrites.get(key);
    this.cloudWrites.set(key, {
      version: version > 0 ? Math.max(previous?.version ?? 0, version) : 0,
      at: this.now(),
    });
  }

  whoami(): KeyInfo | null {
    return this.capabilities.cloud;
  }

  defaultLibrary(): LibraryRef {
    if (this.config.libraryId) return { type: this.config.libraryType, id: this.config.libraryId };
    if (this.capabilities.cloud) return { type: 'user', id: this.capabilities.cloud.userID };
    // Local-only mode: the desktop personal library is addressed as users/0.
    return { type: 'user', id: 0 };
  }

  /** Look at the desktop connection again. Without `force`, at most once per interval while it is down. */
  async refreshLocal(force = false): Promise<void> {
    if (!this.local || this.config.local === 'off') return;
    if (!force && (this.capabilities.localApi || this.now() - this.lastProbeAt < REPROBE_AFTER_MS))
      return;
    this.probing ??= (async () => {
      let found: LocalProbe;
      try {
        found = await this.local!.probe();
      } catch {
        found = { state: 'unreachable' };
      }
      this.lastProbeAt = this.now();
      this.capabilities.localApi = found.state === 'ok';
      this.capabilities.localState = found.state;
      this.capabilities.localServerId = found.serverId;
    })().finally(() => {
      this.probing = undefined;
    });
    await this.probing;
  }

  private isPersonal(library: LibraryRef): boolean {
    const def = this.defaultLibrary();
    // Local API only serves the personal library (users/0 maps to the default user library).
    return library.type === 'user' && (library.id === def.id || library.id === 0);
  }

  private async useLocal(library: LibraryRef): Promise<boolean> {
    if (!this.local || this.config.local === 'off' || !this.isPersonal(library)) return false;
    await this.refreshLocal();
    return this.capabilities.localApi;
  }

  /** Words for a read that has nowhere to go: no key, and no desktop connection. */
  private noBackend(): Error {
    const state = this.capabilities.localState;
    return new Error(
      state === 'forbidden'
        ? 'Zotero is open, but it is not allowing other applications to talk to it. In Zotero, open Settings > Advanced and tick "Allow other applications on this computer to communicate with Zotero", or add a Zotero key (call setup_status).'
        : 'Zotero is not reachable and there is no Zotero key. Open Zotero on this computer (and tick "Allow other applications on this computer to communicate with Zotero" in Settings > Advanced), or add a Zotero key (call setup_status).',
    );
  }

  /**
   * Run a read on the desktop connection or, when that is not usable, on the cloud. A failure
   * of the desktop connection itself (closed, switched off, server error) drops it and falls
   * back; an answer about the data (for example "not found") is returned as it is.
   */
  private async read<T extends { lastModifiedVersion: number }>(
    library: LibraryRef,
    local: () => Promise<T>,
    cloud: () => Promise<T>,
  ): Promise<T & { source: ReadSource }> {
    const key = this.libraryKey(library);
    const pending = this.cloudWrites.get(key);
    if (pending && this.now() - pending.at >= CLOUD_WRITE_TTL_MS) {
      this.cloudWrites.delete(key);
    }
    if (await this.useLocal(library)) {
      try {
        const result = await local();
        // Recheck after the request so an overlapping cloud write cannot be lost.
        const latest = this.cloudWrites.get(key);
        if (!latest || (latest.version > 0 && result.lastModifiedVersion >= latest.version)) {
          if (latest) this.cloudWrites.delete(key);
          return { ...result, source: 'local' };
        }
      } catch (err) {
        const dataAnswer = err instanceof LocalApiError && err.status !== 403 && err.status < 500;
        if (dataAnswer && !this.cloudWrites.has(key)) throw err;
        // A stale desktop 404 after a create is not authoritative.
        if (dataAnswer) return { ...(await cloud()), source: 'cloud' };
        this.capabilities.localApi = false;
        this.capabilities.localState =
          err instanceof LocalApiError && err.status === 403 ? 'forbidden' : 'unreachable';
        this.lastProbeAt = this.now();
      }
    }
    if (!this.web.hasKey && this.isPersonal(library)) throw this.noBackend();
    return { ...(await cloud()), source: 'cloud' };
  }

  async searchItems(
    query: ItemQuery & ReadOpts = {},
  ): Promise<ListResult & { source: ReadSource }> {
    const { library, ...q } = query;
    const lib = library ?? this.defaultLibrary();
    return this.read(
      lib,
      () => this.local!.listItems(q),
      () => this.web.listItems(lib, q),
    );
  }

  async getItem(
    key: string,
    opts: ReadOpts & { include?: string; format?: string } = {},
  ): Promise<any> {
    return (await this.getItemWithMetadata(key, opts)).data;
  }

  async getItemWithMetadata(
    key: string,
    opts: ReadOpts & { include?: string; format?: string } = {},
  ): Promise<ItemResult & { source: ReadSource }> {
    const { library, ...rest } = opts;
    const lib = library ?? this.defaultLibrary();
    return this.read(
      lib,
      () => this.local!.getItemWithMetadata(key, rest),
      () => this.web.getItemWithMetadata(lib, key, rest),
    );
  }

  async getItemChildren(
    key: string,
    opts: ReadOpts & ItemQuery = {},
  ): Promise<ListResult & { source: ReadSource }> {
    const { library, ...rest } = opts;
    const lib = library ?? this.defaultLibrary();
    return this.read(
      lib,
      () => this.local!.getItemChildren(key, rest),
      () => this.web.getItemChildren(lib, key, rest),
    );
  }

  async listCollections(
    opts: ReadOpts & { top?: boolean; limit?: number; start?: number } = {},
  ): Promise<ListResult & { source: ReadSource }> {
    const { library, ...rest } = opts;
    const lib = library ?? this.defaultLibrary();
    return this.read(
      lib,
      () => this.local!.listCollections(rest),
      () => this.web.listCollections(lib, rest),
    );
  }
}
