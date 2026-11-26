import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, readdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createPluginChannel, channelPlanHash, type ChannelJob, type NativeMergePayload } from '../../src/features/plugin-channel/index.js';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((path) => rm(path, { recursive: true, force: true }))); });
async function fixture(present = true) {
  const dataDir = await mkdtemp(join(tmpdir(), 'plugin-channel-'));
  roots.push(dataDir);
  const channel = createPluginChannel(dataDir);
  await mkdir(channel.root);
  if (present) await writeFile(join(channel.root, 'presence.json'), JSON.stringify({ schema_version: 1, updated_at: new Date().toISOString() }));
  return channel;
}
async function ack(channel: ReturnType<typeof createPluginChannel>, job: ChannelJob, fields = {}) {
  await writeFile(join(channel.root, `${job.job_id}.ack.json`), JSON.stringify({
    job_id: job.job_id, plan_hash: job.plan_hash, status: 'completed', finished_at: new Date().toISOString(), ...fields,
  }));
}
async function claim(channel: ReturnType<typeof createPluginChannel>, job: ChannelJob, fields = {}) {
  await writeFile(join(channel.root, `${job.job_id}.claim.json`), JSON.stringify({
    schema_version: 1, job_id: job.job_id, plan_hash: job.plan_hash, claimed_at: new Date().toISOString(), ...fields,
  }));
}

