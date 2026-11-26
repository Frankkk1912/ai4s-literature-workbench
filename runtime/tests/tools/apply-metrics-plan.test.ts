import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { canonicalMetricsPlanHash, executeMetricsPlan, type MetricsPlan, validateMetricsPlan } from '../../src/features/metrics-plan.js';
import applyMetricsPlan from '../../src/tools/apply-metrics-plan.js';

function plan(): MetricsPlan {
  const value: MetricsPlan = {
    schema_version: '1.0', plan_type: 'zotero-metrics', created_at: '2026-07-13T00:00:00Z', plan_hash: 'sha256:'.padEnd(71, '0'),
    target: { library_type: 'user', library_id: 1 },
    metrics: { metrics_year: 2025, remove_years: [2026], source_label: 'reviewed-2025', source_sha256: 'a'.repeat(64) },
    actions: [{ item_key: 'ITEM0001', expected_version: 4, title: 'Paper', issns: ['12345678'], decision: 'update', reason_codes: ['unique-issn-match'], metric: { impact_factor: 12.4, impact_factor_5y: 13.1, jcr_zone: 'Q2', cas_zone: '2区', publication_metrics: [{ code:'cas_major', value:'医学2区' }, { code:'cas_top', value:true }], retrieved_at:'2026-07-16', source_label: 'reviewed-2025', source_sha256: 'a'.repeat(64) } }],
    summary: { selected: 1, update: 1, skip: 0 },
  };
  value.plan_hash = canonicalMetricsPlanHash(value); return value;
}

describe('metrics plan hash confirmation after refresh', () => {
  it('requires saving and confirming the new plan hash before applying cloud-refreshed versions', async () => {
    const value = plan();
    value.actions[0]!.expected_version = 1200;
    value.plan_hash = canonicalMetricsPlanHash(value);
    const directory = await mkdtemp(join(tmpdir(), 'metrics-refresh-'));
    const originalPath = join(directory, 'original.json');
    const refreshedPath = join(directory, 'cloud.json');
    const receiptPath = join(directory, 'receipt.json');
    await writeFile(originalPath, JSON.stringify(value));
    const patchItem = vi.fn(async (_lib: unknown, _key: string, _patch: any, _version: number) => 41301);
    const ctx = { capabilities: { cloud: { userID: 1 } }, web: { isCloud: true, canWrite: true, getItem: vi.fn(async () => ({ version: 41300, data: { extra: 'Human note', tags: [] } })), patchItem } } as any;
    const dryRun = await applyMetricsPlan.handler({ plan_path: originalPath, mode: 'dry_run' }, ctx);
    const result = dryRun.structuredContent as any;
    expect(result).toMatchObject({ status: 'ready', original_plan_hash: value.plan_hash, version_refreshes: 1 });
    expect(result.plan_hash).not.toBe(value.plan_hash);
    const blocked = await applyMetricsPlan.handler({ plan_path: originalPath, mode: 'apply', confirm_plan_hash: value.plan_hash, receipt_path: receiptPath }, ctx);
    expect(blocked.structuredContent?.status).toBe('blocked');
    expect(patchItem).not.toHaveBeenCalled();
    await expect(readFile(receiptPath)).rejects.toMatchObject({ code: 'ENOENT' });
    await writeFile(refreshedPath, JSON.stringify(result.refreshed_plan));
    expect((await applyMetricsPlan.handler({ plan_path: refreshedPath, mode: 'dry_run' }, ctx)).structuredContent?.status).toBe('ready');
    await expect(applyMetricsPlan.handler({ plan_path: refreshedPath, mode: 'apply', confirm_plan_hash: value.plan_hash, receipt_path: receiptPath }, ctx)).rejects.toThrow(/confirm_plan_hash/);
    expect(patchItem).not.toHaveBeenCalled();
    const applied = await applyMetricsPlan.handler({ plan_path: refreshedPath, mode: 'apply', confirm_plan_hash: result.plan_hash, receipt_path: receiptPath }, ctx);
    expect(applied.structuredContent?.status).toBe('complete');
    expect(patchItem).toHaveBeenCalledWith({ type: 'user', id: 1 }, 'ITEM0001', expect.any(Object), 41300);
    const receipt = JSON.parse(await readFile(receiptPath, 'utf8'));
    expect(receipt.plan_hash).toBe(result.plan_hash);
    // Existing receipt idempotency still prevents a second patch.
    await applyMetricsPlan.handler({ plan_path: refreshedPath, mode: 'apply', confirm_plan_hash: result.plan_hash, receipt_path: receiptPath }, ctx);
    expect(patchItem).toHaveBeenCalledTimes(1);
  });
});

