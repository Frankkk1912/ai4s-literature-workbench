import type { ZoteusConfig } from '../config.js';
import type { Capabilities } from './capabilities.js';
import type { WebApiClient, LibraryRef, ItemQuery, ListResult, KeyInfo } from '../api/web-client.js';
import { LocalApiError } from '../api/local-client.js';
import type { LocalApiClient, LocalProbe } from '../api/local-client.js';

export interface LibraryRouterOptions {
  config: ZoteusConfig;
  capabilities: Capabilities;
  web: WebApiClient;
  local?: LocalApiClient;
  /** Seconds-since-epoch source, replaceable in tests. */
  now?: () => number;
}

export interface ReadOpts {
  library?: LibraryRef;
}

/** How often a closed or switched-off desktop connection is looked at again. */
const REPROBE_AFTER_MS = 20_000;

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

  constructor(opts: LibraryRouterOptions) {
    this.config = opts.config;
    this.capabilities = opts.capabilities;
    this.web = opts.web;
    this.local = opts.local;
    this.now = opts.now ?? Date.now;
    this.lastProbeAt = this.now();
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
    if (!force && (this.capabilities.localApi || this.now() - this.lastProbeAt < REPROBE_AFTER_MS)) return;
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
  private async read<T>(library: LibraryRef, local: () => Promise<T>, cloud: () => Promise<T>): Promise<T> {
    if (await this.useLocal(library)) {
      try {
        return await local();
      } catch (err) {
        const dataAnswer = err instanceof LocalApiError && err.status !== 403 && err.status < 500;
        if (dataAnswer) throw err;
        this.capabilities.localApi = false;
        this.capabilities.localState = err instanceof LocalApiError && err.status === 403 ? 'forbidden' : 'unreachable';
        this.lastProbeAt = this.now();
      }
    }
    if (!this.web.hasKey && this.isPersonal(library)) throw this.noBackend();
    return cloud();
  }

  async searchItems(query: ItemQuery & ReadOpts = {}): Promise<ListResult> {
    const { library, ...q } = query;
    const lib = library ?? this.defaultLibrary();
    return this.read(lib, () => this.local!.listItems(q), () => this.web.listItems(lib, q));
  }

  async getItem(
    key: string,
    opts: ReadOpts & { include?: string; format?: string } = {},
  ): Promise<any> {
    const { library, ...rest } = opts;
    const lib = library ?? this.defaultLibrary();
    return this.read(lib, () => this.local!.getItem(key, rest), () => this.web.getItem(lib, key, rest));
  }

  async getItemChildren(key: string, opts: ReadOpts & ItemQuery = {}): Promise<ListResult> {
    const { library, ...rest } = opts;
    const lib = library ?? this.defaultLibrary();
    return this.read(lib, () => this.local!.getItemChildren(key, rest), () => this.web.getItemChildren(lib, key, rest));
  }

  async listCollections(
    opts: ReadOpts & { top?: boolean; limit?: number; start?: number } = {},
  ): Promise<ListResult> {
    const { library, ...rest } = opts;
    const lib = library ?? this.defaultLibrary();
    return this.read(lib, () => this.local!.listCollections(rest), () => this.web.listCollections(lib, rest));
  }
}
