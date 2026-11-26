import { mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import applyDedupePlan from '../../src/tools/apply-dedupe-plan.js';
import { ZoteroApiError } from '../../src/api/errors.js';

const reportPath = fileURLToPath(new URL('../fixtures/dedupe-report.json', import.meta.url));

interface FreshOverrides {
  version?: number;
  tags?: Array<{ tag: string }>;
  collections?: string[];
  relations?: Record<string, unknown>;
  numChildren?: number;
  title?: string;
  doi?: string;
  date?: string;
  creators?: Array<Record<string, unknown>>;
  publicationTitle?: string;
  pages?: string;
}

function freshItem(key: string, overrides: FreshOverrides = {}) {
  const data: Record<string, unknown> = {
    itemType: 'journalArticle',
    title: overrides.title ?? 'Duplicate paper',
    date: overrides.date ?? '2020-05-01',
    creators: overrides.creators ?? [{ creatorType: 'author', firstName: 'A', lastName: 'Author' }],
    DOI: overrides.doi ?? '10.1000/plan-dedupe',
    tags: overrides.tags ?? [{ tag: 'AI4S:Import' }],
    collections: overrides.collections ?? ['PLANCOL1'],
  };
  for (const field of ['publicationTitle', 'pages', 'relations'] as const)
    if (overrides[field]) data[field] = overrides[field];
  return {
    key,
    version: overrides.version ?? 3,
    data,
    meta: { numChildren: overrides.numChildren ?? 0 },
  };
}

function library() {
  const items = new Map<string, any>();
  const getItem = vi.fn(async (key: string) => {
    const item = items.get(key);
    if (!item) throw new ZoteroApiError({ status: 404, message: `No item ${key}` });
    return item;
  });
  const getItemChildren = vi.fn(async (key: string) => ({
    data:
      key === 'INSCO01'
        ? [{ key: 'ATCH0001', data: { itemType: 'attachment' } }]
        : [],
    totalResults: key === 'INSCO01' ? 1 : 0,
    lastModifiedVersion: 42,
  }));
  const searchItems = vi.fn();
  // Write/trash spies: the plan tool must never call any of these.
  const writes = {
    trashItems: vi.fn(),
    deleteItems: vi.fn(),
    updateItem: vi.fn(),
    createItems: vi.fn(),
    patchItem: vi.fn(),
    deleteItem: vi.fn(),
  };
  return {
    items,
    getItem,
    getItemChildren,
    searchItems,
    writes,
    router: {
      defaultLibrary: () => ({ type: 'user', id: 12345 }),
      getItem,
      getItemChildren,
      searchItems,
      ...writes,
    },
    async context() {
      return {
        config: { dataDir: await mkdtemp(join(tmpdir(), 'literature-zotero-mcp-')) },
        router: this.router,
      } as any;
    },
  };
}

/** The fixture library state the dry-run re-checks against. */
function seedFresh(lib: ReturnType<typeof library>) {
  lib.items.set(
    'INSCO01',
    freshItem('INSCO01', { version: 3, numChildren: 1, tags: [{ tag: 'AI4S:Import' }] }),
  );
  lib.items.set(
    'INSCO02',
    freshItem('INSCO02', {
      version: 3,
      tags: [
        { tag: 'AI4S:Import' },
        { tag: 'domain:cvd' },
      ],
    }),
  );
  // The outside master is deliberately the most complete record so the scan
  // recommends it and flags it outside the batch collection.
  lib.items.set(
    'OUTSID1',
    freshItem('OUTSID1', {
      version: 5,
      title: 'Outside master paper',
      collections: [],
      tags: [{ tag: 'domain:cvd' }],
      doi: '10.1000/plan-outside',
      date: '2019-03-01',
      creators: [{ creatorType: 'author', firstName: 'B', lastName: 'Writer' }],
      publicationTitle: 'Journal of Outside',
      pages: '1-9',
    }),
  );
  lib.items.set(
    'INSCO03',
    freshItem('INSCO03', {
      version: 2,
      title: 'Outside master paper',
      tags: [{ tag: 'AI4S:Import' }],
      doi: '10.1000/plan-outside',
      date: '2019-03-01',
      creators: [{ creatorType: 'author', firstName: 'B', lastName: 'Writer' }],
    }),
  );
}

function planOf(result: any): any {
  return result.structuredContent.plan;
}

describe('zotero_apply_dedupe_plan', () => {
  it('is explicitly read-only and never claims idempotence', () => {
    expect(applyDedupePlan.annotations?.readOnlyHint).toBe(true);
    expect(applyDedupePlan.annotations?.destructiveHint).toBe(false);
    expect(applyDedupePlan.annotations?.idempotentHint).toBe(false);
  });

  it('requires exactly one input source and a limit with collection_key', async () => {
    const lib = library();
    const ctx = await lib.context();
    expect((await applyDedupePlan.handler({}, ctx)).isError).toBe(true);
    expect(
      (await applyDedupePlan.handler({ report_path: reportPath, collection_key: 'PLANCOL1' }, ctx)).isError,
    ).toBe(true);
    expect(
      (await applyDedupePlan.handler({ report_path: reportPath, expected_plan_hash: 'sha256:x' }, ctx))
        .isError,
    ).toBe(true);
    expect((await applyDedupePlan.handler({ collection_key: 'PLANCOL1' }, ctx)).isError).toBe(true);
  });

  it('dry-runs a fixture report: plans both clusters, adds the add-to-collection step for the outside master, and writes nothing', async () => {
    const lib = library();
    seedFresh(lib);
    const ctx = await lib.context();
    const result = await applyDedupePlan.handler({ report_path: reportPath }, ctx);
    expect(result.isError).toBeUndefined();
    const structured = result.structuredContent as any;
    expect(structured.mode).toBe('dry_run');
    expect(structured.zotero_writes).toBe(false);
    expect(structured.needs_plugin).toBe(true);
    expect(structured.native_merge_required).toBe(true);
    expect(structured.plan_hash).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(structured.cluster_count).toBe(2);
    expect(structured.master_outside_scope_count).toBe(1);

    const plan = structured.plan;
    expect(plan.policy).toMatchObject({
      zotero_writes: false,
      needs_plugin: true,
      native_merge_required: true,
      merged_items_destination: 'trash',
      recoverable: true,
      permanent_delete: false,
    });

    const inside = plan.clusters.find((c: any) => c.cluster_id === 'duplicate-0001');
    expect(inside.master_key).toBe('INSCO01');
    expect(inside.merge_keys).toEqual(['INSCO02']);
    expect(inside.master_outside_scope).toBe(false);
    expect(inside.pre_steps).toEqual([]);
    expect(inside.keep.attachments.keys).toEqual(['ATCH0001']);
    expect(inside.keep.tags.union).toEqual(['AI4S:Import', 'domain:cvd']);
    expect(inside.keep.collections.union).toEqual(['PLANCOL1']);
    expect(inside.keep.relations.dc_replaces_after_merge).toEqual(['INSCO02']);
    expect(inside.trash).toMatchObject({
      keys: ['INSCO02'],
      destination: 'trash',
      recoverable: true,
      permanent_delete: false,
    });
    expect(inside.verification.scope_membership).toEqual([
      { key: 'INSCO01', in_batch_scope: true },
      { key: 'INSCO02', in_batch_scope: true },
    ]);

    const outside = plan.clusters.find((c: any) => c.cluster_id === 'duplicate-0002');
    expect(outside.master_key).toBe('OUTSID1');
    expect(outside.merge_keys).toEqual(['INSCO03']);
    expect(outside.master_outside_scope).toBe(true);
    expect(outside.pre_steps).toHaveLength(1);
    expect(outside.pre_steps[0]).toMatchObject({
      step: 'add_master_to_collection',
      item_key: 'OUTSID1',
      collection_key: 'PLANCOL1',
      already_satisfied: false,
    });
    expect(outside.keep.relations.dc_replaces_after_merge).toEqual(['INSCO03']);
    expect(outside.trash.keys).toEqual(['INSCO03']);
    expect(outside.verification.scope_membership).toEqual([
      { key: 'OUTSID1', in_batch_scope: false },
      { key: 'INSCO03', in_batch_scope: true },
    ]);

    // Read-only: children are only fetched for items that have any.
    expect(lib.getItemChildren).toHaveBeenCalledTimes(1);
    expect(lib.getItemChildren).toHaveBeenCalledWith('INSCO01', { library: undefined });
    // No library writes of any kind.
    for (const spy of Object.values(lib.writes)) expect(spy).not.toHaveBeenCalled();
    // Zero writes to disk: the data directory is untouched by a dry run.
    expect(await readdir(ctx.config.dataDir)).toEqual([]);
  });

  it('records version drift between the report and the live library instead of failing', async () => {
    const lib = library();
    seedFresh(lib);
    lib.items.set('INSCO02', freshItem('INSCO02', { version: 7 }));
    const ctx = await lib.context();
    const result = await applyDedupePlan.handler({ report_path: reportPath }, ctx);
    expect(result.isError).toBeUndefined();
    const inside = planOf(result).clusters.find((c: any) => c.cluster_id === 'duplicate-0001');
    expect(inside.verification.version_changes).toEqual([
      { key: 'INSCO02', report_version: 3, current_version: 7 },
    ]);
    expect(inside.item_versions).toContainEqual({ key: 'INSCO02', version: 7 });
  });

  it('errors when a report key no longer exists (stale report)', async () => {
    const lib = library();
    lib.items.set('INSCO01', freshItem('INSCO01', { version: 3, numChildren: 1 }));
    lib.items.set('INSCO02', freshItem('INSCO02'));
    lib.items.set('OUTSID1', freshItem('OUTSID1', { version: 5, collections: [] }));
    // INSCO03 is deliberately absent from the live library.
    const ctx = await lib.context();
    const result = await applyDedupePlan.handler({ report_path: reportPath }, ctx);
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/stale.*INSCO03/s);
  });

  it('errors on a missing report file', async () => {
    const lib = library();
    const ctx = await lib.context();
    const result = await applyDedupePlan.handler(
      { report_path: join(ctx.config.dataDir, 'no-such-report.json') },
      ctx,
    );
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/Duplicate report not found/);
  });

  it('errors on a report generated for a different library', async () => {
    const lib = library();
    seedFresh(lib);
    const ctx = await lib.context();
    const result = await applyDedupePlan.handler(
      { report_path: reportPath, library_id: 999, library_type: 'group' },
      ctx,
    );
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/generated for library/);
  });

  it('apply saves and validates the plan file only, and returns needs_plugin', async () => {
    const lib = library();
    seedFresh(lib);
    const ctx = await lib.context();
    const result = await applyDedupePlan.handler(
      { report_path: reportPath, mode: 'apply' },
      ctx,
    );
    expect(result.isError).toBeUndefined();
    const structured = result.structuredContent as any;
    expect(structured.status).toBe('needs_plugin');
    expect(structured.native_merge_required).toBe(true);
    expect(structured.zotero_writes).toBe(false);
    expect(structured.plan_hash).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(structured.plan_path).toMatch(/dedupe-plans[/\\]dedupe-plan-/);

    const saved = JSON.parse(await readFile(structured.plan_path, 'utf8'));
    expect(saved.plan_hash).toBe(structured.plan_hash);
    expect(saved.plan_id).toBe(structured.plan_id);
    expect(saved.clusters).toHaveLength(2);
    expect(await readdir(join(ctx.config.dataDir, 'dedupe-plans'))).toHaveLength(1);
    // No library writes.
    for (const spy of Object.values(lib.writes)) expect(spy).not.toHaveBeenCalled();
  });

  it('re-validates a saved plan by hash and rejects a mismatched expected hash', async () => {
    const lib = library();
    seedFresh(lib);
    const ctx = await lib.context();
    const applied = await applyDedupePlan.handler(
      { report_path: reportPath, mode: 'apply' },
      ctx,
    );
    const planPath = (applied.structuredContent as any).plan_path;
    const planHash = (applied.structuredContent as any).plan_hash;

    const wrong = await applyDedupePlan.handler(
      { plan_path: planPath, expected_plan_hash: 'sha256:' + '0'.repeat(64) },
      ctx,
    );
    expect(wrong.isError).toBe(true);
    expect(wrong.content[0].text).toMatch(/hash mismatch/);

    const again = await applyDedupePlan.handler({ plan_path: planPath, expected_plan_hash: planHash }, ctx);
    expect(again.isError).toBeUndefined();
    expect((again.structuredContent as any).plan_hash).toBe(planHash);
    expect((again.structuredContent as any).mode).toBe('dry_run');

    const applyAgain = await applyDedupePlan.handler(
      { plan_path: planPath, expected_plan_hash: planHash, mode: 'apply' },
      ctx,
    );
    expect(applyAgain.isError).toBeUndefined();
    expect((applyAgain.structuredContent as any).status).toBe('needs_plugin');
    // Re-validating an existing plan writes nothing new.
    expect(await readdir(join(ctx.config.dataDir, 'dedupe-plans'))).toHaveLength(1);
  });

  it('rejects a tampered plan file whose hash no longer matches its content', async () => {
    const lib = library();
    seedFresh(lib);
    const ctx = await lib.context();
    const applied = await applyDedupePlan.handler(
      { report_path: reportPath, mode: 'apply' },
      ctx,
    );
    const planPath = (applied.structuredContent as any).plan_path as string;
    const tamperedPath = join(ctx.config.dataDir, 'tampered-plan.json');
    const saved = JSON.parse(await readFile(planPath, 'utf8'));
    saved.clusters[0].merge_keys = ['SOMEONE1'];
    await writeFile(tamperedPath, `${JSON.stringify(saved, null, 2)}\n`, 'utf8');
    const result = await applyDedupePlan.handler({ plan_path: tamperedPath }, ctx);
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/hash mismatch/);
  });

  it('rejects a plan file whose items no longer exist', async () => {
    const lib = library();
    seedFresh(lib);
    const ctx = await lib.context();
    const applied = await applyDedupePlan.handler(
      { report_path: reportPath, mode: 'apply' },
      ctx,
    );
    const planPath = (applied.structuredContent as any).plan_path;
    lib.items.delete('INSCO03');
    const result = await applyDedupePlan.handler({ plan_path: planPath }, ctx);
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/stale.*INSCO03/s);
  });

  it('scans a collection first when no report is given, without writing a report file', async () => {
    const lib = library();
    seedFresh(lib);
    // The internal scan: the batch is the collection, the library adds the outside master.
    lib.searchItems.mockImplementation(async (query: any) => {
      if (query.collectionKey === 'PLANCOL1') {
        return {
          data: [lib.items.get('INSCO03')],
          totalResults: 1,
          lastModifiedVersion: 42,
          source: 'cloud',
        };
      }
      return {
        data: [...lib.items.values()],
        totalResults: lib.items.size,
        lastModifiedVersion: 42,
        source: 'cloud',
      };
    });
    const ctx = await lib.context();
    const result = await applyDedupePlan.handler({ collection_key: 'PLANCOL1', limit: 100 }, ctx);
    expect(result.isError).toBeUndefined();
    expect(lib.searchItems).toHaveBeenCalledWith(
      expect.objectContaining({ collectionKey: 'PLANCOL1', top: true }),
    );
    const structured = result.structuredContent as any;
    expect(structured.plan_hash).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(structured.master_outside_scope_count).toBe(1);
    const outside = structured.plan.clusters[0];
    expect(outside.pre_steps[0]).toMatchObject({
      step: 'add_master_to_collection',
      collection_key: 'PLANCOL1',
    });
    // A dry run with collection_key writes no duplicate report and no plan file.
    expect(await readdir(ctx.config.dataDir)).toEqual([]);
  });

  it('requires an explicit limit for the internal scan and surfaces scan errors', async () => {
    const lib = library();
    const ctx = await lib.context();
    expect((await applyDedupePlan.handler({ collection_key: 'PLANCOL1' }, ctx)).isError).toBe(true);
    lib.searchItems.mockImplementation(async () => {
      throw new Error('scan failed');
    });
    const result = await applyDedupePlan.handler({ collection_key: 'PLANCOL1', limit: 100 }, ctx);
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/scan failed/);
  });
});
