import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { LibraryRef } from '../api/web-client.js';
import type { ToolContext } from '../registry/registry.js';
import { ZoteroApiError } from '../api/errors.js';

const PREFIX = 'AI4S-Metrics:';
const YEAR = /^(?:19|20)\d{2}$/;
const SHA256 = /^[0-9a-f]{64}$/;

export interface MetricsPlanAction {
  item_key: string;
  expected_version: number | null;
  title: string;
  issns: string[];
  decision: 'update' | 'skip';
  reason_codes: string[];
  metric: Record<string, unknown> | null;
}

export interface MetricsPlan {
  schema_version: '1.0';
  plan_type: 'zotero-metrics';
  created_at: string;
  plan_hash: string;
  /** Optional provenance for the item versions, not the metric payload. */
  source?: string;
  matching_mode?: string;
  target: { library_type: 'user' | 'group'; library_id: number };
  metrics: { metrics_year: number; remove_years?: number[]; source_label: string; source_sha256: string };
  actions: MetricsPlanAction[];
  summary: { selected: number; update: number; skip: number };
}

type ResultOutcome = 'updated' | 'unchanged' | 'skipped' | 'failed' | 'pending';
interface MetricsReceipt {
  schema_version: '1.0'; receipt_type: 'zotero-metrics'; plan_hash: string;
  started_at: string; updated_at: string; status: 'complete' | 'partial' | 'blocked';
  results: Array<{ item_key: string; outcome: ResultOutcome; zotero_version: number | null; error: string | null }>;
  summary: Record<ResultOutcome, number>;
}

function isObject(value: unknown): value is Record<string, any> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
function deepSort(value: any): any {
  if (Array.isArray(value)) return value.map(deepSort);
  if (!isObject(value)) return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, deepSort(value[key])]));
}
export function canonicalMetricsPlanHash(plan: MetricsPlan): string {
  const payload = { schema_version: plan.schema_version, plan_type: plan.plan_type, target: plan.target, metrics: plan.metrics,
    actions: [...plan.actions].sort((a, b) => a.item_key.localeCompare(b.item_key)),
    ...(plan.source === undefined ? {} : { source: plan.source }),
    ...(plan.matching_mode === undefined ? {} : { matching_mode: plan.matching_mode }) };
  return `sha256:${createHash('sha256').update(JSON.stringify(deepSort(payload)), 'utf8').digest('hex')}`;
}
export function validateMetricsPlan(value: unknown): MetricsPlan {
  if (!isObject(value) || value.schema_version !== '1.0' || value.plan_type !== 'zotero-metrics') throw new Error('Unsupported metrics plan schema or type');
  if (!/^sha256:[0-9a-f]{64}$/.test(String(value.plan_hash ?? ''))) throw new Error('Invalid metrics plan hash');
  if (!isObject(value.target) || !['user', 'group'].includes(value.target.library_type) || !Number.isInteger(value.target.library_id)) throw new Error('Invalid metrics plan target');
  if (!isObject(value.metrics) || !YEAR.test(String(value.metrics.metrics_year)) || typeof value.metrics.source_label !== 'string' || !value.metrics.source_label.trim() || !SHA256.test(String(value.metrics.source_sha256))) throw new Error('Invalid metrics provenance');
  if (value.metrics.remove_years !== undefined && (!Array.isArray(value.metrics.remove_years) || value.metrics.remove_years.some((year: unknown) => !Number.isInteger(year) || !YEAR.test(String(year)) || year === value.metrics.metrics_year) || new Set(value.metrics.remove_years).size !== value.metrics.remove_years.length)) throw new Error('Invalid metrics remove_years');
  for (const field of ['source', 'matching_mode']) {
    if (value[field] !== undefined && typeof value[field] !== 'string') throw new Error(`Invalid metrics plan ${field}`);
  }
  if (!Array.isArray(value.actions) || !isObject(value.summary)) throw new Error('Metrics plan needs actions and summary');
  const seen = new Set<string>();
  for (const action of value.actions) {
    if (!isObject(action) || typeof action.item_key !== 'string' || !action.item_key || seen.has(action.item_key)) throw new Error('Metrics plan has invalid or duplicate item_key');
    seen.add(action.item_key);
    if (!['update', 'skip'].includes(action.decision) || !Array.isArray(action.reason_codes) || !Array.isArray(action.issns)) throw new Error(`Invalid metrics action ${action.item_key}`);
    if (action.decision === 'update') {
      if (!Number.isInteger(action.expected_version) || !isObject(action.metric)) throw new Error(`Update action ${action.item_key} requires version and metric`);
      const metric = action.metric;
      const hasIf = Object.prototype.hasOwnProperty.call(metric, 'impact_factor');
      const hasIf5 = Object.prototype.hasOwnProperty.call(metric, 'impact_factor_5y');
      const hasJcr = Object.prototype.hasOwnProperty.call(metric, 'jcr_zone');
      const hasCas = Object.prototype.hasOwnProperty.call(metric, 'cas_zone');
      const hasPublicationMetrics = Object.prototype.hasOwnProperty.call(metric, 'publication_metrics');
      if (!hasIf && !hasIf5 && !hasJcr && !hasCas && !hasPublicationMetrics) throw new Error(`Metric for ${action.item_key} needs IF, zone, or publication metrics`);
      for (const [key, label] of [['impact_factor', 'IF'], ['impact_factor_5y', '5-year IF']] as const) {
        if (!Object.prototype.hasOwnProperty.call(metric, key)) continue;
        const number = Number(metric[key]);
        if (!Number.isFinite(number) || number < 0) throw new Error(`Invalid ${label} for ${action.item_key}`);
      }
      for (const key of ['jcr_zone', 'cas_zone']) {
        if (Object.prototype.hasOwnProperty.call(metric, key) && (typeof metric[key] !== 'string' || !metric[key].trim())) {
          throw new Error(`Invalid ${key} for ${action.item_key}`);
        }
      }
      if (hasPublicationMetrics) {
        if (!Array.isArray(metric.publication_metrics) || !metric.publication_metrics.length) throw new Error(`Invalid publication metrics for ${action.item_key}`);
        const allowed = new Set(['cas_major', 'cas_top', 'esi_category', 'indexing']);
        const identities = new Set<string>();
        for (const entry of metric.publication_metrics) {
          if (!isObject(entry) || !allowed.has(entry.code)) throw new Error(`Invalid publication metrics for ${action.item_key}`);
          if (entry.code === 'cas_top' ? entry.value !== true : typeof entry.value !== 'string' || !entry.value.trim()) throw new Error(`Invalid publication metrics for ${action.item_key}`);
          const identity = `${entry.code}:${String(entry.value)}`;
          if (identities.has(identity)) throw new Error(`Duplicate publication metrics for ${action.item_key}`);
          identities.add(identity);
        }
      }
      if (Object.prototype.hasOwnProperty.call(metric, 'retrieved_at') && (typeof metric.retrieved_at !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(metric.retrieved_at))) throw new Error(`Invalid retrieved_at for ${action.item_key}`);
    }
  }
  const expected = { selected: value.actions.length, update: value.actions.filter((a: any) => a.decision === 'update').length, skip: value.actions.filter((a: any) => a.decision === 'skip').length };
  if (Object.entries(expected).some(([key, count]) => value.summary[key] !== count)) throw new Error('Metrics plan summary does not match actions');
  const plan = value as MetricsPlan;
  if (canonicalMetricsPlanHash(plan) !== plan.plan_hash) throw new Error('Metrics plan hash mismatch');
  return plan;
}
export async function readMetricsPlan(path: string): Promise<MetricsPlan> { return validateMetricsPlan(JSON.parse(await readFile(path, 'utf8'))); }

