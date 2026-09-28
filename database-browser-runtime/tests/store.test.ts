import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { JobRecord } from '../src/domain.js';
import { DATABASE_ID } from '../src/domain.js';

// node:fs/promises exports are non-configurable, so vi.spyOn(fs, 'rename') throws.
// vi.mock replaces the binding writeJson calls; the second attempt uses the real rename.

const fsControl = vi.hoisted(() => ({
  renameAttempts: 0,
}));

vi.mock('node:fs/promises', async () => {
  const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
  return {
    ...actual,
    async rename(from: string, to: string): Promise<void> {
      fsControl.renameAttempts += 1;
      if (fsControl.renameAttempts === 1) {
        throw Object.assign(new Error('busy'), { code: 'EBUSY' });
      }
      await actual.rename(from, to);
    },
  };
});

afterEach(() => {
  vi.restoreAllMocks();
  fsControl.renameAttempts = 0;
});

function queuedJob(): JobRecord {
  return {
    schemaVersion: 1,
    jobId: 'job-rename-retry',
    database: DATABASE_ID,
    attemptId: 'wos-01',
    phase: 'queued',
    state: 'queued',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    search: {
      database: DATABASE_ID,
      attemptId: 'wos-01',
      query: { mode: 'advanced-search', value: 'TS=(rename retry)' },
      requestId: 'd'.repeat(64),
      queryHash: 'hash',
    },
    userActionRequired: false,
    timeline: [{ at: '2026-01-01T00:00:00.000Z', phase: 'queued', state: 'queued', message: 'accepted' }],
  };
}

describe('JobStore writeJson', () => {
  it('retries rename when the first attempt throws EBUSY and then persists the job', async () => {
    const { JobStore } = await import('../src/store.js');
    const realSetTimeout = globalThis.setTimeout.bind(globalThis);
    let capturedDelay: number | undefined;
    let releaseBackoff: (() => void) | undefined;
    let markBackoffScheduled: () => void = () => {};
    const backoffScheduled = new Promise<void>((resolve) => {
      markBackoffScheduled = resolve;
    });
    vi.spyOn(globalThis, 'setTimeout').mockImplementation(((callback: TimerHandler, delay?: number, ...args: unknown[]) => {
      if (fsControl.renameAttempts >= 1 && releaseBackoff === undefined && typeof callback === 'function' && typeof delay === 'number' && delay > 0) {
        capturedDelay = delay;
        releaseBackoff = () => {
          callback(...args);
        };
        markBackoffScheduled();
        return 0 as unknown as ReturnType<typeof setTimeout>;
      }
      return realSetTimeout(callback, delay, ...(args as []));
    }) as typeof setTimeout);

    const dataDir = await mkdtemp(join(tmpdir(), 'literature-database-browser-store-'));
    const store = new JobStore(dataDir);
    const job = queuedJob();
    const pending = store.createJob(job);
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
    const timedOut = new Promise<never>((_, reject) => {
      timeoutHandle = realSetTimeout(() => {
        reject(new Error(`rename retry was not scheduled (attempts=${fsControl.renameAttempts})`));
      }, 2_000);
    });
    try {
      await Promise.race([backoffScheduled, timedOut]);
      expect(fsControl.renameAttempts).toBe(1);
      expect(capturedDelay).toBe(20);
      releaseBackoff?.();
      await pending;
      expect(fsControl.renameAttempts).toBe(2);
      await expect(store.loadJob(job.jobId)).resolves.toEqual(job);
    } finally {
      if (timeoutHandle) clearTimeout(timeoutHandle);
      vi.restoreAllMocks();
    }
  });
});
