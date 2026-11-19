import type { ToolContext } from '../../registry/registry.js';
import { normalizeDoi } from './graph.js';

/** Zotero's item page size. Larger pages are rejected by the API. */
export const LIBRARY_DOI_PAGE_SIZE = 100;
const MAX_LIB_ITEMS = 5000;
const WAVE = 4;
/** How long a version-less library snapshot may be reused. */
const UNVERSIONED_TTL_MS = 60_000;

interface DoiCacheEntry {
  version: number;
  dois: Set<string>;
  at: number;
}

let cache = new WeakMap<ToolContext, DoiCacheEntry>();

/** Drop cached DOI sets. Tests use this so cases do not share a context. */
export function clearLibraryDoiCache(): void {
  cache = new WeakMap();
}

function itemKey(item: any): string {
  const key = item?.key ?? item?.data?.key;
  return key ? String(key) : '';
}

function collectDois(target: Set<string>, items: any[]): void {
  for (const item of items) {
    const raw = item?.data?.DOI ?? item?.DOI;
    if (!raw) continue;
    const doi = normalizeDoi(String(raw));
    if (doi) target.add(doi);
  }
}

/**
 * Ingest one page. Returns true when paging should stop: an empty page, or a
 * page whose item keys were all seen already (the API ignored `start` and is
 * repeating the first page).
 */
function ingestPage(
  page: { data?: any[]; totalResults?: number; lastModifiedVersion?: number },
  dois: Set<string>,
  seenKeys: Set<string>,
  state: { total: number; version: number },
): boolean {
  if (page.lastModifiedVersion && page.lastModifiedVersion > 0) state.version = page.lastModifiedVersion;
  if (Number.isFinite(page.totalResults)) state.total = page.totalResults as number;
  const items = page.data ?? [];
  if (!items.length) return true;
  collectDois(dois, items);
  const keys = items.map(itemKey).filter(Boolean);
  if (keys.length !== items.length) return false;
  const added = keys.filter((key) => !seenKeys.has(key));
  for (const key of keys) seenKeys.add(key);
  return added.length === 0;
}

/**
 * DOIs of top-level library items.
 *
 * A scholar call only needs to know which of a handful of result DOIs are
 * already saved. Scanning every child note, attachment, and annotation (up to
 * 5,000 items) on each call is what made `zotero_scholar` exceed the tool
 * timeout. This reads top-level items only, stops if a page repeats, and
 * reuses the set while the library version is unchanged.
 */
export async function libraryDoiSet(ctx: ToolContext): Promise<Set<string>> {
  const cached = cache.get(ctx);
  if (cached) {
    if (cached.version > 0) {
      const probe = await ctx.router.searchItems({ limit: 1, top: true });
      if (probe.lastModifiedVersion === cached.version) return cached.dois;
    } else if (Date.now() - cached.at < UNVERSIONED_TTL_MS) {
      return cached.dois;
    }
  }

  const dois = new Set<string>();
  const seenKeys = new Set<string>();
  const state = { total: Number.POSITIVE_INFINITY, version: 0 };
  const first = await ctx.router.searchItems({ limit: LIBRARY_DOI_PAGE_SIZE, start: 0, top: true });
  let stop = ingestPage(first, dois, seenKeys, state);
  let start = LIBRARY_DOI_PAGE_SIZE;

  while (!stop && start < state.total && start < MAX_LIB_ITEMS) {
    const starts: number[] = [];
    for (let i = 0; i < WAVE && start < state.total && start < MAX_LIB_ITEMS; i += 1) {
      starts.push(start);
      start += LIBRARY_DOI_PAGE_SIZE;
    }
    const pages = await Promise.all(
      starts.map((pageStart) => ctx.router.searchItems({ limit: LIBRARY_DOI_PAGE_SIZE, start: pageStart, top: true })),
    );
    for (const page of pages) {
      if (ingestPage(page, dois, seenKeys, state)) {
        stop = true;
        break;
      }
    }
  }

  cache.set(ctx, { version: state.version, dois, at: Date.now() });
  return dois;
}
