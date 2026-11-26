import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createPluginChannel, pingPlanHash, type PingJob } from '../../src/features/plugin-channel/index.js';

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
async function ack(channel: ReturnType<typeof createPluginChannel>, job: PingJob, fields = {}) {
  await writeFile(join(channel.root, `${job.job_id}.ack.json`), JSON.stringify({
    job_id: job.job_id, plan_hash: job.plan_hash, status: 'completed', finished_at: new Date().toISOString(), ...fields,
  }));
}

describe('internal ping channel', () => {
  it('atomically writes an empty ping and reads matching completed ack', async () => {
    const channel = await fixture();
    const job = await channel.createPingJob();
    expect(job.plan_hash).toBe(pingPlanHash(job));
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
    await expect(channel.readAck({ ...job, payload: { api_key: 'not-allowed' } } as unknown as PingJob)).rejects.toThrow('Invalid ping');
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
