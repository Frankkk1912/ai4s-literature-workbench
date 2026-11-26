import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { FetchLike } from '../api/http.js';
import type { LibraryRef } from '../api/web-client.js';
import type { ToolContext } from '../registry/registry.js';
import { canonicalMetricsPlanHash, executeMetricsPlan, type MetricsPlan, type MetricsPlanAction } from './metrics-plan.js';
import { isPreprintEvidence, metricFromEvidence } from './evidence-metrics.js';
import {
  EasyScholarClient,
  defaultEasyScholarCacheFile,
  hasUsableRankData,
  legacyEasyScholarCacheFiles,
  loadEasyScholarCache,
  normalizeJournalKey,
  resolveEasyScholarKey,
  saveEasyScholarCache,
  type EasyScholarRankEntry,
} from './scholar/easyscholar.js';

/**
 * One-step metrics backfill for an existing Zotero collection or selected items.
 *
 * Every item and every version number comes from the cloud Web API
 * (api.zotero.org); desktop local-API versions never enter the plan. Journal
 * ranks come from EasyScholar through the shared client/cache, using only the
 * locally configured key. The result is a `MetricsPlan` that is executed by the
 * existing `executeMetricsPlan` — this module never writes items itself.
 */
export interface MetricsBackfillInput {
  collection_key?: string;
  item_keys?: string[];
  mode: 'dry_run' | 'apply';
  metrics_year?: number;
  source_label?: string;
  confirm_plan_hash?: string;
  receipt_path?: string;
  /** Optional absolute path for reviewing the built plan as JSON. */
  plan_path?: string;
  /** Optional EasyScholar cache file override (default: the shared workbench cache). */
  easyscholar_cache_path?: string;
  /** Optional cap on the number of processed items. */
  limit?: number;
}

export interface MetricsBackfillDeps {
  /** Injected in tests; defaults to the locally configured key. */
  secretKey?: string | null;
  fetchImpl?: FetchLike;
  minIntervalMs?: number;
  now?: () => Date;
  /** EasyScholar retry count; the production default is 3 (in EasyScholarClient). */
  retries?: number;
}

