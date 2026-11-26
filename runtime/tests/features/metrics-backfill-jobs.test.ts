import { afterEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  backfillJobPlanHash,
  createMetricsBackfillConsumer,
  redactSecrets,
  validateBackfillJob,
  type MetricsBackfillJob,
} from '../../src/features/plugin-channel/metrics-backfill-jobs.js';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((path) => rm(path, { recursive: true, force: true }))); });

async function fixture() {
  const dataDir = await mkdtemp(join(tmpdir(), 'metrics-backfill-jobs-'));
  roots.push(dataDir);
  const consumer = createMetricsBackfillConsumer({
    dataDir,
    runPreview: async () => { throw new Error('replaced per test'); },
  });
  await mkdir(consumer.root, { recursive: true });
  return { dataDir, consumer };
}

function job(payload: Record<string, unknown>): MetricsBackfillJob {
  const plan = {
    schema_version: 1 as const,
    job_id: randomUUID(),
    job_type: 'metrics-backfill' as const,
    created_at: new Date().toISOString(),
    payload,
  };
  return { ...plan, plan_hash: backfillJobPlanHash(plan) };
}

async function addJob(root: string, entry: MetricsBackfillJob): Promise<string> {
  const name = `${entry.job_id}.job.json`;
  await writeFile(join(root, name), JSON.stringify(entry));
  return name;
}

const readJson = async (root: string, name: string) => JSON.parse(await readFile(join(root, name), 'utf8'));

describe('metrics-backfill job validation', () => {
  it('accepts the pinned collection_key and item_keys payloads and matches the plugin hash', () => {
    const collection = job({ collection_key: '334VW86H' });
    const items = job({ item_keys: ['AAAA0001', 'BBBB0002'] });
    expect(validateBackfillJob(collection, collection.job_id)).toEqual(collection);
    expect(validateBackfillJob(items, items.job_id)).toEqual(items);
    // The plugin computes SHA-256 over the same fixed-order array contract.
    expect(backfillJobPlanHash({ ...collection, plan_hash: undefined as never })).toBe(collection.plan_hash);
  });

  it('rejects ping jobs, wrong ids, tampered hashes, and secret-bearing payloads', () => {
    const good = job({ collection_key: '334VW86H' });
    expect(validateBackfillJob({ ...good, job_type: 'ping' }, good.job_id)).toBeNull();
    expect(validateBackfillJob(good, randomUUID())).toBeNull();
    expect(validateBackfillJob({ ...good, plan_hash: '0'.repeat(64) }, good.job_id)).toBeNull();
    expect(validateBackfillJob(job({ collection_key: '334VW86H', api_key: 'x' }), good.job_id)).toBeNull();
    expect(validateBackfillJob(job({}), good.job_id)).toBeNull();
    expect(validateBackfillJob(job({ collection_key: 'short' }), good.job_id)).toBeNull();
    expect(validateBackfillJob(job({ item_keys: [] }), good.job_id)).toBeNull();
    expect(validateBackfillJob(job({ item_keys: Array.from({ length: 101 }, () => 'AAAA0001') }), good.job_id)).toBeNull();
    expect(validateBackfillJob(job({ item_keys: ['AAAA0001', 'notakey!'] }), good.job_id)).toBeNull();
    expect(validateBackfillJob({ ...good, extra: 1 }, good.job_id)).toBeNull();
  });
});

