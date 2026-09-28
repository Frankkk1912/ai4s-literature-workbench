import { chmod, mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { BrokerIndex, JobRecord, SessionSnapshot } from './domain.js';
import { DATABASE_ID } from './domain.js';

const FILE_MODE = 0o600;
const DIRECTORY_MODE = 0o700;
const WRITE_REPLACE_ATTEMPTS = 5;
const WRITE_REPLACE_BACKOFF_MS = 20;
const WINDOWS_REPLACE_LOCK_CODES = new Set(['EBUSY', 'EPERM', 'EACCES']);

function now(): string {
  return new Date().toISOString();
}

function defaultSession(): SessionSnapshot {
  return {
    database: DATABASE_ID,
    sessionState: 'closed',
    userActionRequired: false,
    message: 'No WoS browser session is open.',
    updatedAt: now(),
  };
}

function defaultIndex(): BrokerIndex {
  return { schemaVersion: 1, session: defaultSession(), requestIds: {} };
}

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

// Windows replace-rename and a just-created temp file can throw EBUSY/EPERM/EACCES
// while a concurrent reader or Defender scan still holds them. POSIX rename-over
// an open file succeeds, so this bounded retry is a no-op unless those codes appear.
async function withWindowsReplaceRetry(operation: () => Promise<void>): Promise<void> {
  for (let attempt = 1; attempt <= WRITE_REPLACE_ATTEMPTS; attempt += 1) {
    try {
      await operation();
      return;
    } catch (error: unknown) {
      if (!isWindowsReplaceLock(error) || attempt === WRITE_REPLACE_ATTEMPTS) throw error;
      await delay(WRITE_REPLACE_BACKOFF_MS * attempt);
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

export class JobStore {
  readonly jobsDir: string;
  readonly profilesDir: string;
  private readonly indexPath: string;

  constructor(readonly dataDir: string) {
    this.jobsDir = join(dataDir, 'jobs');
    this.profilesDir = join(dataDir, 'profiles');
    this.indexPath = join(dataDir, 'broker.json');
  }

  async init(): Promise<BrokerIndex> {
    await Promise.all([ensurePrivateDirectory(this.dataDir), ensurePrivateDirectory(this.jobsDir), ensurePrivateDirectory(this.profilesDir)]);
    try {
      return await readJson<BrokerIndex>(this.indexPath);
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      const index = defaultIndex();
      await this.saveIndex(index);
      return index;
    }
  }

  async saveIndex(index: BrokerIndex): Promise<void> {
    await writeJson(this.indexPath, index);
  }

  jobDir(jobId: string): string {
    return join(this.jobsDir, jobId);
  }

  exportsDir(jobId: string): string {
    return join(this.jobDir(jobId), 'exports');
  }

  receiptPath(jobId: string): string {
    return join(this.jobDir(jobId), 'search_receipt.json');
  }

  async createJob(job: JobRecord): Promise<void> {
    await ensurePrivateDirectory(this.jobDir(job.jobId));
    await ensurePrivateDirectory(this.exportsDir(job.jobId));
    await this.saveJob(job);
  }

  async loadJob(jobId: string): Promise<JobRecord | undefined> {
    try {
      return await readJson<JobRecord>(join(this.jobDir(jobId), 'state.json'));
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw error;
    }
  }

  async saveJob(job: JobRecord): Promise<void> {
    await writeJson(join(this.jobDir(job.jobId), 'state.json'), job);
  }

  async saveReceipt(job: JobRecord): Promise<void> {
    const receipt = {
      schema_version: 1,
      database: job.database,
      adapter_version: '0.1.0',
      job_id: job.jobId,
      attempt_id: job.attemptId,
      request_ids: {
        search: job.search.requestId,
        ...(job.export ? { export: job.export.requestId } : {}),
      },
      query_hash: job.search.queryHash,
      filters: job.appliedFilters ?? job.search.filters ?? {},
      sort: job.appliedSort ?? job.search.sort ?? 'relevance',
      reported_result_count: job.reportedResultCount,
      export_options: job.export
        ? { limit: job.export.limit, format: job.export.format }
        : undefined,
      exports: job.exportFiles?.map((file) => ({
        batch_range: [file.rangeStart, file.rangeEnd],
        sha256: file.sha256,
        bytes: file.bytes,
        validated_rows: file.validatedRows,
      })) ?? [],
      exported_record_count: job.exportedRecordCount,
      timeline: job.timeline,
      final_state: job.state,
      error_code: job.errorCode,
    };
    await writeJson(this.receiptPath(job.jobId), receipt);
  }

  async listJobs(): Promise<JobRecord[]> {
    let entries: string[];
    try {
      entries = await readdir(this.jobsDir);
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    }
    const jobs = await Promise.all(entries.map((jobId) => this.loadJob(jobId)));
    return jobs.filter((job): job is JobRecord => Boolean(job));
  }
}