describe('internal ping channel', () => {
  it('atomically writes an empty ping and reads matching completed ack', async () => {
    const channel = await fixture();
    const job = await channel.createPingJob();
    expect(job.plan_hash).toBe(channelPlanHash(job));
    expect(JSON.parse(await readFile(join(channel.root, `${job.job_id}.job.json`), 'utf8'))).toEqual(job);
    expect(job.payload).toEqual({});
    expect(await channel.readAck(job)).toBeNull();
    expect(await channel.listUnfinishedJobs()).toEqual([job]);
    await ack(channel, job, { status: 'accepted' });
    expect(await channel.listUnfinishedJobs()).toEqual([job]);
    await ack(channel, job);
    expect((await channel.waitForAck(job, 50)).status).toBe('completed');
    expect(await channel.listUnfinishedJobs()).toEqual([]);
  });

  it('rejects mismatched hashes and malformed contracts', async () => {
    const channel = await fixture();
    const job = await channel.createPingJob();
    await ack(channel, job, { plan_hash: '0'.repeat(64) });
    await expect(channel.readAck(job)).rejects.toThrow('plan_hash mismatch');
    await expect(channel.readAck({ ...job, payload: { api_key: 'not-allowed' } } as unknown as ChannelJob)).rejects.toThrow('Invalid channel job');
    await ack(channel, job, { status: 'unknown' });
    await expect(channel.readAck(job)).rejects.toThrow('Invalid plugin ack');
    await ack(channel, job, { status: 'failed' });
    await expect(channel.readAck(job)).rejects.toThrow('Invalid plugin ack');
    await ack(channel, job, { status: 'rejected', error: 'User declined connectivity test.' });
    expect(await channel.listUnfinishedJobs()).toEqual([]);
  });

  it('clearly rejects a missing directory without creating it', async () => {
    const channel = await fixture();
    await rm(channel.root, { recursive: true });
    await expect(channel.createPingJob()).rejects.toThrow('Plugin jobs directory missing');
    await expect(channel.listUnfinishedJobs()).rejects.toThrow('Plugin jobs directory missing');
  });

  it('returns immediately when desktop plugin is absent, stale, or stopped', async () => {
    const channel = await fixture(false);
    await expect(channel.createPingJob()).rejects.toThrow('Desktop plugin unavailable');
    await writeFile(join(channel.root, 'presence.json'), JSON.stringify({ schema_version: 1, updated_at: new Date(0).toISOString() }));
    await expect(channel.createPingJob()).rejects.toThrow('Desktop plugin unavailable');
    await writeFile(join(channel.root, 'presence.json'), JSON.stringify({ schema_version: 1, updated_at: new Date().toISOString() }));
    const job = await channel.createPingJob();
    await rm(join(channel.root, 'presence.json'));
    await expect(channel.waitForAck(job, 100)).rejects.toThrow('Desktop plugin unavailable');
  });

  it('keeps a claimed job alive while the heartbeat is stale, until a late terminal ack', async () => {
    const channel = await fixture();
    const job = await channel.createPingJob();
    // The Zotero confirm dialog blocks the plugin event loop, so its heartbeat goes stale.
    await writeFile(join(channel.root, 'presence.json'), JSON.stringify({ schema_version: 1, updated_at: new Date(Date.now() - 60000).toISOString() }));
    await claim(channel, job);
    const lateAck = setTimeout(() => { void ack(channel, job); }, 60);
    expect((await channel.waitForAck(job, 5000)).status).toBe('completed');
    clearTimeout(lateAck);
    expect(await channel.listUnfinishedJobs()).toEqual([]);
  });

  it('ends a claimed but unresolved job at the overall timeout, not as unavailable', async () => {
    const channel = await fixture();
    const job = await channel.createPingJob();
    await writeFile(join(channel.root, 'presence.json'), JSON.stringify({ schema_version: 1, updated_at: new Date(0).toISOString() }));
    await claim(channel, job);
    await expect(channel.waitForAck(job, 50)).rejects.toThrow('ack timed out');
  });

  it('still errors as unavailable after the plugin stops and withdraws its claim', async () => {
    const channel = await fixture();
    const job = await channel.createPingJob();
    await claim(channel, job);
    await rm(join(channel.root, 'presence.json'));
    await rm(join(channel.root, `${job.job_id}.claim.json`));
    await expect(channel.waitForAck(job, 200)).rejects.toThrow('Desktop plugin unavailable');
  });

  it('ignores a mismatched claim and still requires the desktop heartbeat', async () => {
    const channel = await fixture();
    const job = await channel.createPingJob();
    await rm(join(channel.root, 'presence.json'));
    await claim(channel, job, { plan_hash: '0'.repeat(64) });
    await expect(channel.waitForAck(job, 100)).rejects.toThrow('Desktop plugin unavailable');
  });

  it('bounds waiting even with a live heartbeat and no acknowledgement', async () => {
    const channel = await fixture();
    const job = await channel.createPingJob();
    await expect(channel.waitForAck(job, 25)).rejects.toThrow('ack timed out');
    expect(await channel.listUnfinishedJobs()).toEqual([job]);
    await expect(channel.waitForAck(job, Infinity)).rejects.toThrow('Ack timeout');
  });

  it('refuses symlinked job files and directories', async () => {
    const channel = await fixture();
    const job = await channel.createPingJob();
    const target = join(channel.root, `${job.job_id}.ack.json`);
    const outside = join(roots[0]!, 'outside.json');
    await writeFile(outside, '{}');
    await symlink(outside, target, 'file');
    await expect(channel.readAck(job)).rejects.toThrow('Unsafe plugin channel file');
    await rm(channel.root, { recursive: true });
    const other = join(roots[0]!, 'other');
    await mkdir(other);
    await symlink(other, channel.root, process.platform === 'win32' ? 'junction' : 'dir');
    await expect(channel.listUnfinishedJobs()).rejects.toThrow('missing or unsafe');
  });
});

