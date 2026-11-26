import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { backfillMetrics } from '../../src/features/metrics-backfill.js';
import { validateMetricsPlan, type MetricsPlan } from '../../src/features/metrics-plan.js';
import { LocalWebClient } from '../../src/api/local-writer.js';
import backfillMetricsTool from '../../src/tools/backfill-metrics.js';

const library = { type: 'user' as const, id: 1 };
const FIXED_NOW = () => new Date('2026-11-26T00:00:00Z');

function item(key: string, version: number, data: Record<string, unknown>): any {
  return { key, version, data: { tags: [], ...data } };
}

const NATURE_A = item('AAAA0001', 41300, {
  itemType: 'journalArticle',
  title: 'Paper A',
  publicationTitle: 'Nature',
  ISSN: '0028-0836',
});
const NATURE_B = item('BBBB0002', 41301, {
  itemType: 'journalArticle',
  title: 'Paper B',
  publicationTitle: 'Nature',
  eISSN: '1476-4687',
});
const PREPRINT = item('CCCC0003', 41302, {
  itemType: 'preprint',
  title: 'Preprint on bioRxiv',
  publicationTitle: 'bioRxiv',
});
const BOOK = item('DDDD0004', 41303, { itemType: 'book', title: 'A Book' });

function easyscholarBody(journal: string, opts: { empty?: boolean } = {}): string {
  return JSON.stringify({
    code: 200,
    msg: 'success',
    data: opts.empty
      ? {}
      : {
          officialRank: { all: { sciif: '64.8', sci: 'Q1', sciUp: '综合性期刊1区', esi: 'Multidisciplinary' }, select: {} },
          customRank: { rankInfo: [{ uuid: 'uuid-1', abbName: 'JCR', oneRankText: 'Q1' }], rank: ['uuid-1&&&1'] },
          ...(journal ? {} : {}),
        },
  });
}

/** EasyScholar mock router: named journals answer; everything else 500s. */
function easyscholarFetch(journals: Record<string, { empty?: boolean }>): ReturnType<typeof vi.fn> {
  return vi.fn(async (url: string) => {
    const name = new URL(url).searchParams.get('publicationName') ?? '';
    if (name in journals) {
      return new Response(easyscholarBody(name, journals[name]!), { status: 200 });
    }
    return new Response('server exploded', { status: 500 });
  });
}

function cloudContext(items: any[]): any {
  const byKey = new Map(items.map((entry) => [entry.key, entry]));
  return {
    capabilities: { cloud: { userID: 1 } },
    web: {
      isCloud: true,
      canWrite: true,
      listItems: vi.fn(async () => ({ data: items, totalResults: items.length, lastModifiedVersion: 0 })),
      getItem: vi.fn(async (_lib: unknown, key: string) => {
        const found = byKey.get(key);
        if (!found) throw new Error(`no such item: ${key}`);
        return found;
      }),
      patchItem: vi.fn(async (_lib: unknown, _key: string, _patch: unknown, version: number) => version + 1),
    },
  };
}

async function workdir(): Promise<{ dir: string; cache: string; plan: string; receipt: string }> {
  const dir = await mkdtemp(join(tmpdir(), 'metrics-backfill-'));
  return { dir, cache: join(dir, 'easyscholar_cache.json'), plan: join(dir, 'plan.json'), receipt: join(dir, 'receipt.json') };
}

const baseDeps = (fetchImpl: ReturnType<typeof vi.fn>) => ({
  secretKey: 'test-key' as string | null,
  fetchImpl: fetchImpl as any,
  minIntervalMs: 0,
  retries: 0,
  now: FIXED_NOW,
});