function parseExtra(extra: unknown): Record<string, any> | null {
  const lines = String(extra ?? '').split(/\r?\n/); const matches = lines.filter((line) => line.startsWith(PREFIX));
  if (!matches.length) return { schema_version: 2, by_year: {} };
  if (matches.length !== 1) return null;
  try { const payload = JSON.parse(matches[0]!.slice(PREFIX.length).trim()); return isObject(payload) && payload.schema_version === 2 && isObject(payload.by_year) ? payload : null; } catch { return null; }
}
function mergeMetric(extra: unknown, year: number, metric: Record<string, unknown>): string | null {
  const payload = parseExtra(extra); if (!payload) return null;
  const entry: Record<string, unknown> = {};
  if (Object.prototype.hasOwnProperty.call(metric, 'impact_factor')) entry.impact_factor = Number(metric.impact_factor);
  if (Object.prototype.hasOwnProperty.call(metric, 'impact_factor_5y')) entry.impact_factor_5y = Number(metric.impact_factor_5y);
  for (const key of ['jcr_zone', 'cas_zone', 'retrieved_at', 'source_label', 'source_sha256']) if (typeof metric[key] === 'string' && metric[key]) entry[key] = metric[key];
  if (Array.isArray(metric.publication_metrics)) entry.publication_metrics = metric.publication_metrics.map((value) => deepSort(value));
  payload.by_year[String(year)] = entry;
  const line = `${PREFIX} ${JSON.stringify(deepSort(payload))}`;
  const retained = String(extra ?? '').split(/\r?\n/).filter((part) => !part.startsWith(PREFIX));
  return [...retained, line].filter(Boolean).join('\n');
}
function mergedTags(tags: any[], extra: string): Array<{ tag: string; type?: number }> {
  const payload = parseExtra(extra)!; const years = Object.keys(payload.by_year).filter((year) => YEAR.test(year)).sort();
  const latest = years.length ? payload.by_year[years.at(-1)!] : {};
  const kept = new Map<string, { tag: string; type?: number }>();
  for (const raw of tags ?? []) { const tag = typeof raw === 'string' ? raw : raw?.tag; if (tag && !/^JCR:|^CAS:/.test(tag)) kept.set(tag, typeof raw === 'string' ? { tag } : raw); }
  if (typeof latest.jcr_zone === 'string' && latest.jcr_zone) kept.set(`JCR:${latest.jcr_zone}`, { tag: `JCR:${latest.jcr_zone}` });
  if (typeof latest.cas_zone === 'string' && latest.cas_zone) kept.set(`CAS:${latest.cas_zone}`, { tag: `CAS:${latest.cas_zone}` });
  return [...kept.values()];
}
function versionOf(item: any): number | null { const value = item?.version ?? item?.data?.version; return Number.isInteger(value) ? value : null; }
function dataOf(item: any): Record<string, any> { return isObject(item?.data) ? item.data : item ?? {}; }
function summarize(receipt: MetricsReceipt): void { for (const key of ['updated','unchanged','skipped','failed','pending'] as const) receipt.summary[key] = receipt.results.filter((r) => r.outcome === key).length; receipt.updated_at = new Date().toISOString(); receipt.status = receipt.summary.pending ? 'blocked' : receipt.summary.failed ? 'partial' : 'complete'; }
async function save(path: string, receipt: MetricsReceipt): Promise<void> { summarize(receipt); await mkdir(dirname(path), { recursive: true }); const tmp = `${path}.tmp-${process.pid}`; await writeFile(tmp, `${JSON.stringify(receipt, null, 2)}\n`); await rename(tmp, path); }
function initial(plan: MetricsPlan): MetricsReceipt { const now = new Date().toISOString(); const receipt: MetricsReceipt = { schema_version:'1.0', receipt_type:'zotero-metrics', plan_hash:plan.plan_hash, started_at:now, updated_at:now, status:'partial', results: plan.actions.map((action) => ({ item_key:action.item_key, outcome:action.decision === 'skip' ? 'skipped' : 'pending', zotero_version:action.expected_version, error:action.decision === 'skip' ? action.reason_codes.join(';') : null })), summary:{updated:0,unchanged:0,skipped:0,failed:0,pending:0} }; summarize(receipt); return receipt; }
interface MetricsExecutionResult {
  status: string;
  summary: Record<string, number>;
  receiptPath?: string;
  conflicts: string[];
  original_plan_hash: string;
  plan_hash: string;
  refreshed_plan?: MetricsPlan;
  version_refreshes: number;
  conflict_summary: { local_cloud_version_mismatch: number; cloud_version_moved: number };
  message?: string;
}