describe('metrics-backfill consumer', () => {
  it('answers a valid request with a dry-run result carrying counts and plan_hash', async () => {
    const { consumer } = await fixture();
    const seen: unknown[] = [];
    const run = createMetricsBackfillConsumer({
      dataDir: consumer.root.slice(0, -'/plugin-jobs'.length),
      runPreview: async (payload) => {
        seen.push(payload);
        return { update: 3, skip: 1, plan_hash: 'a'.repeat(64), easyscholar: { key_configured: true } };
      },
    });
    const request = job({ collection_key: '334VW86H' });
    await addJob(run.root, request);
    expect(await run.scanOnce()).toBe(1);
    expect(seen).toEqual([{ collection_key: '334VW86H' }]);
    const result = await readJson(run.root, `${request.job_id}.result.json`);
    expect(result).toEqual({
      schema_version: 1,
      job_id: request.job_id,
      job_plan_hash: request.plan_hash,
      status: 'completed',
      mode: 'dry_run',
      finished_at: expect.any(String),
      preview: { update: 3, skip: 1, plan_hash: 'a'.repeat(64), easyscholar: { key_configured: true } },
    });
    expect(JSON.stringify(result)).not.toMatch(/api[_-]?key|secret|token|password/i);
    // The request job stays for the add-on to discard after showing the preview.
    expect(await readJson(run.root, `${request.job_id}.job.json`)).toEqual(request);
  });

  it('passes item_keys through exactly and processes several jobs in one scan', async () => {
    const { consumer } = await fixture();
    const payloads: unknown[] = [];
    const run = createMetricsBackfillConsumer({
      dataDir: consumer.root.slice(0, -'/plugin-jobs'.length),
      runPreview: async (payload) => {
        payloads.push(payload);
        return { update: 1, skip: 0, plan_hash: 'b'.repeat(64), easyscholar: { key_configured: false } };
      },
    });
    const first = job({ item_keys: ['AAAA0001', 'BBBB0002'] });
    const second = job({ collection_key: '334VW86H' });
    await addJob(run.root, first);
    await addJob(run.root, second);
    expect(await run.scanOnce()).toBe(2);
    // readdir iteration order is not guaranteed, so compare as a set.
    expect(payloads).toContainEqual({ item_keys: ['AAAA0001', 'BBBB0002'] });
    expect(payloads).toContainEqual({ collection_key: '334VW86H' });
    expect(payloads).toHaveLength(2);
    expect((await readJson(run.root, `${first.job_id}.result.json`)).preview.easyscholar.key_configured).toBe(false);
  });

  it('writes a readable failed result and never reprocesses an answered job', async () => {
    const { consumer } = await fixture();
    let attempts = 0;
    const run = createMetricsBackfillConsumer({
      dataDir: consumer.root.slice(0, -'/plugin-jobs'.length),
      runPreview: async () => {
        attempts += 1;
        throw new Error('Metrics backfill requires the real Zotero cloud Web API; call setup_status.');
      },
    });
    const request = job({ collection_key: '334VW86H' });
    await addJob(run.root, request);
    expect(await run.scanOnce()).toBe(1);
    expect(await run.scanOnce()).toBe(0, 'an answered job is never rebuilt');
    expect(attempts).toBe(1);
    const result = await readJson(run.root, `${request.job_id}.result.json`);
    expect(result.status).toBe('failed');
    expect(result.error).toBe('Metrics backfill requires the real Zotero cloud Web API; call setup_status.');
    expect(result.job_plan_hash).toBe(request.plan_hash);
    expect(result.mode).toBe('dry_run');
  });

  it('ignores ping and invalid jobs without writing anything', async () => {
    const { consumer } = await fixture();
    const run = createMetricsBackfillConsumer({
      dataDir: consumer.root.slice(0, -'/plugin-jobs'.length),
      runPreview: async () => { throw new Error('must not run'); },
    });
    const pingLike = job({ collection_key: '334VW86H' });
    const tampered = { ...job({ collection_key: '334VW86H' }), plan_hash: '0'.repeat(64) };
    const junk = { hello: 'world' };
    await addJob(run.root, { ...pingLike, job_type: 'ping' });
    await writeFile(join(run.root, `${tampered.job_id}.job.json`), JSON.stringify(tampered));
    await writeFile(join(run.root, 'not-a-uuid.job.json'), JSON.stringify(junk));
    expect(await run.scanOnce()).toBe(0);
    for (const id of [pingLike.job_id, tampered.job_id]) {
      await expect(readFile(join(run.root, `${id}.result.json`))).rejects.toMatchObject({ code: 'ENOENT' });
      await expect(readFile(join(run.root, `${id}.job.json`))).resolves.toBeTruthy();
    }
  });

  it('accepts plugin-normalized UUID filenames and writes a matching result; braced Gecko names are skipped', async () => {
    const seen: unknown[] = [];
    const { consumer } = await fixture();
    const run = createMetricsBackfillConsumer({
      dataDir: consumer.root.slice(0, -'/plugin-jobs'.length),
      runPreview: async (payload) => {
        seen.push(payload);
        return { update: 1, skip: 0, plan_hash: 'b'.repeat(64), easyscholar: { key_configured: false } };
      },
    });
    const SAFE_NAME = /^[a-f0-9-]{36}\.(job|ack|claim|result)\.json$/;
    const collection = job({ collection_key: '334VW86H' });
    const items = job({ item_keys: ['3DI5B43M', 'C5XDZY48'] });
    expect(await addJob(run.root, collection)).toMatch(SAFE_NAME);
    expect(await addJob(run.root, items)).toMatch(SAFE_NAME);
    expect(await run.scanOnce()).toBe(2);
    expect(seen).toHaveLength(2);
    expect(seen).toEqual(expect.arrayContaining([
      { collection_key: '334VW86H' },
      { item_keys: ['3DI5B43M', 'C5XDZY48'] },
    ]));
    for (const request of [collection, items]) {
      const resultName = `${request.job_id}.result.json`;
      expect(resultName).toMatch(SAFE_NAME);
      const result = await readJson(run.root, resultName);
      expect(result.job_id).toBe(request.job_id);
      expect(result.status).toBe('completed');
      expect(result.mode).toBe('dry_run');
    }
    const geckoName = `{${randomUUID().toUpperCase()}}.job.json`;
    await writeFile(join(run.root, geckoName), JSON.stringify(job({ collection_key: '334VW86H' })));
    expect(await run.scanOnce()).toBe(0);
    await expect(readFile(join(run.root, geckoName.replace(/\.job\.json$/, '.result.json')))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('treats a missing jobs directory as empty instead of failing', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'metrics-backfill-empty-'));
    roots.push(dataDir);
    const run = createMetricsBackfillConsumer({ dataDir, runPreview: async () => { throw new Error('must not run'); } });
    expect(await run.scanOnce()).toBe(0);
  });

  it('start/stop the polling loop without keeping the process alive', async () => {
    const { consumer } = await fixture();
    const run = createMetricsBackfillConsumer({
      dataDir: consumer.root.slice(0, -'/plugin-jobs'.length),
      intervalMs: 10,
      runPreview: async () => ({ update: 1, skip: 0, plan_hash: 'c'.repeat(64), easyscholar: { key_configured: true } }),
    });
    const request = job({ collection_key: '334VW86H' });
    await addJob(run.root, request);
    run.start();
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(await readFile(join(run.root, `${request.job_id}.result.json`), 'utf8')).toBeTruthy();
    run.stop();
  });

  it('redacts obvious secret assignments from error text', () => {
    expect(redactSecrets('boom api_key=ABC123XYZ and token: "zzz"')).toBe('boom api_key=[redacted] and token: [redacted]');
    expect(redactSecrets('a normal readable failure')).toBe('a normal readable failure');
  });
});
