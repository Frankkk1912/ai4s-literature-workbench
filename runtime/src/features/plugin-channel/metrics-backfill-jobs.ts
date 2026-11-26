import { createHash, randomUUID } from 'node:crypto';
import { lstat, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { defaultDataDir } from '../../lib/paths.js';
import type { Logger } from '../../lib/logger.js';

const ID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const HASH = /^[a-f0-9]{64}$/;
const KEY8 = /^[A-Z0-9]{8}$/;
const CREATED_AT = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/;

/**
 * Runtime consumer for plugin-authored `metrics-backfill` request jobs.
 *
 * The Zotero add-on queues a preview request in the shared plugin-jobs
 * directory; this module, while the workbench runtime is running, notices the
 * request, runs the existing metrics backfill path in dry_run ONLY, and
 * answers with a `<job_id>.result.json` the add-on knows how to read. It never
 * applies a plan (apply stays a separate MCP call with an explicit
 * confirm_plan_hash), never writes to Zotero, and never puts a secret in a
 * result file. Ping jobs are ignored: they keep their own claim/ack flow.
 */

export interface MetricsBackfillRequest {
  collection_key?: string;
  item_keys?: string[];
}

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

export interface MetricsBackfillResultFile {
  schema_version: 1;
  job_id: string;
  job_plan_hash: string;
  status: 'completed' | 'failed';
  mode: 'dry_run';
  finished_at: string;
  preview?: Pick<MetricsBackfillPreview, 'update' | 'skip' | 'plan_hash' | 'easyscholar'>;
  error?: string;
}

/** Same normalized SHA-256 contract as the add-on's authoring side. */
export function backfillJobPlanHash(job: Omit<MetricsBackfillJob, 'plan_hash'>): string {
  return createHash('sha256').update(JSON.stringify([
    job.schema_version, job.job_id, job.job_type, job.created_at, job.payload,
  ])).digest('hex');
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/** Defense in depth: error text crosses a file channel, so obvious secret assignments are blanked. */
export function redactSecrets(text: string): string {
  return text.replace(/\b(api[_-]?key|secret|token|password)\b(\s*[:=]\s*)\S+/gi, '$1$2[redacted]');
}

/**
 * Returns the job only when it exactly matches the add-on's pinned request
 * contract (field set, ids, formats, plan_hash, and a single-key payload of
 * 8-char Zotero keys). Anything else — ping jobs included — yields null and is
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
  const keys = Object.keys(payload);
  if (keys.length !== 1) return null;
  if (keys[0] === 'collection_key') {
    if (typeof payload.collection_key !== 'string' || !KEY8.test(payload.collection_key)) return null;
  } else if (keys[0] === 'item_keys') {
    if (!Array.isArray(payload.item_keys) || payload.item_keys.length === 0 || payload.item_keys.length > 100
      || !payload.item_keys.every((key) => typeof key === 'string' && KEY8.test(key))) return null;
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
  runPreview: (payload: MetricsBackfillRequest) => Promise<MetricsBackfillPreview>;
  intervalMs?: number;
  logger?: Pick<Logger, 'info' | 'error'>;
  now?: () => Date;
}

export function createMetricsBackfillConsumer(options: MetricsBackfillConsumerOptions) {
  const root = join(resolve(options.dataDir ?? defaultDataDir()), 'plugin-jobs');
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
      mode: 'dry_run' as const,
      finished_at: now().toISOString(),
    };
    try {
      const preview = await options.runPreview(job.payload);
      await writeResult({ ...base, status: 'completed', preview: {
        update: preview.update, skip: preview.skip, plan_hash: preview.plan_hash,
        easyscholar: { key_configured: preview.easyscholar.key_configured },
      } });
    } catch (error) {
      const message = redactSecrets(error instanceof Error ? error.message : String(error));
      await writeResult({ ...base, status: 'failed', error: message });
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