describe('internal native-merge channel', () => {
  const guardPayload = (dataDir: string): NativeMergePayload => ({
    plan_path: join(dataDir, 'dedupe-plans', 'dedupe-plan-smoke.json'),
    plan_hash: `sha256:${'a'.repeat(64)}`,
    collection_key: '334VW86H',
  });

  it('writes a native-merge job whose payload names the plan, its hash, and the guard collection', async () => {
    const channel = await fixture();
    const job = await channel.createNativeMergeJob(guardPayload(channel.root.replace(/plugin-jobs$/, '')));
    expect(job.job_type).toBe('native-merge');
    expect(job.plan_hash).toBe(channelPlanHash(job));
    expect(job.payload.plan_path).toMatch(/dedupe-plans\/dedupe-plan-smoke\.json$/);
    expect(job.payload.plan_hash).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(job.payload.collection_key).toBe('334VW86H');
    expect(JSON.parse(await readFile(join(channel.root, `${job.job_id}.job.json`), 'utf8'))).toEqual(job);
    expect(await channel.listUnfinishedJobs()).toEqual([job]);
    await ack(channel, job);
    expect(await channel.listUnfinishedJobs()).toEqual([]);
  });

  it('refuses unsafe or malformed native-merge payloads', async () => {
    const channel = await fixture();
    const dataDir = channel.root.replace(/plugin-jobs$/, '');
    await expect(channel.createNativeMergeJob({ ...guardPayload(dataDir), plan_path: join(dataDir, 'elsewhere.json') }))
      .rejects.toThrow('Unsafe dedupe plan path');
    await expect(channel.createNativeMergeJob({ ...guardPayload(dataDir), plan_path: 'dedupe-plans/relative.json' }))
      .rejects.toThrow('Invalid native-merge job payload');
    await expect(channel.createNativeMergeJob({ ...guardPayload(dataDir), plan_hash: 'deadbeef' }))
      .rejects.toThrow('Invalid native-merge job payload');
    await expect(channel.createNativeMergeJob({ ...guardPayload(dataDir), collection_key: 'not-a-key' }))
      .rejects.toThrow('Invalid native-merge job payload');
    // Nothing was written by any refused payload.
    expect((await readdir(channel.root)).sort()).toEqual(['presence.json']);
  });

  it('fails clearly when the desktop plugin is not running', async () => {
    const channel = await fixture(false);
    await expect(channel.createNativeMergeJob(guardPayload(channel.root.replace(/plugin-jobs$/, ''))))
      .rejects.toThrow('Desktop plugin unavailable');
  });

  it('validates per-cluster receipts and rejects malformed cluster entries', async () => {
    const channel = await fixture();
    const job = await channel.createNativeMergeJob(guardPayload(channel.root.replace(/plugin-jobs$/, '')));
    await ack(channel, job, {
      clusters: [
        { cluster_id: 'duplicate-0001', status: 'success', master_key: 'SMOKE001', merged_keys: ['SMOKE002'], added_to_collection: false },
        { cluster_id: 'duplicate-0002', status: 'failed', error: 'Item SMOKE003 is gone.' },
      ],
    });
    const received = await channel.readAck(job);
    expect(received?.status).toBe('completed');
    expect(received?.clusters).toHaveLength(2);
    expect(received?.clusters?.[0]).toMatchObject({ cluster_id: 'duplicate-0001', status: 'success' });
    await ack(channel, job, { clusters: [{ cluster_id: 'x', status: 'nonsense' }] });
    await expect(channel.readAck(job)).rejects.toThrow('Invalid plugin ack');
    await ack(channel, job, { clusters: [{ cluster_id: 'x', status: 'failed' }] });
    await expect(channel.readAck(job)).rejects.toThrow('Invalid plugin ack');
    await ack(channel, job, { clusters: [{ cluster_id: 'x', status: 'skipped', master_key: 'not-a-zotero-key' }] });
    await expect(channel.readAck(job)).rejects.toThrow('Invalid plugin ack');
  });

  it('finds the pending job for an exact payload and ignores terminal or foreign jobs', async () => {
    const channel = await fixture();
    const payload = guardPayload(channel.root.replace(/plugin-jobs$/, ''));
    expect(await channel.findNativeMergeJob(payload)).toBeNull();
    const job = await channel.createNativeMergeJob(payload);
    expect(await channel.findNativeMergeJob(payload)).toEqual(job);
    // A different plan hash is a different job.
    expect(await channel.findNativeMergeJob({ ...payload, plan_hash: `sha256:${'b'.repeat(64)}` })).toBeNull();
    // A terminal receipt takes the job out of the pending set.
    await ack(channel, job, { status: 'rejected', error: 'User declined the native merge.' });
    expect(await channel.findNativeMergeJob(payload)).toBeNull();
    // The newest pending job wins when more than one exists.
    const older = await channel.createNativeMergeJob(payload);
    await new Promise((done) => setTimeout(done, 5));
    const newer = await channel.createNativeMergeJob(payload);
    expect((await channel.findNativeMergeJob(payload))?.job_id).toBe(newer.job_id);
    expect((await channel.findNativeMergeJob(payload))?.job_id).not.toBe(older.job_id);
  });
});
