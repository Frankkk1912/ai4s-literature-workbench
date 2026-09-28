import { chmod, mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { BrokerIndex, JobRecord } from './domain.js';
import { sha256 as hashSha256 } from './lib/canonical.js';

const FILE_MODE = 0o600;
const DIRECTORY_MODE = 0o700;
// 与 database-browser store 同一 Windows replace-lock 模式，预防性对齐。
// Round-6 CI showed EPERM on replace-rename lasting past a ~200ms budget;
// Defender scans and open read handles are the typical lock source. Retry on a
// 5000ms deadline at a fixed 100ms interval. Non-lock errors throw immediately.
const WRITE_REPLACE_BUDGET_MS = 5_000;
const WRITE_REPLACE_RETRY_DELAY_MS = 100;
const WINDOWS_REPLACE_LOCK_CODES = new Set(['EBUSY', 'EPERM', 'EACCES']);

async function ensurePrivateDirectory(path: string): Promise<void> {
  await mkdir(path, { recursive: true, mode: DIRECTORY_MODE });
  await chmod(path, DIRECTORY_MODE).catch(() => undefined);
}

function isWindowsReplaceLock(error: unknown): boolean {
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' && WINDOWS_REPLACE_LOCK_CODES.has(code);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function withWindowsReplaceRetry(operation: () => Promise<void>): Promise<void> {
  const deadline = Date.now() + WRITE_REPLACE_BUDGET_MS;
  for (;;) {
    try {
      await operation();
      return;
    } catch (error: unknown) {
      if (!isWindowsReplaceLock(error) || Date.now() >= deadline) throw error;
      await delay(WRITE_REPLACE_RETRY_DELAY_MS);
    }
  }
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await ensurePrivateDirectory(dirname(path));
  const temporary = `${path}.${process.pid}.${Date.now()}.tmp`;
  const payload = `${JSON.stringify(value, null, 2)}\n`;
  await withWindowsReplaceRetry(() => writeFile(temporary, payload, { encoding: 'utf8', mode: FILE_MODE }));
  await withWindowsReplaceRetry(() => rename(temporary, path));
  await chmod(path, FILE_MODE).catch(() => undefined);
}

async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, 'utf8')) as T;
}

function defaultIndex(): BrokerIndex { return { schemaVersion: 1, requestIds: {} }; }

function safeSha256(value: string): string {
  if (!/^[a-f0-9]{64}$/i.test(value)) throw new Error('Expected SHA-256 hex digest.');
  return value.toLowerCase();
}

export class FulltextStore {
  readonly jobsDir: string;
  readonly cacheDir: string;
  readonly handoffsDir: string;
  readonly artifactsDir: string;
  readonly receiptsDir: string;
  private readonly indexPath: string;

  constructor(readonly dataDir: string, readonly exchangeRoot: string) {
    this.jobsDir = join(dataDir, 'jobs');
    this.cacheDir = join(dataDir, 'cache');
    this.handoffsDir = join(exchangeRoot, 'handoffs');
    this.artifactsDir = join(exchangeRoot, 'artifacts');
    this.receiptsDir = join(exchangeRoot, 'receipts');
    this.indexPath = join(dataDir, 'broker.json');
  }

  async init(): Promise<BrokerIndex> {
    await Promise.all([
      ensurePrivateDirectory(this.dataDir), ensurePrivateDirectory(this.jobsDir), ensurePrivateDirectory(this.cacheDir),
      ensurePrivateDirectory(this.exchangeRoot), ensurePrivateDirectory(this.handoffsDir),
      ensurePrivateDirectory(this.artifactsDir), ensurePrivateDirectory(this.receiptsDir),
    ]);
    try {
      return await readJson<BrokerIndex>(this.indexPath);
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      const index = defaultIndex();
      await this.saveIndex(index);
      return index;
    }
  }

  async saveIndex(index: BrokerIndex): Promise<void> { await writeJson(this.indexPath, index); }
  jobDir(jobId: string): string { return join(this.jobsDir, jobId); }
  jobPath(jobId: string): string { return join(this.jobDir(jobId), 'state.json'); }
  jobReceiptPath(jobId: string): string { return join(this.jobDir(jobId), 'receipt.json'); }
  handoffPath(handoffId: string): string { return join(this.handoffsDir, `${handoffId}.json`); }
  artifactPath(sha256: string): string { return join(this.artifactsDir, `${safeSha256(sha256)}.pdf`); }

  async createJob(job: JobRecord): Promise<void> {
    await ensurePrivateDirectory(this.jobDir(job.jobId));
    await this.saveJob(job);
  }

  async loadJob(jobId: string): Promise<JobRecord | undefined> {
    try {
      return await readJson<JobRecord>(this.jobPath(jobId));
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw error;
    }
  }

  async listJobs(): Promise<JobRecord[]> {
    let entries: string[];
    try { entries = await readdir(this.jobsDir); } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    }
    const values = await Promise.all(entries.map((entry) => this.loadJob(entry)));
    return values.filter((value): value is JobRecord => Boolean(value));
  }

  async saveJob(job: JobRecord): Promise<void> { await writeJson(this.jobPath(job.jobId), job); }

  async saveJobReceipt(job: JobRecord): Promise<void> {
    await writeJson(this.jobReceiptPath(job.jobId), {
      schema_version: 1,
      receipt_type: 'fulltext-fetch-job',
      job_id: job.jobId,
      request_id: job.request.requestId,
      state: job.state,
      handoff_id: job.handoffId ?? null,
      handoff_hash: job.handoffHash ?? null,
      records: job.records.map((record) => ({
        evidence_id: record.evidenceId,
        zotero_item_key: record.zoteroItemKey,
        state: record.state,
        error_code: record.errorCode ?? null,
      })),
      updated_at: job.updatedAt,
    });
  }

  async writeArtifact(sha256: string, bytes: Uint8Array): Promise<string> {
    const target = this.artifactPath(sha256);
    try {
      const existing = await readFile(target);
      if (existing.byteLength !== bytes.byteLength || hashSha256(existing) !== safeSha256(sha256)) {
        throw new Error('Existing artifact conflicts with its SHA-256 name.');
      }
      return target;
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    const temporary = `${target}.${process.pid}.${Date.now()}.tmp`;
    await withWindowsReplaceRetry(() => writeFile(temporary, bytes, { mode: FILE_MODE }));
    await withWindowsReplaceRetry(() => rename(temporary, target));
    await chmod(target, FILE_MODE).catch(() => undefined);
    return target;
  }

  async writeHandoff(handoff: { handoff_id: string }): Promise<string> {
    const path = this.handoffPath(handoff.handoff_id);
    await writeJson(path, handoff);
    return path;
  }
}
