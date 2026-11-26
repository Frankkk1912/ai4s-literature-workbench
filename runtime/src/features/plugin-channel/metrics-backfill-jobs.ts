import { createHash, randomUUID } from 'node:crypto';
import { lstat, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { defaultDataDir } from '../../lib/paths.js';
import type { Logger } from '../../lib/logger.js';

const ID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const HASH = /^[a-f0-9]{64}$/;
const PLAN_HASH = /^sha256:[a-f0-9]{64}$/;
const KEY8 = /^[A-Z0-9]{8}$/;
const CREATED_AT = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/;

/**
 * Runtime consumer for plugin-authored `metrics-backfill` request jobs.
 *
 * The Zotero add-on queues a preview request in the shared plugin-jobs
 * directory; this module, while the workbench runtime is running, notices the
 * request, runs the existing metrics backfill path in dry_run, and answers
 * with a `<job_id>.result.json` the add-on knows how to read. After the user
 * confirms that preview in Zotero, a second job may carry `mode: "apply"` and
 * `confirm_plan_hash` matching the preview's plan_hash. Only those confirmed
 * apply jobs are written, through the same reviewed backfillMetrics path (hash
 * gate, receipt, idempotence). The MCP tool is unchanged: it still defaults
 * to dry_run and still requires an explicit confirm_plan_hash plus receipt_path.
 * This consumer never puts a secret in a result file. Ping jobs are ignored:
 * they keep their own claim/ack flow.
 */

export interface MetricsBackfillPreviewRequest {
  collection_key?: string;
  item_keys?: string[];
}

export interface MetricsBackfillApplyRequest {
  collection_key?: string;
  item_keys?: string[];
  mode: 'apply';
  confirm_plan_hash: string;
}

export type MetricsBackfillRequest = MetricsBackfillPreviewRequest | MetricsBackfillApplyRequest;

export interface MetricsBackfillJob {
  schema_version: 1;
  job_id: string;
  job_type: 'metrics-backfill';
  created_at: string;
  plan_hash: string;
  payload: MetricsBackfillRequest;
}

/** Counts and hashes the add-on displays; nothing else crosses the channel. */
export interface MetricsBackfillPreview {
  update: number;
  skip: number;
  plan_hash: string;
  easyscholar: { key_configured: boolean };
}

export interface MetricsBackfillApplyOutcome {
  update: number;
  skip: number;
  plan_hash: string;
  receipt_path: string;
}

export interface MetricsBackfillResultFile {
  schema_version: 1;
  job_id: string;
  job_plan_hash: string;
  status: 'completed' | 'failed';
  mode: 'dry_run' | 'apply';
  finished_at: string;
  preview?: Pick<MetricsBackfillPreview, 'update' | 'skip' | 'plan_hash' | 'easyscholar'>;
  apply?: Pick<MetricsBackfillApplyOutcome, 'update' | 'skip' | 'plan_hash' | 'receipt_path'>;
  error?: string;
}

/** Same normalized SHA-256 contract as the add-on's authoring side. */
export function backfillJobPlanHash(job: Omit<MetricsBackfillJob, 'plan_hash'>): string {
  return createHash('sha256').update(JSON.stringify([
    job.schema_version, job.job_id, job.job_type, job.created_at, job.payload,
  ])).digest('hex');
}

/** Default receipt location for a plugin-confirmed apply: `<dataDir>/receipts/metrics-backfill-<job_id>.json`. */
export function defaultBackfillReceiptPath(dataDir: string, jobId: string): string {
  return join(resolve(dataDir), 'receipts', `metrics-backfill-${jobId}.json`);
}

export function isApplyRequest(payload: MetricsBackfillRequest): payload is MetricsBackfillApplyRequest {
  return (payload as MetricsBackfillApplyRequest).mode === 'apply';
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function validSelector(payload: Record<string, unknown>): boolean {
  if (Object.prototype.hasOwnProperty.call(payload, 'collection_key')) {
    return typeof payload.collection_key === 'string' && KEY8.test(payload.collection_key);
  }
  if (Object.prototype.hasOwnProperty.call(payload, 'item_keys')) {
    return Array.isArray(payload.item_keys) && payload.item_keys.length > 0 && payload.item_keys.length <= 100
      && payload.item_keys.every((key) => typeof key === 'string' && KEY8.test(key));
  }
  return false;
}

/** Defense in depth: error text crosses a file channel, so obvious secret assignments are blanked. */
export function redactSecrets(text: string): string {
  return text.replace(/\b(api[_-]?key|secret|token|password)\b(\s*[:=]\s*)\S+/gi, '$1$2[redacted]');
}

/**
 * Returns the job only when it exactly matches the add-on's pinned request
 * contract (field set, ids, formats, plan_hash, and a single-key payload of
 * 8-char Zotero keys, or an apply payload that also pins mode and
 * confirm_plan_hash). Anything else — ping jobs included — yields null and is
 * never touched, so this loop can never ack, claim, or delete a ping.
 */
export function validateBackfillJob(job: unknown, id: string): MetricsBackfillJob | null {
  if (!isObject(job)) return null;
  if (Object.keys(job).sort().join(',') !== 'created_at,job_id,job_type,payload,plan_hash,schema_version') return null;
  if (job.schema_version !== 1 || job.job_id !== id || job.job_type !== 'metrics-backfill') return null;
  if (typeof job.created_at !== 'string' || !CREATED_AT.test(job.created_at) || !Number.isFinite(Date.parse(job.created_at))) return null;
  if (typeof job.plan_hash !== 'string' || !HASH.test(job.plan_hash)) return null;
  if (backfillJobPlanHash({
    schema_version: 1, job_id: id, job_type: 'metrics-backfill', created_at: job.created_at, payload: job.payload,
  } as Omit<MetricsBackfillJob, 'plan_hash'>) !== job.plan_hash) return null;
  const payload = job.payload;
  if (!isObject(payload)) return null;
  const keys = Object.keys(payload).sort().join(',');
  if (keys === 'collection_key' || keys === 'item_keys') {
    if (!validSelector(payload)) return null;
  } else if (keys === 'collection_key,confirm_plan_hash,mode' || keys === 'confirm_plan_hash,item_keys,mode') {
    if (payload.mode !== 'apply' || typeof payload.confirm_plan_hash !== 'string' || !PLAN_HASH.test(payload.confirm_plan_hash) || !validSelector(payload)) return null;
  } else return null;
  return { schema_version: 1, job_id: id, job_type: 'metrics-backfill', created_at: job.created_at, plan_hash: job.plan_hash, payload: payload as MetricsBackfillRequest };
}

export interface MetricsBackfillConsumerOptions {
  /** Same dataDir the desktop plugin channel uses; defaults to the runtime default. */
  dataDir?: string;
  /**
   * Builds the dry-run preview (the reviewed backfillMetrics path, mode
   * 'dry_run'). Injected so tests need no Zotero cloud access or network.
   */
  runPreview: (payload: MetricsBackfillPreviewRequest) => Promise<MetricsBackfillPreview>;
  /**
   * Applies a plan only for plugin-confirmed jobs (mode apply + matching
   * confirm_plan_hash). The consumer supplies receipt_path under dataDir/receipts/.
   * Injected so tests need no Zotero writes.
   */
  runApply?: (payload: MetricsBackfillApplyRequest, receiptPath: string) => Promise<MetricsBackfillApplyOutcome>;
  intervalMs?: number;
  logger?: Pick<Logger, 'info' | 'error'>;
  now?: () => Date;
}

export function createMetricsBackfillConsumer(options: MetricsBackfillConsumerOptions) {
  const dataDir = resolve(options.dataDir ?? defaultDataDir());
  const root = join(dataDir, 'plugin-jobs');
  const intervalMs = options.intervalMs ?? 5000;
  const now = options.now ?? (() => new Date());
  let timer: ReturnType<typeof setInterval> | null = null;
  let scanning: Promise<number> | null = null;

  async function read(name: string): Promise<unknown | null> {
    const path = join(root, name);
    try {
      const info = await lstat(path);
      if (!info.isFile() || info.size > 4096) throw new Error('Unsafe plugin channel file.');
      return JSON.parse(await readFile(path, 'utf8'));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
  }

  /** Atomic result write with the same tmp+rename discipline as ping jobs. */
  async function writeResult(result: MetricsBackfillResultFile): Promise<void> {
    const target = join(root, `${result.job_id}.result.json`);
    const temporary = `${target}.${randomUUID()}.tmp`;
    await writeFile(temporary, JSON.stringify(result), { flag: 'wx', mode: 0o600 });
    await rename(temporary, target);
  }

  async function processOne(id: string): Promise<boolean> {
    // Idempotent: an answered job is never rebuilt; the add-on discards the pair.
    if (await read(`${id}.result.json`) !== null) return false;
    const job = validateBackfillJob(await read(`${id}.job.json`), id);
    if (job === null) return false;
    const base = {
      schema_version: 1 as const,
      job_id: job.job_id,
      job_plan_hash: job.plan_hash,
      finished_at: now().toISOString(),
    };
    if (isApplyRequest(job.payload)) {
      if (typeof options.runApply !== 'function') {
        await writeResult({
          ...base,
          mode: 'apply',
          status: 'failed',
          error: 'Apply requires a plugin-confirmed confirm_plan_hash and is not enabled on this consumer.',
        });
        return true;
      }
      const receiptPath = defaultBackfillReceiptPath(dataDir, job.job_id);
      try {
        const outcome = await options.runApply(job.payload, receiptPath);
        await writeResult({
          ...base,
          mode: 'apply',
          status: 'completed',
          apply: {
            update: outcome.update,
            skip: outcome.skip,
            plan_hash: outcome.plan_hash,
            receipt_path: outcome.receipt_path || receiptPath,
          },
        });
      } catch (error) {
        const message = redactSecrets(error instanceof Error ? error.message : String(error));
        await writeResult({ ...base, mode: 'apply', status: 'failed', error: message });
      }
      return true;
    }
    try {
      const preview = await options.runPreview(job.payload);
      await writeResult({ ...base, mode: 'dry_run', status: 'completed', preview: {
        update: preview.update, skip: preview.skip, plan_hash: preview.plan_hash,
        easyscholar: { key_configured: preview.easyscholar.key_configured },
      } });
    } catch (error) {
      const message = redactSecrets(error instanceof Error ? error.message : String(error));
      await writeResult({ ...base, mode: 'dry_run', status: 'failed', error: message });
    }
    return true;
  }

  /** One pass over the jobs directory; scans never overlap. A missing directory is not an error. */
  async function scanOnce(): Promise<number> {
    if (scanning) return scanning;
    const run = (async (): Promise<number> => {
      let processed = 0;
      let names: string[];
      try {
        names = await readdir(root);
      } catch {
        return 0;
      }
      for (const name of names) {
        if (!name.endsWith('.job.json')) continue;
        const id = name.slice(0, -9);
        if (!ID.test(id)) continue;
        try {
          if (await processOne(id)) processed += 1;
        } catch (error) {
          options.logger?.error('metrics-backfill consumer:', error instanceof Error ? error.message : String(error));
        }
      }
      return processed;
    })();
    scanning = run;
    try {
      return await run;
    } finally {
      scanning = null;
    }
  }

  function start(): void {
    if (timer !== null) return;
    timer = setInterval(() => {
      void scanOnce().catch((error) => {
        options.logger?.error('metrics-backfill consumer scan failed:', error instanceof Error ? error.message : String(error));
      });
    }, intervalMs);
    timer.unref();
  }

  async function stop(): Promise<void> {
    if (timer !== null) {
      clearInterval(timer);
      timer = null;
    }
    if (scanning) await scanning.catch(() => undefined);
    scanning = null;
  }

  return { root, start, stop, scanOnce };
}

export type MetricsBackfillConsumer = ReturnType<typeof createMetricsBackfillConsumer>;
