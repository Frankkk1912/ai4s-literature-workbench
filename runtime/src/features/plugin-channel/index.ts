import { createHash, randomUUID } from 'node:crypto';
import { lstat, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { defaultDataDir } from '../../lib/paths.js';

export interface PingJob {
  schema_version: 1;
  job_id: string;
  job_type: 'ping';
  created_at: string;
  plan_hash: string;
  payload: Record<string, never>;
}
export interface PluginAck {
  job_id: string;
  plan_hash: string;
  status: 'accepted' | 'rejected' | 'completed' | 'failed';
  finished_at: string;
  error?: string;
}
export interface PluginClaim {
  schema_version: 1;
  job_id: string;
  plan_hash: string;
  claimed_at: string;
}
const ID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const HASH = /^[a-f0-9]{64}$/;
const unavailable = 'Desktop plugin unavailable: open Zotero with Literature Metrics enabled and the same dataDir.';
const terminal = (ack: PluginAck | null) => ack !== null && ack.status !== 'accepted';

/** SHA-256 of the fixed-order, ASCII-only ping contract; not an authorization token. */
export function pingPlanHash(job: Omit<PingJob, 'plan_hash'>): string {
  return createHash('sha256').update(JSON.stringify([
    job.schema_version, job.job_id, job.job_type, job.created_at, job.payload,
  ])).digest('hex');
}
function validateJob(job: PingJob): void {
  if (!job || Object.keys(job).sort().join(',') !== 'created_at,job_id,job_type,payload,plan_hash,schema_version'
    || job.schema_version !== 1 || !ID.test(job.job_id) || job.job_type !== 'ping'
    || typeof job.created_at !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(job.created_at)
    || !Number.isFinite(Date.parse(job.created_at)) || !job.payload || Array.isArray(job.payload)
    || typeof job.payload !== 'object' || Object.keys(job.payload).length !== 0
    || !HASH.test(job.plan_hash) || pingPlanHash(job) !== job.plan_hash) {
    throw new Error('Invalid ping job or plan_hash mismatch.');
  }
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
      if (!info.isFile() || info.size > 4096) throw new Error('Unsafe plugin channel file.');
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
  async function claimed(job: PingJob): Promise<boolean> {
    const claim = await read(`${job.job_id}.claim.json`) as PluginClaim | null;
    return claim !== null && claim.schema_version === 1 && claim.job_id === job.job_id
      && claim.plan_hash === job.plan_hash && typeof claim.claimed_at === 'string'
      && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(claim.claimed_at)
      && Number.isFinite(Date.parse(claim.claimed_at));
  }
  async function createPingJob(): Promise<PingJob> {
    await requireDesktop();
    const plan = { schema_version: 1 as const, job_id: randomUUID(), job_type: 'ping' as const,
      created_at: new Date().toISOString(), payload: {} };
    const job = { ...plan, plan_hash: pingPlanHash(plan) };
    const target = join(root, `${job.job_id}.job.json`);
    const temporary = `${target}.${randomUUID()}.tmp`;
    await writeFile(temporary, JSON.stringify(job), { flag: 'wx', mode: 0o600 });
    await rename(temporary, target);
    return job;
  }
  async function readAck(job: PingJob): Promise<PluginAck | null> {
    validateJob(job);
    const ack = await read(`${job.job_id}.ack.json`) as PluginAck | null;
    if (ack === null) return null;
    if (ack.job_id !== job.job_id || ack.plan_hash !== job.plan_hash) throw new Error('Ack job_id or plan_hash mismatch.');
    if (Object.keys(ack).some((key) => !['job_id', 'plan_hash', 'status', 'finished_at', 'error'].includes(key))
      || !['accepted', 'rejected', 'completed', 'failed'].includes(ack.status)
      || typeof ack.finished_at !== 'string' || !Number.isFinite(Date.parse(ack.finished_at))
      || (ack.error !== undefined && typeof ack.error !== 'string')
      || (['rejected', 'failed'].includes(ack.status) && !ack.error)) throw new Error('Invalid plugin ack.');
    return ack;
  }
  async function listUnfinishedJobs(): Promise<PingJob[]> {
    await directory();
    const pending: PingJob[] = [];
    for (const name of await readdir(root)) {
      if (!name.endsWith('.job.json')) continue;
      const id = name.slice(0, -9);
      if (!ID.test(id)) continue;
      const job = await read(name) as PingJob;
      validateJob(job);
      if (job.job_id !== id) throw new Error('Job filename mismatch.');
      if (!terminal(await readAck(job))) pending.push(job);
    }
    return pending;
  }
  async function waitForAck(job: PingJob, timeoutMs = 30000): Promise<PluginAck> {
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
  return { root, createPingJob, readAck, listUnfinishedJobs, waitForAck };
}
