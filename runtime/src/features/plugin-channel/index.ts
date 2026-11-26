import { createHash, randomUUID } from 'node:crypto';
import { lstat, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { defaultDataDir } from '../../lib/paths.js';

export interface PingJob {
  schema_version: 1;
  job_id: string;
  job_type: 'ping';
  created_at: string;
  plan_hash: string;
  payload: Record<string, never>;
}
export interface NativeMergePayload {
  plan_path: string;
  plan_hash: string;
  collection_key: string;
}
export interface NativeMergeJob {
  schema_version: 1;
  job_id: string;
  job_type: 'native-merge';
  created_at: string;
  plan_hash: string;
  payload: NativeMergePayload;
}
export type ChannelJob = PingJob | NativeMergeJob;
export interface PluginAckCluster {
  cluster_id: string;
  status: 'success' | 'failed' | 'skipped';
  master_key?: string;
  merged_keys?: string[];
  added_to_collection?: boolean;
  error?: string;
}
export interface PluginAck {
  job_id: string;
  plan_hash: string;
  status: 'accepted' | 'rejected' | 'completed' | 'failed';
  finished_at: string;
  error?: string;
  clusters?: PluginAckCluster[];
}
export interface PluginClaim {
  schema_version: 1;
  job_id: string;
  plan_hash: string;
  claimed_at: string;
}
const ID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const HASH = /^[a-f0-9]{64}$/;
const ZOTERO_KEY = /^[A-Z0-9]{8}$/;
const PLAN_HASH = /^sha256:[0-9a-f]{64}$/;
const unavailable = 'Desktop plugin unavailable: open Zotero with Literature Metrics enabled and the same dataDir.';
const terminal = (ack: PluginAck | null) => ack !== null && ack.status !== 'accepted';
/** Channel files stay small: a receipt may carry per-cluster merge results, nothing more. */
export const MAX_CHANNEL_FILE_BYTES = 32768;

/** A per-cluster merge result the plugin may report in a receipt. */
function validateClusterReceipt(entry: unknown): void {
  const value = entry as Partial<PluginAckCluster> | null;
  if (!value || typeof value !== 'object'
    || Object.keys(value).some((key) => !['added_to_collection', 'cluster_id', 'error', 'master_key', 'merged_keys', 'status'].includes(key))
    || typeof value.cluster_id !== 'string' || !value.cluster_id
    || !['success', 'failed', 'skipped'].includes(value.status ?? '')
    || (value.status === 'failed' && (typeof value.error !== 'string' || !value.error))
    || (value.master_key !== undefined && !ZOTERO_KEY.test(String(value.master_key)))
    || (value.merged_keys !== undefined && (!Array.isArray(value.merged_keys)
      || value.merged_keys.some((key) => !ZOTERO_KEY.test(String(key)))))
    || (value.added_to_collection !== undefined && typeof value.added_to_collection !== 'boolean')
    || (value.error !== undefined && typeof value.error !== 'string')) {
    throw new Error('Invalid plugin ack.');
  }
}

/** SHA-256 of the fixed-order, ASCII-only channel contract; not an authorization token. */
export function channelPlanHash(job: Omit<PingJob | NativeMergeJob, 'plan_hash'>): string {
  return createHash('sha256').update(JSON.stringify([
    job.schema_version, job.job_id, job.job_type, job.created_at, job.payload,
  ])).digest('hex');
}
function validateJob(job: ChannelJob): void {
  if (!job || Object.keys(job).sort().join(',') !== 'created_at,job_id,job_type,payload,plan_hash,schema_version'
    || job.schema_version !== 1 || !ID.test(job.job_id)
    || (job.job_type !== 'ping' && job.job_type !== 'native-merge')
    || typeof job.created_at !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(job.created_at)
    || !Number.isFinite(Date.parse(job.created_at)) || !job.payload || Array.isArray(job.payload)
    || typeof job.payload !== 'object' || !HASH.test(job.plan_hash) || channelPlanHash(job) !== job.plan_hash) {
    throw new Error('Invalid channel job or plan_hash mismatch.');
  }
  if (job.job_type === 'ping') {
    if (Object.keys(job.payload).length !== 0) throw new Error('Invalid channel job or plan_hash mismatch.');
    return;
  }
  const payload = job.payload;
  if (Object.keys(payload).sort().join(',') !== 'collection_key,plan_hash,plan_path'
    || typeof payload.plan_path !== 'string' || !isAbsolute(payload.plan_path) || payload.plan_path.length > 512
    || !PLAN_HASH.test(payload.plan_hash) || !ZOTERO_KEY.test(payload.collection_key)) {
    throw new Error('Invalid channel job or plan_hash mismatch.');
  }
}

/** A native-merge payload may only name a plan file directly inside <dataDir>/dedupe-plans. */
function validateNativeMergePayload(dataDir: string, payload: NativeMergePayload): string {
  if (!payload || Object.keys(payload).sort().join(',') !== 'collection_key,plan_hash,plan_path'
    || typeof payload.plan_path !== 'string' || !isAbsolute(payload.plan_path) || payload.plan_path.length > 512
    || !PLAN_HASH.test(payload.plan_hash) || !ZOTERO_KEY.test(payload.collection_key))
    throw new Error('Invalid native-merge job payload.');
  const plansRoot = join(resolve(dataDir), 'dedupe-plans');
  if (dirname(resolve(payload.plan_path)) !== plansRoot
    || !/^[A-Za-z0-9._-]+\.json$/.test(basename(resolve(payload.plan_path))))
    throw new Error(`Unsafe dedupe plan path: the plan file must live directly in ${plansRoot}.`);
  return plansRoot;
}

/** Internal plumbing only: no item access and no MCP tool registration. */
export function createPluginChannel(dataDir = defaultDataDir()) {
  const root = join(resolve(dataDir), 'plugin-jobs');
  async function directory(): Promise<void> {
    try {
      if (!(await lstat(root)).isDirectory()) throw new Error();
    } catch { throw new Error(`Plugin jobs directory missing or unsafe: ${root}. ${unavailable}`); }
  }
  async function read(name: string): Promise<unknown | null> {
    await directory();
    const path = join(root, name);
    try {
      const info = await lstat(path);
      if (!info.isFile() || info.size > MAX_CHANNEL_FILE_BYTES) throw new Error('Unsafe plugin channel file.');
      return JSON.parse(await readFile(path, 'utf8'));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
  }
  async function freshPresence(): Promise<boolean> {
    const presence = await read('presence.json') as { schema_version?: number; updated_at?: string } | null;
    const age = Date.now() - Date.parse(presence?.updated_at ?? '');
    return presence?.schema_version === 1 && Number.isFinite(age) && age >= -2000 && age <= 10000;
  }
  async function requireDesktop(): Promise<void> {
    if (!await freshPresence()) throw new Error(unavailable);
  }
  /** A matching claim means the plugin is alive but blocked on the user's confirmation. */
  async function claimed(job: ChannelJob): Promise<boolean> {
    const claim = await read(`${job.job_id}.claim.json`) as PluginClaim | null;
    return claim !== null && claim.schema_version === 1 && claim.job_id === job.job_id
      && claim.plan_hash === job.plan_hash && typeof claim.claimed_at === 'string'
      && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(claim.claimed_at)
      && Number.isFinite(Date.parse(claim.claimed_at));
  }
  async function writeJob(job: ChannelJob): Promise<void> {
    const target = join(root, `${job.job_id}.job.json`);
    const temporary = `${target}.${randomUUID()}.tmp`;
    await writeFile(temporary, JSON.stringify(job), { flag: 'wx', mode: 0o600 });
    await rename(temporary, target);
  }
  async function createPingJob(): Promise<PingJob> {
    await requireDesktop();
    const plan = { schema_version: 1 as const, job_id: randomUUID(), job_type: 'ping' as const,
      created_at: new Date().toISOString(), payload: {} };
    const job = { ...plan, plan_hash: channelPlanHash(plan) };
    await writeJob(job);
    return job;
  }
  async function createNativeMergeJob(payload: NativeMergePayload): Promise<NativeMergeJob> {
    await requireDesktop();
    validateNativeMergePayload(dataDir, payload);
    const plan = { schema_version: 1 as const, job_id: randomUUID(), job_type: 'native-merge' as const,
      created_at: new Date().toISOString(), payload };
    const job = { ...plan, plan_hash: channelPlanHash(plan) };
    await writeJob(job);
    return job;
  }
  /**
   * Find an unfinished native-merge job with exactly this payload, if one exists.
   * Re-running apply then waits on the pending job instead of stacking a second
   * one, which keeps retries safe after an ack timeout. Invalid files are skipped.
   */
  async function findNativeMergeJob(payload: NativeMergePayload): Promise<NativeMergeJob | null> {
    validateNativeMergePayload(dataDir, payload);
    await directory();
    let match: NativeMergeJob | null = null;
    for (const name of await readdir(root)) {
      if (!name.endsWith('.job.json')) continue;
      const id = name.slice(0, -9);
      if (!ID.test(id)) continue;
      try {
        const job = await read(name) as NativeMergeJob;
        validateJob(job);
        if (job.job_id !== id || job.job_type !== 'native-merge') continue;
        const current = job.payload;
        if (current.plan_path !== payload.plan_path || current.plan_hash !== payload.plan_hash
          || current.collection_key !== payload.collection_key) continue;
        if (terminal(await readAck(job))) continue;
        if (match === null || Date.parse(job.created_at) > Date.parse(match.created_at)) match = job;
      } catch { continue; }
    }
    return match;
  }
  async function readAck(job: ChannelJob): Promise<PluginAck | null> {
    validateJob(job);
    const ack = await read(`${job.job_id}.ack.json`) as PluginAck | null;
    if (ack === null) return null;
    if (ack.job_id !== job.job_id || ack.plan_hash !== job.plan_hash) throw new Error('Ack job_id or plan_hash mismatch.');
    if (Object.keys(ack).some((key) => !['job_id', 'plan_hash', 'status', 'finished_at', 'error', 'clusters'].includes(key))
      || !['accepted', 'rejected', 'completed', 'failed'].includes(ack.status)
      || typeof ack.finished_at !== 'string' || !Number.isFinite(Date.parse(ack.finished_at))
      || (ack.error !== undefined && typeof ack.error !== 'string')
      || (['rejected', 'failed'].includes(ack.status) && !ack.error)) throw new Error('Invalid plugin ack.');
    if (ack.clusters !== undefined) {
      if (!Array.isArray(ack.clusters)) throw new Error('Invalid plugin ack.');
      for (const cluster of ack.clusters) validateClusterReceipt(cluster);
    }
    return ack;
  }
  async function listUnfinishedJobs(): Promise<ChannelJob[]> {
    await directory();
    const pending: ChannelJob[] = [];
    for (const name of await readdir(root)) {
      if (!name.endsWith('.job.json')) continue;
      const id = name.slice(0, -9);
      if (!ID.test(id)) continue;
      const job = await read(name) as ChannelJob;
      validateJob(job);
      if (job.job_id !== id) throw new Error('Job filename mismatch.');
      if (!terminal(await readAck(job))) pending.push(job);
    }
    return pending;
  }
  async function waitForAck(job: ChannelJob, timeoutMs = 30000): Promise<PluginAck> {
    validateJob(job);
    if (!Number.isFinite(timeoutMs) || timeoutMs < 1 || timeoutMs > 120000) throw new Error('Ack timeout must be 1–120000 ms.');
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const ack = await readAck(job);
      if (terminal(ack)) return ack!;
      // The confirm dialog blocks the plugin's event loop, pausing its heartbeat; a
      // matching claim keeps the job alive instead of failing on a stale presence file.
      if (!await freshPresence() && !await claimed(job)) throw new Error(unavailable);
      await new Promise((done) => setTimeout(done, Math.min(100, Math.max(1, deadline - Date.now()))));
    }
    throw new Error('Plugin ack timed out: check Zotero and its pending confirmation dialog; job remains pending.');
  }
  return { root, createPingJob, createNativeMergeJob, findNativeMergeJob, readAck, listUnfinishedJobs, waitForAck };
}
