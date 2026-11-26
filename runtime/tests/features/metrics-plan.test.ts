import { mkdtemp, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it, vi } from 'vitest';
import { canonicalMetricsPlanHash, executeMetricsPlan, validateMetricsPlan, type MetricsPlan } from '../../src/features/metrics-plan.js';
import { ZoteroApiError } from '../../src/api/errors.js';
import { LocalWebClient } from '../../src/api/local-writer.js';

const library = { type: 'user', id: 1 } as const;
function versionPlan(version: number, count = 1, source?: string): MetricsPlan {
  const value: MetricsPlan = {
    schema_version: '1.0', plan_type: 'zotero-metrics', created_at: '2026-11-26', plan_hash: '',
    target: { library_type: 'user', library_id: 1 },
    metrics: { metrics_year: 2025, source_label: 'test', source_sha256: 'a'.repeat(64) },
    actions: Array.from({ length: count }, (_, index) => ({ item_key: `ITEM${index}`, expected_version: version, title: 'Test', issns: [], decision: 'update', reason_codes: [], metric: { jcr_zone: 'Q1', source_sha256: 'b'.repeat(64) } })),
    summary: { selected: count, update: count, skip: 0 },
    ...(source ? { source } : {}),
  };
  value.plan_hash = canonicalMetricsPlanHash(value);
  return value;
}
function cloudContext(version: number) {
  return {
    web: { isCloud: true, getItem: vi.fn(async () => ({ version, data: { extra: 'Human note', tags: [] } })), patchItem: vi.fn(async () => version + 1) },
    router: { getItem: vi.fn(() => { throw new Error('Must not use the router for cloud version refresh'); }) },
  } as any;
}