describe('metrics plan contract and execution', () => {
  it('has a stable hash and dry-runs without writes', async () => {
    const value = plan(); expect(validateMetricsPlan(structuredClone(value)).plan_hash).toBe(value.plan_hash);
    const patchItem = vi.fn(async () => 5);
    const ctx = { web: { isCloud: true, getItem: vi.fn(async () => ({ key:'ITEM0001', version:4, data:{ extra:'Human note\nAI4S-Metrics: {"schema_version":2,"by_year":{"2027":{"impact_factor":15,"jcr_zone":"Q1","source_label":"reviewed-2027","source_sha256":"b"}}}', tags:[{tag:'topic:aging'},{tag:'JCR:Q4'},{tag:'CAS:4区'}] } })), patchItem } } as any;
    const result = await executeMetricsPlan(ctx, value, { type:'user', id:1 }, 'dry_run');
    expect(result.status).toBe('ready'); expect(patchItem).not.toHaveBeenCalled();
  });

  it('reports item-read failures during a dry-run', async () => {
    const value = plan();
    const ctx = { web: { isCloud: true, getItem: vi.fn(async () => { throw new Error('fetch failed'); }), patchItem: vi.fn() } } as any;
    const result = await executeMetricsPlan(ctx, value, { type:'user', id:1 }, 'dry_run');
    expect(result.summary).toMatchObject({ updated:0, unchanged:0, skipped:0, failed:1, pending:0 });
    expect(result.status).toBe('blocked');
  });

  it('preserves unrelated tags and uses the newest year for JCR/CAS tags', async () => {
    const value = plan(); const patchItem = vi.fn(async (_lib: unknown, _key: string, _patch: any, _version: number) => 5);
    const ctx = { web: { isCloud: true, getItem: vi.fn(async () => ({ key:'ITEM0001', version:4, data:{ extra:'Human note\nAI4S-Metrics: {"schema_version":2,"by_year":{"2026":{"impact_factor":12.4,"jcr_zone":"Q2","cas_zone":"2区","source_label":"wrong-2026","source_sha256":"x"},"2027":{"impact_factor":15,"jcr_zone":"Q1","cas_zone":"1区","source_label":"reviewed-2027","source_sha256":"b"}}}', tags:[{tag:'topic:aging'},{tag:'JCR:Q4'},{tag:'CAS:4区'}] } })), patchItem } } as any;
    const receiptPath = join(await mkdtemp(join(tmpdir(), 'literature-metrics-')), 'receipt.json');
    await executeMetricsPlan(ctx, value, { type:'user', id:1 }, 'apply', receiptPath);
    const patch = patchItem.mock.calls[0]![2];
    expect(patch.extra).toContain('Human note'); expect(patch.extra).toContain('"2025"'); expect(patch.extra).not.toContain('"2026"'); expect(patch.extra).toContain('"2027"');
    expect(patch.extra).toContain('"impact_factor_5y":13.1'); expect(patch.extra).toContain('"publication_metrics"');
    expect(patch.tags.map((tag: any) => tag.tag).sort()).toEqual(['CAS:1区', 'JCR:Q1', 'topic:aging']);
  });
});