describe('metrics backfill plan construction', () => {
  it('puts cloud versions into the plan and dry-runs without writing the library', async () => {
    const ctx = cloudContext([NATURE_A, NATURE_B, PREPRINT, BOOK]);
    const paths = await workdir();
    const fetchImpl = easyscholarFetch({ Nature: {} });
    const result = await backfillMetrics(
      ctx, library,
      { collection_key: 'COLL0001', mode: 'dry_run', plan_path: paths.plan, easyscholar_cache_path: paths.cache },
      baseDeps(fetchImpl),
    );
    expect(result).toMatchObject({
      mode: 'dry_run', status: 'ready', selected: 4, update: 2, skip: 2,
      skip_reasons: { preprint: 1, 'not-a-journal-article': 1 },
      metrics: { metrics_year: 2025, source_label: 'easyscholar-latest' },
      easyscholar: { key_configured: true, unique_journals: 1, api_calls: 1, matched: 1, unmatched: 0, fetch_errors: 0 },
    });
    expect(ctx.web.patchItem).not.toHaveBeenCalled();

    const saved = JSON.parse(await readFile(paths.plan, 'utf8')) as MetricsPlan;
    expect(validateMetricsPlan(saved)).toBe(saved);
    expect(saved.source).toBe('zotero-web-api');
    const updates = saved.actions.filter((action) => action.decision === 'update');
    expect(updates.map((action) => action.expected_version).sort()).toEqual([41300, 41301]);
    expect(updates.map((action) => action.issns).flat().sort()).toEqual(['00280836', '14764687']);
    expect(saved.actions.find((action) => action.item_key === 'CCCC0003')?.reason_codes).toEqual(['preprint']);
  });

  it('refuses the desktop LocalWebClient without reading or writing it', async () => {
    const fetchImpl = vi.fn();
    const web = new LocalWebClient({ fetchImpl });
    await expect(
      backfillMetrics({ web } as any, library, { collection_key: 'COLL0001', mode: 'dry_run' }, baseDeps(vi.fn())),
    ).rejects.toThrow(/LocalWebClient versions are local API versions/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe('metrics backfill apply gating', () => {
  it('requires receipt_path and a confirm_plan_hash matching the freshly rebuilt plan', async () => {
    const ctx = cloudContext([NATURE_A]);
    const paths = await workdir();
    const input = (patch: Record<string, unknown>) => ({
      collection_key: 'COLL0001', mode: 'apply', easyscholar_cache_path: paths.cache, ...patch,
    });
    await expect(backfillMetrics(ctx, library, input({}), baseDeps(easyscholarFetch({ Nature: {} })))).rejects.toThrow(/receipt_path/);
    await expect(
      backfillMetrics(ctx, library, input({ receipt_path: paths.receipt, confirm_plan_hash: 'sha256:' + '0'.repeat(64) }), baseDeps(easyscholarFetch({ Nature: {} }))),
    ).rejects.toThrow(/confirm_plan_hash does not match/);
    expect(ctx.web.patchItem).not.toHaveBeenCalled();
    expect(await readFile(paths.receipt).then(() => true, () => false)).toBe(false);
  });

  it('applies through executeMetricsPlan only with the exact dry-run hash', async () => {
    const ctx = cloudContext([NATURE_A, NATURE_B]);
    const paths = await workdir();
    const deps = baseDeps(easyscholarFetch({ Nature: {} }));
    const common = { collection_key: 'COLL0001', easyscholar_cache_path: paths.cache };
    const dryRun = await backfillMetrics(ctx, library, { ...common, mode: 'dry_run', plan_path: paths.plan }, deps);
    expect(dryRun.status).toBe('ready');
    // The apply rebuild hits the cache the dry run just wrote, so the plan hash is stable.
    const applied = await backfillMetrics(
      ctx, library,
      { ...common, mode: 'apply', confirm_plan_hash: dryRun.plan_hash, receipt_path: paths.receipt },
      deps,
    );
    expect(applied).toMatchObject({ status: 'complete', plan_hash: dryRun.plan_hash, receipt_path: paths.receipt });
    expect(ctx.web.patchItem).toHaveBeenCalledTimes(2);
    const patch = ctx.web.patchItem.mock.calls[0]![2] as { extra: string; tags: Array<{ tag: string }> };
    expect(patch.extra).toContain('AI4S-Metrics:');
    expect(patch.extra).toContain('"2025"');
    expect(patch.extra).toContain('"impact_factor":64.8');
    expect(patch.tags.map((tag) => tag.tag).sort()).toEqual(['CAS:1区', 'JCR:Q1']);
    const receipt = JSON.parse(await readFile(paths.receipt, 'utf8'));
    expect(receipt.plan_hash).toBe(dryRun.plan_hash);
    // The saved receipt keeps a second confirmed apply from re-writing items.
    await backfillMetrics(ctx, library, { ...common, mode: 'apply', confirm_plan_hash: dryRun.plan_hash, receipt_path: paths.receipt }, deps);
    expect(ctx.web.patchItem).toHaveBeenCalledTimes(2);
  });

  it('refuses apply when a cloud version moved since the dry run', async () => {
    const ctx = cloudContext([NATURE_A]);
    const paths = await workdir();
    const deps = baseDeps(easyscholarFetch({ Nature: {} }));
    const dryRun = await backfillMetrics(ctx, library, { collection_key: 'COLL0001', mode: 'dry_run', easyscholar_cache_path: paths.cache }, deps);
    // The cloud item moved after the dry run; the rebuilt plan (built from the item
    // list, not the earlier dry run) has a different hash, so apply is refused.
    const moved = item('AAAA0001', 41305, NATURE_A.data);
    ctx.web.listItems.mockImplementation(async () => ({ data: [moved], totalResults: 1, lastModifiedVersion: 0 }));
    await expect(
      backfillMetrics(ctx, library, { collection_key: 'COLL0001', mode: 'apply', confirm_plan_hash: dryRun.plan_hash, receipt_path: paths.receipt, easyscholar_cache_path: paths.cache }, deps),
    ).rejects.toThrow(/confirm_plan_hash does not match/);
    expect(ctx.web.patchItem).not.toHaveBeenCalled();
  });
});

describe('metrics backfill resilience', () => {
  it('counts EasyScholar misses and fetch failures per item instead of failing the batch', async () => {
    const emptyJournal = item('EEEE0005', 41304, { itemType: 'journalArticle', title: 'Paper E', publicationTitle: 'Empty Journal' });
    const brokenJournal = item('FFFF0006', 41305, { itemType: 'journalArticle', title: 'Paper F', publicationTitle: 'Broken Journal' });
    const ctx = cloudContext([NATURE_A, emptyJournal, brokenJournal]);
    const paths = await workdir();
    const result = await backfillMetrics(
      ctx, library,
      { collection_key: 'COLL0001', mode: 'dry_run', easyscholar_cache_path: paths.cache },
      baseDeps(easyscholarFetch({ Nature: {}, 'Empty Journal': { empty: true } })),
    );
    expect(result.status).toBe('ready');
    expect(result.update).toBe(1);
    expect(result.skip_reasons).toEqual({ 'no-easyscholar-data': 1, 'easyscholar-fetch-failed': 1 });
    expect(result.easyscholar).toMatchObject({ unique_journals: 3, api_calls: 3, fetch_errors: 1, matched: 1, unmatched: 2 });
    expect(ctx.web.patchItem).not.toHaveBeenCalled();
  });

  it('skips every journal item with a readable reason when no EasyScholar key is configured', async () => {
    const ctx = cloudContext([NATURE_A, NATURE_B]);
    const paths = await workdir();
    const fetchImpl = easyscholarFetch({ Nature: {} });
    const deps = { ...baseDeps(fetchImpl), secretKey: null as string | null };
    const result = await backfillMetrics(
      ctx, library,
      { collection_key: 'COLL0001', mode: 'dry_run', easyscholar_cache_path: paths.cache },
      deps,
    );
    expect(result.status).toBe('ready');
    expect(result.update).toBe(0);
    expect(result.skip_reasons).toEqual({ 'easyscholar-key-not-configured': 2 });
    expect(result.easyscholar.key_configured).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('skips unknown item keys in item_keys mode instead of aborting', async () => {
    const ctx = cloudContext([NATURE_A, NATURE_B]);
    const paths = await workdir();
    const result = await backfillMetrics(
      ctx, library,
      { item_keys: ['AAAA0001', 'BBBB0002', 'ZZZZ9999'], mode: 'dry_run', easyscholar_cache_path: paths.cache },
      baseDeps(easyscholarFetch({ Nature: {} })),
    );
    expect(result.selected).toBe(3);
    expect(result.update).toBe(2);
    expect(result.skip_reasons).toEqual({ 'item-fetch-failed': 1 });
  });
});

describe('zotero_backfill_metrics tool wrapper', () => {
  it('defaults to dry_run when mode is omitted and never writes', async () => {
    const ctx = cloudContext([NATURE_A]);
    const paths = await workdir();
    const result = await backfillMetricsTool.handler(
      { collection_key: 'COLL0001', easyscholar_cache_path: paths.cache },
      { ...ctx, capabilities: { cloud: { userID: 1 } } } as any,
    );
    const body = result.structuredContent as Record<string, unknown>;
    expect(body.mode).toBe('dry_run');
    expect(ctx.web.patchItem).not.toHaveBeenCalled();
    expect(result.content[0]!.text).toMatch(/Metrics backfill dry_run ready/);
  });

  it('rejects passing both a collection and item keys', async () => {
    const ctx = cloudContext([NATURE_A]);
    await expect(
      backfillMetricsTool.handler({ collection_key: 'COLL0001', item_keys: ['AAAA0001'] } as any, ctx as any),
    ).rejects.toThrow(/exactly one/);
  });
});