describe('metrics plan cloud-version preflight', () => {
  it('refreshes 81 local-scale versions directly from cloud, with a new reviewable hash', async () => {
    const original = versionPlan(1200, 81);
    const ctx = cloudContext(41300);
    const result = await executeMetricsPlan(ctx, original, library, 'dry_run');
    expect(result).toMatchObject({ status: 'ready', original_plan_hash: original.plan_hash, version_refreshes: 81, conflicts: [], summary: { failed: 0, pending: 81 }, conflict_summary: { local_cloud_version_mismatch: 81, cloud_version_moved: 0 } });
    expect(result.plan_hash).not.toBe(original.plan_hash);
    expect(validateMetricsPlan(result.refreshed_plan).plan_hash).toBe(result.plan_hash);
    expect(result.refreshed_plan?.actions.every((a) => a.expected_version === 41300)).toBe(true);
    expect(result.refreshed_plan?.actions[0]?.metric?.source_sha256).toBe('b'.repeat(64));
    expect(original.actions[0]?.expected_version).toBe(1200);
    expect(ctx.web.getItem).toHaveBeenCalledTimes(81);
    expect(ctx.web.getItem).toHaveBeenCalledWith(library, 'ITEM0');
    expect(ctx.router.getItem).not.toHaveBeenCalled();
    expect(ctx.web.patchItem).not.toHaveBeenCalled();
  });

  it.each(['source', 'matching_mode'] as const)('honors explicit local %s even without a tenfold gap', async (field) => {
    const original = versionPlan(40);
    original[field] = 'local-api';
    original.plan_hash = canonicalMetricsPlanHash(original);
    const result = await executeMetricsPlan(cloudContext(41), original, library, 'dry_run');
    expect(result.status).toBe('ready');
    expect(result.refreshed_plan?.actions[0]?.expected_version).toBe(41);
    expect(result.refreshed_plan?.source).toBe('zotero-web-api');
    expect(result.plan_hash).not.toBe(original.plan_hash);
  });

  it('recognizes source local even if local and cloud version numbers happen to match', async () => {
    const original = versionPlan(40, 1, 'local');
    const result = await executeMetricsPlan(cloudContext(40), original, library, 'dry_run');
    expect(result.status).toBe('ready');
    expect(result.version_refreshes).toBe(1);
    expect(result.plan_hash).not.toBe(original.plan_hash);
  });

  it('distinguishes mixed scale refreshes and genuine cloud conflicts in one dry-run', async () => {
    const original = versionPlan(1200, 2);
    original.actions[1]!.expected_version = 41299;
    original.plan_hash = canonicalMetricsPlanHash(original);
    const result = await executeMetricsPlan(cloudContext(41300), original, library, 'dry_run');
    expect(result).toMatchObject({ status: 'blocked', conflicts: ['ITEM1'], conflict_summary: { local_cloud_version_mismatch: 1, cloud_version_moved: 1 } });
  });

  it('still detects cloud movement after a successful refresh dry-run', async () => {
    const ctx = cloudContext(41300);
    const dryRun = await executeMetricsPlan(ctx, versionPlan(1200), library, 'dry_run');
    ctx.web.getItem.mockResolvedValue({ version: 41301, data: { extra: '', tags: [] } });
    const receiptPath = join(await mkdtemp(join(tmpdir(), 'metrics-moved-')), 'receipt.json');
    const applied = await executeMetricsPlan(ctx, dryRun.refreshed_plan!, library, 'apply', receiptPath);
    expect(applied.conflict_summary.cloud_version_moved).toBe(1);
    expect(ctx.web.patchItem).not.toHaveBeenCalled();
  });

  it('does not apply a plan that needs refresh, even before the first item would otherwise match', async () => {
    const original = versionPlan(41300, 2);
    original.actions[1]!.expected_version = 1200;
    original.plan_hash = canonicalMetricsPlanHash(original);
    const ctx = cloudContext(41300);
    const result = await executeMetricsPlan(ctx, original, library, 'apply');
    expect(result.status).toBe('blocked');
    expect(result.message).toMatch(/old hash must not be used/);
    expect(ctx.web.patchItem).not.toHaveBeenCalled();
  });

  it('reports genuine cloud-version movement separately from scale refreshes', async () => {
    const result = await executeMetricsPlan(cloudContext(41301), versionPlan(41300), library, 'dry_run');
    expect(result).toMatchObject({ status: 'blocked', conflicts: ['ITEM0'], version_refreshes: 0, conflict_summary: { local_cloud_version_mismatch: 0, cloud_version_moved: 1 } });
  });

  it('keeps a real PATCH 412 as a conflict in both summary and saved receipt', async () => {
    const ctx = cloudContext(41300);
    ctx.web.patchItem.mockRejectedValue(new ZoteroApiError({ status: 412, message: 'Changed on cloud' }));
    const receiptPath = join(await mkdtemp(join(tmpdir(), 'metrics-412-')), 'receipt.json');
    const result = await executeMetricsPlan(ctx, versionPlan(41300), library, 'apply', receiptPath);
    expect(result).toMatchObject({ status: 'partial', conflicts: ['ITEM0'], conflict_summary: { local_cloud_version_mismatch: 0, cloud_version_moved: 1 } });
    expect(JSON.parse(await readFile(receiptPath, 'utf8')).results[0].error).toMatch(/cloud-version-moved.*412/);
  });

  it('refuses the actual desktop LocalWebClient without reading or writing it', async () => {
    const fetchImpl = vi.fn();
    const web = new LocalWebClient({ fetchImpl });
    await expect(executeMetricsPlan({ web } as any, versionPlan(1200), library, 'dry_run')).rejects.toThrow(/LocalWebClient versions are local API versions/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('binds optional version provenance into the plan hash', () => {
    const original = versionPlan(1200, 1, 'zotero-local-api');
    expect(validateMetricsPlan(original)).toBe(original);
    expect(() => validateMetricsPlan({ ...original, source: 'zotero-web-api' })).toThrow(/hash mismatch/);
  });
});

describe('metrics plan zone-only payloads', () => {
  it('accepts a CAS/JCR-only update without inventing an IF', () => {
    const plan: any = {
      schema_version: '1.0', plan_type: 'zotero-metrics', created_at: '2026-07-14T00:00:00Z', plan_hash: '',
      target: { library_type: 'user', library_id: 1 },
      metrics: { metrics_year: 2026, source_label: 'easyscholar-2026', source_sha256: 'a'.repeat(64) },
      actions: [{ item_key: 'ITEM0001', expected_version: 4, title: 'Paper', issns: [], decision: 'update', reason_codes: ['easyscholar-match'], metric: { jcr_zone: 'Q1', cas_zone: '1区', source_label: 'easyscholar-2026', source_sha256: 'a'.repeat(64) } }],
      summary: { selected: 1, update: 1, skip: 0 },
    };
    plan.plan_hash = canonicalMetricsPlanHash(plan);
    expect(validateMetricsPlan(plan).actions[0]?.metric).not.toHaveProperty('impact_factor');
  });

  it('accepts five-year IF and typed publication metrics', () => {
    const plan: any = {
      schema_version: '1.0', plan_type: 'zotero-metrics', created_at: '2026-07-16T00:00:00Z', plan_hash: '',
      target: { library_type: 'user', library_id: 1 },
      metrics: { metrics_year: 2025, remove_years: [2026], source_label: 'easyscholar-2025', source_sha256: 'a'.repeat(64) },
      actions: [{ item_key: 'ITEM0001', expected_version: 4, title: 'Paper', issns: [], decision: 'update', reason_codes: ['easyscholar-match'], metric: { impact_factor: 9.2, impact_factor_5y: 8.5, jcr_zone: 'Q1', cas_zone: '1区', publication_metrics: [{ code: 'cas_major', value: '医学1区' }, { code: 'cas_top', value: true }], retrieved_at: '2026-07-16', source_label: 'easyscholar-2025', source_sha256: 'a'.repeat(64) } }],
      summary: { selected: 1, update: 1, skip: 0 },
    };
    plan.plan_hash = canonicalMetricsPlanHash(plan);
    expect(validateMetricsPlan(plan).actions[0]?.metric).toMatchObject({ impact_factor_5y: 8.5, retrieved_at: '2026-07-16' });
  });

  it('rejects an update with no metric fields', () => {
    const plan: any = {
      schema_version: '1.0', plan_type: 'zotero-metrics', plan_hash: 'sha256:' + '0'.repeat(64),
      target: { library_type: 'user', library_id: 1 },
      metrics: { metrics_year: 2026, source_label: 'x', source_sha256: 'a'.repeat(64) },
      actions: [{ item_key: 'ITEM0001', expected_version: 1, title: 'Paper', issns: [], decision: 'update', reason_codes: [], metric: {} }],
      summary: { selected: 1, update: 1, skip: 0 },
    };
    expect(() => validateMetricsPlan(plan)).toThrow(/needs IF, zone, or publication metrics/);
  });
});