/** A tenfold gap in either direction is a suspected scale mix-up, not proof of concurrent edits. */
function differentVersionScale(expected: number | null, current: number | null): boolean {
  return expected !== null && current !== null && expected > 0 && current > 0 &&
    Math.max(expected, current) / Math.min(expected, current) >= 10;
}

export async function executeMetricsPlan(ctx: ToolContext, plan: MetricsPlan, lib: LibraryRef, mode: 'dry_run' | 'apply', receiptPath?: string): Promise<MetricsExecutionResult> {
  if (ctx.web.isCloud !== true) throw new Error('Metrics plans require the real Zotero cloud client (api.zotero.org) and Web API credentials. LocalWebClient versions are local API versions, not cloud versions; regenerate or refresh with a cloud key.');
  let receipt = initial(plan);
  const metadata: Omit<MetricsExecutionResult, 'status' | 'summary' | 'conflicts'> = {
    original_plan_hash: plan.plan_hash, plan_hash: plan.plan_hash, version_refreshes: 0,
    conflict_summary: { local_cloud_version_mismatch: 0, cloud_version_moved: 0 },
  };
  if (mode === 'apply' && receiptPath) { try { const old = JSON.parse(await readFile(receiptPath, 'utf8')) as MetricsReceipt; if (old.plan_hash !== plan.plan_hash) throw new Error('Receipt plan hash does not match'); receipt = old; if (old.status === 'complete') return { status:'complete', summary:old.summary, receiptPath, conflicts:[], ...metadata }; } catch (error: any) { if (error?.code !== 'ENOENT') throw error; } }

  // Preflight every pending action before any write. Never obtain these versions from the router.
  const reads = new Map<string, { item: any } | { error: unknown }>();
  const localSource = [plan.source, plan.matching_mode].some((source) =>
    typeof source === 'string' && /^(?:local(?:[-_ ]?api)?|zotero-local(?:-api)?)$/i.test(source.trim()));
  const refreshed: MetricsPlan = { ...plan, actions: plan.actions.map((action) => ({ ...action })) };
  for (const action of refreshed.actions) {
    if (action.decision !== 'update' || receipt.results.find((r) => r.item_key === action.item_key)?.outcome !== 'pending') continue;
    try {
      const item = await ctx.web.getItem(lib, action.item_key);
      reads.set(action.item_key, { item });
      const current = versionOf(item);
      if (current !== null && (localSource || differentVersionScale(action.expected_version, current))) {
        action.expected_version = current;
        metadata.version_refreshes++;
      }
    } catch (error) { reads.set(action.item_key, { error }); }
  }
  if (metadata.version_refreshes) {
    // Keep the local warning if not every version could be verified; the dry-run will be blocked.
    if ([...reads.values()].every((read) => 'item' in read && versionOf(read.item) !== null)) {
      refreshed.source = 'zotero-web-api';
      if (refreshed.matching_mode !== undefined) refreshed.matching_mode = 'web-api';
    }
    refreshed.plan_hash = canonicalMetricsPlanHash(refreshed);
    metadata.plan_hash = refreshed.plan_hash;
    metadata.refreshed_plan = refreshed;
    metadata.conflict_summary.local_cloud_version_mismatch = metadata.version_refreshes;
    metadata.message = 'Local API provenance or a suspected local/cloud version-scale mismatch was detected. Versions were refreshed directly from api.zotero.org. Save refreshed_plan as a new JSON plan, dry-run it, review it, then apply with its new plan_hash; the old hash must not be used.';
    if (mode === 'apply') return { status: 'blocked', summary: receipt.summary, conflicts: [], ...metadata };
    plan = refreshed;
    receipt = initial(plan);
  }
  const conflicts: string[] = [];
  for (const action of plan.actions.filter((entry) => entry.decision === 'update')) {
    const result = receipt.results.find((entry) => entry.item_key === action.item_key)!; if (result.outcome !== 'pending') continue;
    try {
      const read = reads.get(action.item_key)!;
      if ('error' in read) throw read.error;
      const item = read.item; const data = dataOf(item); const current = versionOf(item);
      if (current === null || action.expected_version === null || current !== action.expected_version) { conflicts.push(action.item_key); result.outcome = 'failed'; result.error = 'cloud-version-moved'; continue; }
      let sourceExtra = data.extra;
      if (plan.metrics.remove_years?.length) {
        const payload = parseExtra(sourceExtra);
        if (payload === null) { result.outcome = 'failed'; result.error = 'invalid-or-duplicate-ai4s-metrics-block'; continue; }
        for (const year of plan.metrics.remove_years) delete payload.by_year[String(year)];
        const retained = String(sourceExtra ?? '').split(/\r?\n/).filter((part) => !part.startsWith(PREFIX));
        sourceExtra = [...retained, `${PREFIX} ${JSON.stringify(deepSort(payload))}`].filter(Boolean).join('\n');
      }
      const extra = mergeMetric(sourceExtra, plan.metrics.metrics_year, action.metric!);
      if (extra === null) { result.outcome = 'failed'; result.error = 'invalid-or-duplicate-ai4s-metrics-block'; continue; }
      const tags = mergedTags(data.tags, extra); const changed = extra !== String(data.extra ?? '') || JSON.stringify(tags) !== JSON.stringify(data.tags ?? []);
      if (mode === 'dry_run') { result.outcome = changed ? 'pending' : 'unchanged'; continue; }
      if (!changed) { result.outcome = 'unchanged'; continue; }
      result.zotero_version = await ctx.web.patchItem(lib, action.item_key, { extra, tags }, current); result.outcome = 'updated'; result.error = null;
    } catch (error) {
      result.outcome = 'failed';
      if (error instanceof ZoteroApiError && error.status === 412) {
        conflicts.push(action.item_key); result.error = 'cloud-version-moved (412)';
      } else result.error = (error instanceof Error ? error.message : String(error)).slice(0, 500);
    }
  }
  metadata.conflict_summary.cloud_version_moved = conflicts.length;
  if (mode === 'dry_run') {
    summarize(receipt);
    return { status: receipt.summary.failed ? 'blocked' : 'ready', summary: receipt.summary, conflicts, ...metadata };
  }
  if (!receiptPath) throw new Error('receipt path is required for apply'); await save(receiptPath, receipt); return { status: receipt.status, summary:receipt.summary, receiptPath, conflicts, ...metadata };
}