export interface MetricsBackfillResult {
  mode: 'dry_run' | 'apply';
  status: string;
  plan_hash: string;
  original_plan_hash: string;
  metrics: { metrics_year: number; source_label: string };
  selected: number;
  update: number;
  skip: number;
  skip_reasons: Record<string, number>;
  capped?: boolean;
  easyscholar: {
    key_configured: boolean;
    unique_journals: number;
    cache_hits: number;
    api_calls: number;
    fetch_errors: number;
    matched: number;
    unmatched: number;
    cache: string;
    min_interval_ms: number;
  };
  conflicts: string[];
  version_refreshes: number;
  conflict_summary: { local_cloud_version_mismatch: number; cloud_version_moved: number };
  summary: Record<string, number>;
  message?: string;
  refreshed_plan?: MetricsPlan;
  receipt_path?: string;
  plan_path?: string;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
function deepSort(value: unknown): JsonValue {
  if (Array.isArray(value)) return value.map(deepSort);
  if (isObject(value)) {
    const output: { [key: string]: JsonValue } = {};
    for (const key of Object.keys(value).sort()) output[key] = deepSort(value[key]);
    return output;
  }
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' || value === null) return value;
  return null;
}

const sha256Hex = (value: string) => createHash('sha256').update(value, 'utf8').digest('hex');

function dataOf(item: unknown): Record<string, unknown> {
  if (isObject(item) && isObject(item.data)) return item.data as Record<string, unknown>;
  return isObject(item) ? item : {};
}

function versionOf(item: unknown): number | null {
  const candidate = isObject(item) ? item.version : undefined;
  const value = candidate ?? dataOf(item).version;
  return typeof value === 'number' && Number.isInteger(value) ? value : null;
}

function keyOf(item: unknown): string {
  const candidate = isObject(item) ? item.key : undefined;
  return String(candidate ?? dataOf(item).key ?? '');
}

/** Same conservative ISSN normalization as the literature-manager script. */
function normalizeIssn(value: unknown): string {
  const text = String(value ?? '').replace(/[^0-9Xx]/g, '').toUpperCase();
  return text.length === 8 ? text : '';
}

function itemIssns(data: Record<string, unknown>): string[] {
  const found = new Set<string>();
  for (const field of ['ISSN', 'issn', 'eISSN', 'eissn']) {
    for (const candidate of String(data[field] ?? '').split(/[;,/\s]+/)) {
      const normalized = normalizeIssn(candidate);
      if (normalized) found.add(normalized);
    }
  }
  return [...found].sort();
}

function compactSpace(value: unknown): string {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

interface JournalFetch {
  entry: EasyScholarRankEntry | null;
  error?: string;
}

/** Fetch top-level collection items from the cloud Web API, paginated. */
async function fetchCollectionItems(ctx: ToolContext, lib: LibraryRef, collectionKey: string, limit?: number): Promise<unknown[]> {
  const items: unknown[] = [];
  const pageSize = 100;
  let start = 0;
  for (;;) {
    const page = await ctx.web.listItems(lib, { collectionKey, top: true, limit: pageSize, start });
    items.push(...page.data);
    const total = page.totalResults ?? items.length;
    if (items.length >= total || page.data.length === 0) break;
    if (limit !== undefined && items.length >= limit) break;
    start += page.data.length;
  }
  return items;
}

/** Batch EasyScholar provenance digest over the journals that entered the plan. */
function batchSourceSha256(fetched: Map<string, JournalFetch>, journals: Map<string, string>): string {
  const payload = [...journals.keys()].sort().map((normalized) => {
    const fetch = fetched.get(normalized);
    const entry = fetch?.entry;
    return {
      journal: journals.get(normalized)!,
      ...(entry
        ? { official_rank: entry.official_rank, custom_rank: entry.custom_rank, fetched_at: entry.fetched_at }
        : { error: fetch?.error ?? 'not-fetched' }),
    };
  });
  return sha256Hex(JSON.stringify(deepSort(payload)));
}

interface Draft {
  data: Record<string, unknown>;
  key: string;
  version: number | null;
  issns: string[];
  journal?: string;
  reason?: string;
}

function classify(item: unknown, seen: Set<string>): Draft {
  const data = dataOf(item);
  const draft: Draft = { data, key: keyOf(item), version: versionOf(item), issns: itemIssns(data) };
  if (!draft.key) {
    draft.reason = 'missing-item-key';
  } else if (seen.has(draft.key)) {
    draft.reason = 'duplicate-item-key';
  } else {
    seen.add(draft.key);
    if (draft.version === null) {
      draft.reason = isObject(item) && item.fetch_error !== undefined ? 'item-fetch-failed' : 'missing-cloud-version';
    } else if (isPreprintEvidence({ itemType: data.itemType, journal: data.publicationTitle })) {
      draft.reason = 'preprint';
    } else if (data.itemType !== 'journalArticle') {
      draft.reason = 'not-a-journal-article';
    } else {
      const journal = compactSpace(data.publicationTitle);
      if (!journal) draft.reason = 'no-journal-name';
      else draft.journal = journal;
    }
  }
  return draft;
}

export async function backfillMetrics(
  ctx: ToolContext,
  lib: LibraryRef,
  input: MetricsBackfillInput,
  deps: MetricsBackfillDeps = {},
): Promise<MetricsBackfillResult> {
  if (ctx.web.isCloud !== true) {
    throw new Error(
      'Metrics backfill requires the real Zotero cloud Web API (api.zotero.org) and Web API credentials; LocalWebClient versions are local API versions, not cloud versions. Call setup_status.',
    );
  }
  const now = deps.now ?? (() => new Date());
  const mode = input.mode;
  const metricYear = input.metrics_year ?? now().getUTCFullYear() - 1;
  const sourceLabel = input.source_label?.trim() || 'easyscholar-latest';

  // 1. Items and cloud versions — always from ctx.web (the cloud client).
  let items: unknown[];
  if (input.collection_key) {
    items = await fetchCollectionItems(ctx, lib, input.collection_key, input.limit);
  } else {
    const keys = [...new Set(input.item_keys ?? [])];
    items = await Promise.all(
      keys.map(async (key) => {
        try {
          return await ctx.web.getItem(lib, key);
        } catch (error) {
          // SAFETY: a failed single-item read becomes one skipped action; it must not abort the batch.
          return { key, data: {}, fetch_error: error instanceof Error ? error.message : String(error) };
        }
      }),
    );
  }
  let capped = false;
  if (input.limit !== undefined && items.length > input.limit) {
    items = items.slice(0, input.limit);
    capped = true;
  }

  // 2. Classify items; collect the unique journals that need EasyScholar data.
  const seen = new Set<string>();
  const journals = new Map<string, string>(); // normalized key -> original name
  const drafts: Draft[] = [];
  for (const item of items) {
    const draft = classify(item, seen);
    if (draft.journal !== undefined) {
      const normalized = normalizeJournalKey(draft.journal);
      if (!journals.has(normalized)) journals.set(normalized, draft.journal);
    }
    drafts.push(draft);
  }

  // 3. EasyScholar: shared cache first, then rate-limited live fetches.
  const secretKey = deps.secretKey !== undefined ? deps.secretKey : resolveEasyScholarKey();
  // Same resolution as the skill's load: an explicit path, else the first
  // existing file among the default and legacy locations, else the default.
  const cachePath =
    input.easyscholar_cache_path?.trim() ||
    [defaultEasyScholarCacheFile(), ...legacyEasyScholarCacheFiles()].find((candidate) => existsSync(candidate)) ||
    defaultEasyScholarCacheFile();
  const cache = loadEasyScholarCache(cachePath, now);
  const fetched = new Map<string, JournalFetch>();
  let cacheHits = 0;
  let apiCalls = 0;
  let fetchErrors = 0;
  const client = new EasyScholarClient({
    secretKey,
    fetchImpl: deps.fetchImpl,
    minIntervalMs: deps.minIntervalMs,
    now,
    retries: deps.retries,
  });
  for (const [normalized, journal] of journals) {
    const cached = cache.entries[normalized];
    if (cached) {
      fetched.set(normalized, { entry: cached });
      cacheHits += 1;
      continue;
    }
    if (!secretKey) {
      fetched.set(normalized, { entry: null, error: 'api-key-not-configured' });
      continue;
    }
    const result = await client.fetchRank(journal);
    apiCalls += 1;
    if (!result.ok) {
      fetched.set(normalized, { entry: null, error: result.error });
      fetchErrors += 1;
      continue;
    }
    fetched.set(normalized, { entry: result.entry! });
    // Same convention as the skill: cache every API answer (including empty
    // ranks) so repeated runs do not re-query the same journal.
    cache.entries[normalized] = result.entry!;
    saveEasyScholarCache(cachePath, cache, now);
  }

  // 4. Build plan actions with the shared metric mapping.
  const actions: MetricsPlanAction[] = [];
  const skipReasons: Record<string, number> = {};
  for (const draft of drafts) {
    const base = { item_key: draft.key, expected_version: draft.version, title: String(draft.data.title ?? ''), issns: draft.issns };
    if (draft.reason) {
      actions.push({ ...base, decision: 'skip', reason_codes: [draft.reason], metric: null });
      skipReasons[draft.reason] = (skipReasons[draft.reason] ?? 0) + 1;
      continue;
    }
    const normalized = normalizeJournalKey(draft.journal!);
    const fetch = fetched.get(normalized);
    const entry = fetch?.entry;
    if (!entry) {
      const reason = fetch?.error === 'api-key-not-configured' ? 'easyscholar-key-not-configured' : 'easyscholar-fetch-failed';
      actions.push({ ...base, decision: 'skip', reason_codes: [reason], metric: null });
      skipReasons[reason] = (skipReasons[reason] ?? 0) + 1;
      continue;
    }
    if (!hasUsableRankData(entry)) {
      actions.push({ ...base, decision: 'skip', reason_codes: ['no-easyscholar-data'], metric: null });
      skipReasons['no-easyscholar-data'] = (skipReasons['no-easyscholar-data'] ?? 0) + 1;
      continue;
    }
    // Same evidence shape the project-sync path consumes, so metricFromEvidence
    // and the preprint rule stay shared across both paths.
    const easyscholar = {
      query_name: draft.journal,
      matched_name: entry.publication_name,
      official_rank: entry.official_rank,
      custom_rank: entry.custom_rank,
      fetched_at: entry.fetched_at,
    };
    const metric = metricFromEvidence(
      { itemType: draft.data.itemType, journal: draft.journal, easyscholar },
      sha256Hex(JSON.stringify(easyscholar)),
    );
    if (!metric) {
      actions.push({ ...base, decision: 'skip', reason_codes: ['no-easyscholar-data'], metric: null });
      skipReasons['no-easyscholar-data'] = (skipReasons['no-easyscholar-data'] ?? 0) + 1;
      continue;
    }
    // SAFETY: EvidenceMetric is a closed interface without an index signature,
    // so TypeScript cannot see it structurally satisfies the plan's
    // Record<string, unknown> metric shape; validateMetricsPlan re-checks every
    // field (IF numbers, zone strings, publication metrics) afterwards.
    actions.push({ ...base, decision: 'update', reason_codes: ['easyscholar-journal-name-match'], metric: metric as unknown as Record<string, unknown> });
  }
  actions.sort((a, b) => a.item_key.localeCompare(b.item_key));

  const update = actions.filter((action) => action.decision === 'update').length;
  const skip = actions.length - update;
  const plan: MetricsPlan = {
    schema_version: '1.0',
    plan_type: 'zotero-metrics',
    created_at: now().toISOString(),
    plan_hash: '',
    source: 'zotero-web-api',
    matching_mode: 'web-api',
    target: { library_type: lib.type, library_id: lib.id },
    metrics: { metrics_year: metricYear, source_label: sourceLabel, source_sha256: batchSourceSha256(fetched, journals) },
    actions,
    summary: { selected: actions.length, update, skip },
  };
  plan.plan_hash = canonicalMetricsPlanHash(plan);

  // 5. Optional plan file for review (never a library write).
  if (input.plan_path) {
    await mkdir(dirname(input.plan_path), { recursive: true });
    const tmp = `${input.plan_path}.tmp-${process.pid}`;
    await writeFile(tmp, `${JSON.stringify(plan, null, 2)}\n`);
    await rename(tmp, input.plan_path);
  }

  // 6. Apply gate: explicit mode, exact hash of the freshly rebuilt plan, receipt path.
  if (mode === 'apply') {
    if (!ctx.web.canWrite || ctx.web.isCloud !== true) {
      throw new Error('Metrics backfill apply requires a Zotero cloud Web API key; call setup_status and open_setup first.');
    }
    if (!input.receipt_path) throw new Error('Metrics backfill apply requires receipt_path.');
    if (input.confirm_plan_hash !== plan.plan_hash) {
      throw new Error(
        `confirm_plan_hash does not match the freshly built plan (${input.confirm_plan_hash ?? '(missing)'} vs ${plan.plan_hash}). Nothing was written. Re-run mode dry_run, review the result, and confirm the new plan_hash.`,
      );
    }
  }

  // 7. Execute through the existing reviewed path — this module never writes items itself.
  const executed = await executeMetricsPlan(ctx, plan, lib, mode, mode === 'apply' ? input.receipt_path : undefined);

  const matched = [...fetched.values()].filter((fetch) => fetch.entry !== null && hasUsableRankData(fetch.entry)).length;
  const result: MetricsBackfillResult = {
    mode,
    status: executed.status,
    plan_hash: executed.plan_hash,
    original_plan_hash: executed.original_plan_hash,
    metrics: { metrics_year: metricYear, source_label: sourceLabel },
    selected: actions.length,
    update,
    skip,
    skip_reasons: skipReasons,
    ...(capped ? { capped: true } : {}),
    easyscholar: {
      key_configured: Boolean(secretKey),
      unique_journals: journals.size,
      cache_hits: cacheHits,
      api_calls: apiCalls,
      fetch_errors: fetchErrors,
      matched,
      unmatched: journals.size - matched,
      cache: cachePath,
      min_interval_ms: deps.minIntervalMs ?? 1000,
    },
    conflicts: executed.conflicts,
    version_refreshes: executed.version_refreshes,
    conflict_summary: executed.conflict_summary,
    summary: executed.summary as Record<string, number>,
    ...(executed.message ? { message: executed.message } : {}),
    ...(executed.refreshed_plan ? { refreshed_plan: executed.refreshed_plan } : {}),
    ...(mode === 'apply' ? { receipt_path: input.receipt_path } : {}),
    ...(input.plan_path ? { plan_path: input.plan_path } : {}),
  };
  return result;
}
