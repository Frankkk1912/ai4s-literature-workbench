import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { findDuplicateClusters, vocabularyEntryUnused } from '../../src/features/tags/duplicates.js';
import { applyTagPlan, listUnusedTags, planTagChanges } from '../../src/features/tags/manager.js';
import { emptyVocabulary, saveVocabulary, vocabularyPath, loadVocabulary } from '../../src/features/semantic-tags/vocabulary.js';
import type { SemanticVocabulary, VocabularyEntry } from '../../src/features/semantic-tags/contract.js';
import tagManager from '../../src/tools/tag-manager.js';

const library = { type: 'user' as const, id: 1 };

function entry(partial: Partial<VocabularyEntry> & Pick<VocabularyEntry, 'id' | 'canonical' | 'dimension'>): VocabularyEntry {
  return {
    aliases: [], description: 'A reusable scientific concept', usage_count: 0, collection_keys: [],
    created_at: '2026-07-17T00:00:00.000Z', updated_at: '2026-07-17T00:00:00.000Z', ...partial,
  };
}

function vocabulary(tags: VocabularyEntry[], revision = 1): SemanticVocabulary {
  const base = emptyVocabulary(library);
  return { ...base, revision, updated_at: '2026-07-17T00:00:00.000Z', tags };
}

function clusterWith(scan: { clusters: Array<{ members: Array<{ name: string }>; reasons: string[] }> }, name: string) {
  return scan.clusters.find((cluster) => cluster.members.some((member) => member.name === name));
}

describe('duplicate tag scan', () => {
  const graph = entry({
    id: 'semantic:graph-neural-network-aaaaaaaa', canonical: 'Graph Neural Network', dimension: 'method',
    aliases: ['GNN'], usage_count: 2,
  });
  const cells = entry({
    id: 'semantic:t-cell-bbbbbbbb', canonical: 'T cell', dimension: 'entity', aliases: [], usage_count: 1,
  });

  it('clusters case, punctuation, plural, label, and vocabulary-alias duplicates with usage counts', () => {
    const scan = findDuplicateClusters([
      { name: 'Macrophage', numItems: 4, auto: false },
      { name: 'macrophage', numItems: 1, auto: true },
      { name: 'single-cell', numItems: 3, auto: false },
      { name: 'single cell', numItems: 2, auto: false },
      { name: 'T cells', numItems: 5, auto: false },
      { name: 'AI4S:Semantic:T cell', numItems: 1, auto: false },
      { name: 'AI4S:Semantic:Graph Neural Network', numItems: 2, auto: false },
      { name: 'GNN', numItems: 6, auto: false },
      { name: 'well-known', numItems: 1, auto: false },
      { name: 'well–known', numItems: 1, auto: false },
      { name: 'JCR:Q1', numItems: 3, auto: false },
      { name: 'jcr:q1', numItems: 1, auto: false },
      { name: 'Q1', numItems: 1, auto: false },
      { name: 'AI4S:Priority:1', numItems: 2, auto: false },
      { name: 'RNA-seq', numItems: 2, auto: false },
      { name: 'AI4S:Semantic:RNA-seq', numItems: 1, auto: false },
      { name: 'my-topic', numItems: 8, auto: false },
    ], vocabulary([graph, cells]));

    const macrophage = clusterWith(scan, 'Macrophage')!;
    expect(macrophage.reasons).toContain('case');
    expect(macrophage.members.map((member) => member.num_items)).toEqual(expect.arrayContaining([4, 1]));

    const single = clusterWith(scan, 'single-cell')!;
    expect(single.reasons).toContain('punctuation');
    expect(single.reasons).not.toContain('case');

    const tCell = clusterWith(scan, 'T cells')!;
    expect(tCell.reasons).toContain('plural');
    expect(tCell.suggested_winner).toBe('AI4S:Semantic:T cell');
    expect(tCell.members.find((member) => member.name === 'T cells')?.num_items).toBe(5);

    const gnn = clusterWith(scan, 'GNN')!;
    expect(gnn.reasons).toContain('alias');
    expect(gnn.suggested_winner).toBe('AI4S:Semantic:Graph Neural Network');
    expect(gnn.library_use_count).toBe(8);

    expect(clusterWith(scan, 'well-known')?.reasons).toContain('case');
    const jcr = clusterWith(scan, 'JCR:Q1')!;
    expect(jcr.reasons).toContain('case');
    expect(jcr.protected).toBe(true);
    expect(jcr.members.map((member) => member.name).sort()).toEqual(['JCR:Q1', 'jcr:q1']);
    expect(jcr.members.map((member) => member.name)).not.toContain('Q1');
    expect(clusterWith(scan, 'AI4S:Priority:1')).toBeUndefined();
    expect(clusterWith(scan, 'my-topic')).toBeUndefined();
    const rna = clusterWith(scan, 'RNA-seq')!;
    expect(rna.reasons).toContain('label');
    expect(rna.members.map((member) => member.name).sort()).toEqual(['AI4S:Semantic:RNA-seq', 'RNA-seq']);
    expect(scan.near_matches).toEqual([]);
  });

  it('suggests token-overlap pairs only when near matches are requested', () => {
    const tags = [
      { name: 'neural network', numItems: 2, auto: false },
      { name: 'graph neural network', numItems: 3, auto: false },
    ];
    expect(findDuplicateClusters(tags, vocabulary([]), { includeNear: false }).near_matches).toEqual([]);
    const near = findDuplicateClusters(tags, vocabulary([]), { includeNear: true }).near_matches;
    expect(near).toHaveLength(1);
    expect(near[0]).toMatchObject({ needs_judgment: true, shared_tokens: ['network', 'neural'] });
    expect(near[0]!.score).toBeGreaterThanOrEqual(0.5);
  });

  it('flags vocabulary entries that differ only by plural, and ignores one canonical plus its own alias', () => {
    const plural = entry({
      id: 'semantic:graph-neural-networks-cccccccc', canonical: 'Graph Neural Networks', dimension: 'method', usage_count: 1,
    });
    const scan = findDuplicateClusters([], vocabulary([graph, plural]));
    const cluster = clusterWith(scan, 'AI4S:Semantic:Graph Neural Network');
    expect(cluster?.reasons).toContain('plural');
    expect(cluster?.members.map((member) => member.name).sort()).toEqual([
      'AI4S:Semantic:Graph Neural Network', 'AI4S:Semantic:Graph Neural Networks',
    ]);
    const alone = findDuplicateClusters(
      [{ name: 'AI4S:Semantic:Graph Neural Network', numItems: 2, auto: false }],
      vocabulary([graph]),
    );
    expect(alone.clusters).toEqual([]);
  });
});

describe('tag manager plan and apply', () => {
  async function setup(options: {
    tags: Array<{ name: string; numItems?: number; auto?: boolean }>;
    items: any[];
    vocab?: VocabularyEntry[];
    revision?: number;
  }) {
    const dataDir = await mkdtemp(join(tmpdir(), 'tag-manager-'));
    if (options.vocab) {
      await saveVocabulary(vocabularyPath(dataDir, library), vocabulary(options.vocab, options.revision ?? 1));
    }
    const items = options.items;
    const ctx = {
      config: { dataDir },
      router: {
        defaultLibrary: () => library,
        searchItems: vi.fn(async ({ tag, limit }: { tag?: string; limit?: number }) => {
          const matched = items.filter((item) => (item.data.tags ?? []).some((entry: any) => (entry.tag ?? entry) === tag));
          return { data: matched.slice(0, limit ?? matched.length), totalResults: matched.length, lastModifiedVersion: 1 };
        }),
      },
      web: {
        canWrite: true,
        listTags: vi.fn(async (_lib: unknown, query?: { start?: number; limit?: number }) => {
          const start = query?.start ?? 0;
          const slice = options.tags.slice(start, start + (query?.limit ?? 100));
          return {
            data: slice.map((tag) => ({ tag: tag.name, meta: { numItems: tag.numItems, ...(tag.auto ? { type: 1 } : {}) } })),
            totalResults: options.tags.length, lastModifiedVersion: 1,
          };
        }),
        getItem: vi.fn(async (_lib: unknown, key: string) => structuredClone(items.find((item) => item.key === key))),
        patchItem: vi.fn(async () => 9),
      },
    } as any;
    return { dataDir, ctx, items };
  }

  const graph = entry({
    id: 'semantic:graph-neural-network-aaaaaaaa', canonical: 'Graph Neural Network', dimension: 'method',
    aliases: ['GNN'], usage_count: 1, description: 'Networks of learned message passing',
  });

  it('merges a library tag into the semantic canonical, preserves untargeted tags, and folds the alias', async () => {
    const { ctx } = await setup({
      revision: 3,
      vocab: [graph],
      tags: [
        { name: 'AI4S:Semantic:Graph Neural Network', numItems: 1 },
        { name: 'GNNs', numItems: 2 },
        { name: 'my-topic', numItems: 1 },
        { name: 'AI4S:Priority:1', numItems: 1 },
        { name: 'AI4S:ArticleType:Review', numItems: 1 },
        { name: 'JCR:Q1', numItems: 1 },
        { name: 'CAS:1', numItems: 1 },
        { name: 'keyword', numItems: 1, auto: true },
      ],
      items: [
        { key: 'ITEM0001', version: 4, data: { itemType: 'journalArticle', title: 'Both', tags: [
          { tag: 'my-topic' }, { tag: 'AI4S:Priority:1' }, { tag: 'AI4S:ArticleType:Review' },
          { tag: 'JCR:Q1' }, { tag: 'CAS:1' }, { tag: 'AI4S:Semantic:Other' },
          { tag: 'keyword', type: 1 }, { tag: 'GNNs' }, { tag: 'AI4S:Semantic:Graph Neural Network' },
        ] } },
        { key: 'ITEM0002', version: 2, data: { itemType: 'journalArticle', title: 'Alias only', tags: [
          { tag: 'my-topic' }, { tag: 'GNNs' },
        ] } },
      ],
    });
    const planned = await planTagChanges(ctx, library, {
      expectedRevision: 3, operations: [{ op: 'merge', loser: 'GNNs', winner: 'AI4S:Semantic:Graph Neural Network' }],
    });
    expect(planned.item_count).toBe(2);
    const dry = await applyTagPlan(ctx, library, { planPath: String(planned.plan_path), mode: 'dry_run' });
    expect(dry.status).toBe('dry_run');
    expect(ctx.web.patchItem).not.toHaveBeenCalled();

    const applied = await applyTagPlan(ctx, library, {
      planPath: String(planned.plan_path), mode: 'apply', confirmPlanHash: String(planned.plan_hash),
    });
    expect(applied.status).toBe('complete');
    const first = ctx.web.patchItem.mock.calls.find((call: any[]) => call[1] === 'ITEM0001');
    expect(first[2].tags).toEqual([
      { tag: 'my-topic' }, { tag: 'AI4S:Priority:1' }, { tag: 'AI4S:ArticleType:Review' },
      { tag: 'JCR:Q1' }, { tag: 'CAS:1' }, { tag: 'AI4S:Semantic:Other' },
      { tag: 'keyword', type: 1 }, { tag: 'AI4S:Semantic:Graph Neural Network' },
    ]);
    const second = ctx.web.patchItem.mock.calls.find((call: any[]) => call[1] === 'ITEM0002');
    expect(second[2].tags).toEqual([{ tag: 'my-topic' }, { tag: 'AI4S:Semantic:Graph Neural Network' }]);
    const saved = await loadVocabulary(ctx.config.dataDir, library);
    expect(saved.revision).toBe(4);
    expect(saved.tags).toHaveLength(1);
    expect(saved.tags[0]).toMatchObject({ canonical: 'Graph Neural Network', aliases: ['GNN', 'GNNs'], usage_count: 2 });
    const receipt = JSON.parse(await readFile(String(applied.receipt_path), 'utf8'));
    expect(receipt.plan_hash).toBe(planned.plan_hash);
    expect(receipt.summary.updated).toBe(2);
  });

  it('folds two vocabulary entries and refuses a dimension conflict before any write', async () => {
    const macrophages = entry({
      id: 'semantic:macrophages-dddddddd', canonical: 'Macrophages', dimension: 'entity', usage_count: 1,
      description: 'Plural form that should be an alias',
    });
    const macrophage = entry({
      id: 'semantic:macrophage-eeeeeeee', canonical: 'Macrophage', dimension: 'entity', usage_count: 2,
      description: 'Macrophages as the principal study subject',
    });
    const { ctx } = await setup({
      vocab: [macrophage, macrophages],
      tags: [
        { name: 'AI4S:Semantic:Macrophage', numItems: 1 },
        { name: 'AI4S:Semantic:Macrophages', numItems: 1 },
      ],
      items: [{ key: 'ITEM0001', version: 1, data: { title: 'A', tags: [{ tag: 'AI4S:Semantic:Macrophages' }, { tag: 'keep-me' }] } }],
    });
    const planned = await planTagChanges(ctx, library, {
      expectedRevision: 1,
      operations: [{ op: 'merge', loser: 'AI4S:Semantic:Macrophages', winner: 'AI4S:Semantic:Macrophage' }],
    });
    await applyTagPlan(ctx, library, { planPath: String(planned.plan_path), mode: 'apply', confirmPlanHash: String(planned.plan_hash) });
    const saved = await loadVocabulary(ctx.config.dataDir, library);
    expect(saved.tags.map((tag) => tag.id)).toEqual(['semantic:macrophage-eeeeeeee']);
    expect(saved.tags[0]!.aliases).toContain('Macrophages');
    expect(ctx.web.patchItem.mock.calls[0][2].tags).toEqual([
      { tag: 'keep-me' }, { tag: 'AI4S:Semantic:Macrophage' },
    ]);

    const conflicted = entry({ ...macrophages, dimension: 'method' });
    const again = await setup({
      vocab: [macrophage, conflicted],
      tags: [{ name: 'AI4S:Semantic:Macrophages', numItems: 1 }],
      items: [{ key: 'ITEM0009', version: 1, data: { title: 'B', tags: [{ tag: 'AI4S:Semantic:Macrophages' }] } }],
    });
    await expect(planTagChanges(again.ctx, library, {
      expectedRevision: 1,
      operations: [{ op: 'merge', loser: 'AI4S:Semantic:Macrophages', winner: 'AI4S:Semantic:Macrophage' }],
    })).rejects.toThrow(/dimensions differ/);
    expect(again.ctx.web.patchItem).not.toHaveBeenCalled();
  });

  it('renames a canonical and keeps the old label as an alias', async () => {
    const term = entry({
      id: 'semantic:scrna-ffffffff', canonical: 'Single-cell RNA sequencing', dimension: 'method', usage_count: 1,
      description: 'Transcriptome profiling of individual cells',
    });
    const { ctx } = await setup({
      vocab: [term],
      tags: [{ name: 'AI4S:Semantic:Single-cell RNA sequencing', numItems: 1 }],
      items: [{ key: 'ITEM0001', version: 3, data: { title: 'C', tags: [
        { tag: 'AI4S:Semantic:Single-cell RNA sequencing' }, { tag: 'user:keep' },
      ] } }],
    });
    const planned = await planTagChanges(ctx, library, {
      expectedRevision: 1,
      operations: [{ op: 'rename', from: 'AI4S:Semantic:Single-cell RNA sequencing', to: 'AI4S:Semantic:Single-cell transcriptomics' }],
    });
    await applyTagPlan(ctx, library, { planPath: String(planned.plan_path), mode: 'apply', confirmPlanHash: String(planned.plan_hash) });
    const saved = await loadVocabulary(ctx.config.dataDir, library);
    expect(saved.tags[0]).toMatchObject({
      id: 'semantic:scrna-ffffffff', canonical: 'Single-cell transcriptomics', usage_count: 1,
    });
    expect(saved.tags[0]!.aliases).toContain('Single-cell RNA sequencing');
    expect(ctx.web.patchItem.mock.calls[0][2].tags).toEqual([
      { tag: 'user:keep' }, { tag: 'AI4S:Semantic:Single-cell transcriptomics' },
    ]);
  });

  it('retags a non-English user tag without storing it as an alias', async () => {
    const { ctx } = await setup({
      vocab: [entry({
        id: 'semantic:macrophage-eeeeeeee', canonical: 'Macrophage', dimension: 'entity', usage_count: 0,
        description: 'Macrophages as the principal study subject',
      })],
      tags: [{ name: '巨噬细胞', numItems: 1 }, { name: 'AI4S:Semantic:Macrophage', numItems: 0 }],
      items: [{ key: 'ITEM0001', version: 1, data: { title: 'D', tags: [{ tag: '巨噬细胞' }, { tag: 'notes' }] } }],
    });
    const planned = await planTagChanges(ctx, library, {
      expectedRevision: 1,
      operations: [{ op: 'merge', loser: '巨噬细胞', winner: 'AI4S:Semantic:Macrophage' }],
    });
    expect(planned.vocabulary_changes).toMatchObject({
      alias_skipped: [{ tag: '巨噬细胞', reason: 'not an English alias' }],
    });
    await applyTagPlan(ctx, library, { planPath: String(planned.plan_path), mode: 'apply', confirmPlanHash: String(planned.plan_hash) });
    expect(ctx.web.patchItem.mock.calls[0][2].tags).toEqual([{ tag: 'notes' }, { tag: 'AI4S:Semantic:Macrophage' }]);
    expect((await loadVocabulary(ctx.config.dataDir, library)).tags[0]!.aliases).toEqual([]);
  });

  it('merges two user tags that are outside the vocabulary and leaves the revision unchanged', async () => {
    const { ctx } = await setup({
      revision: 2,
      vocab: [graph],
      tags: [{ name: 'to-read', numItems: 1 }, { name: 'To Read', numItems: 1 }],
      items: [{ key: 'ITEM0001', version: 1, data: { title: 'E', tags: [{ tag: 'to-read' }, { tag: 'project:keep' }] } }],
    });
    const planned = await planTagChanges(ctx, library, {
      expectedRevision: 2, operations: [{ op: 'merge', loser: 'to-read', winner: 'To Read' }],
    });
    expect(planned.vocabulary_revision_after).toBe(2);
    await applyTagPlan(ctx, library, { planPath: String(planned.plan_path), mode: 'apply', confirmPlanHash: String(planned.plan_hash) });
    expect(ctx.web.patchItem.mock.calls[0][2].tags).toEqual([{ tag: 'project:keep' }, { tag: 'To Read' }]);
    expect((await loadVocabulary(ctx.config.dataDir, library)).revision).toBe(2);
  });

  it('refuses protected tags, in-use deletes, stale revisions, and stale item versions before writing', async () => {
    const { ctx, items } = await setup({
      vocab: [graph],
      tags: [
        { name: 'JCR:Q1', numItems: 0 },
        { name: 'jcr:q1', numItems: 0 },
        { name: 'stale', numItems: 0 },
        { name: 'used', numItems: 2 },
        { name: 'GNNs', numItems: 1 },
      ],
      items: [{ key: 'ITEM0001', version: 4, data: { title: 'F', tags: [{ tag: 'GNNs' }, { tag: 'used' }] } }],
    });
    await expect(planTagChanges(ctx, library, {
      expectedRevision: 1, operations: [{ op: 'delete_unused', tags: ['JCR:Q1'] }],
    })).rejects.toThrow(/protected tags/);
    await expect(planTagChanges(ctx, library, {
      expectedRevision: 1, operations: [{ op: 'delete_unused', tags: ['used'] }],
    })).rejects.toThrow(/still on items/);
    await expect(planTagChanges(ctx, library, {
      expectedRevision: 0, operations: [{ op: 'merge', loser: 'GNNs', winner: 'AI4S:Semantic:Graph Neural Network' }],
    })).rejects.toThrow(/revision changed/);
    await expect(planTagChanges(ctx, library, {
      expectedRevision: 1, operations: [{ op: 'rename', from: 'AI4S:Semantic:Graph Neural Network', to: 'plain notes' }],
    })).rejects.toThrow(/non-semantic/);
    const protectedPlan = await planTagChanges(ctx, library, {
      expectedRevision: 1, allowProtected: true,
      operations: [{ op: 'merge', loser: 'jcr:q1', winner: 'JCR:Q1' }],
    });
    expect(protectedPlan.protected_targets).toEqual(expect.arrayContaining(['jcr:q1', 'JCR:Q1']));
    expect(ctx.web.patchItem).not.toHaveBeenCalled();

    const planned = await planTagChanges(ctx, library, {
      expectedRevision: 1, operations: [{ op: 'merge', loser: 'GNNs', winner: 'AI4S:Semantic:Graph Neural Network' }],
    });
    items[0].version = 8;
    await expect(applyTagPlan(ctx, library, {
      planPath: String(planned.plan_path), mode: 'apply', confirmPlanHash: String(planned.plan_hash),
    })).rejects.toThrow(/no writes were attempted/);
    expect(ctx.web.patchItem).not.toHaveBeenCalled();
    await expect(applyTagPlan(ctx, library, {
      planPath: String(planned.plan_path), mode: 'apply', confirmPlanHash: `sha256:${'ab'.repeat(32)}`,
    })).rejects.toThrow(/confirm_plan_hash/);
  });

  it('deletes an unused semantic entry and records a zero-item user tag without touching other tags', async () => {
    const obsolete = entry({
      id: 'semantic:obsolete-99999999', canonical: 'Obsolete concept', dimension: 'topic', usage_count: 0,
      description: 'No longer used',
    });
    const kept = entry({
      id: 'semantic:kept-88888888', canonical: 'Kept', dimension: 'topic', aliases: ['K'], usage_count: 1,
      description: 'Still used through an alias',
    });
    const { ctx } = await setup({
      vocab: [obsolete, kept],
      tags: [
        { name: 'stale', numItems: 0 },
        { name: 'K', numItems: 2 },
        { name: 'keep-me', numItems: 1 },
        { name: 'JCR:Q1', numItems: 0 },
      ],
      items: [{ key: 'ITEM0001', version: 1, data: { title: 'G', tags: [{ tag: 'keep-me' }, { tag: 'K' }] } }],
    });
    const unused = await listUnusedTags(ctx, library);
    expect(unused.library_tags).toEqual([{ name: 'stale', num_items: 0, auto: false, protected: false }]);
    expect(unused.vocabulary_entries).toMatchObject([{ id: 'semantic:obsolete-99999999' }]);
    expect(vocabularyEntryUnused(kept, [{ name: 'K', numItems: 2, auto: false }])).toBe(false);

    const planned = await planTagChanges(ctx, library, {
      expectedRevision: 1,
      operations: [{ op: 'delete_unused', tags: ['stale', 'AI4S:Semantic:Obsolete concept'] }],
    });
    const applied = await applyTagPlan(ctx, library, {
      planPath: String(planned.plan_path), mode: 'apply', confirmPlanHash: String(planned.plan_hash),
    });
    expect(applied.status).toBe('complete');
    expect(ctx.web.patchItem).not.toHaveBeenCalled();
    const saved = await loadVocabulary(ctx.config.dataDir, library);
    expect(saved.tags.map((tag) => tag.canonical)).toEqual(['Kept']);
    expect(saved.revision).toBe(2);
  });

  it('stops after a failed item patch and does not save the vocabulary', async () => {
    const { ctx } = await setup({
      vocab: [graph],
      tags: [{ name: 'GNNs', numItems: 2 }],
      items: [
        { key: 'ITEM0001', version: 1, data: { title: 'H', tags: [{ tag: 'GNNs' }] } },
        { key: 'ITEM0002', version: 1, data: { title: 'I', tags: [{ tag: 'GNNs' }] } },
      ],
    });
    ctx.web.patchItem = vi.fn(async (_lib: unknown, key: string) => {
      if (key === 'ITEM0002') throw new Error('412 precondition failed');
      return 5;
    });
    const planned = await planTagChanges(ctx, library, {
      expectedRevision: 1, operations: [{ op: 'merge', loser: 'GNNs', winner: 'AI4S:Semantic:Graph Neural Network' }],
    });
    const applied = await applyTagPlan(ctx, library, {
      planPath: String(planned.plan_path), mode: 'apply', confirmPlanHash: String(planned.plan_hash),
    });
    expect(applied.status).toBe('partial');
    expect((await loadVocabulary(ctx.config.dataDir, library)).revision).toBe(1);
    expect((await loadVocabulary(ctx.config.dataDir, library)).tags[0]!.aliases).toEqual(['GNN']);
  });

  it('exposes scan through the tool and requires a revision before planning', async () => {
    const { ctx } = await setup({
      tags: [{ name: 'Macrophage', numItems: 1 }, { name: 'macrophage', numItems: 1 }],
      items: [],
    });
    const scanned = await tagManager.handler({ action: 'scan' }, ctx);
    expect(JSON.stringify(scanned.structuredContent)).toContain('Macrophage');
    const refused = tagManager.handler({ action: 'plan', operations: [{ op: 'merge', loser: 'macrophage', winner: 'Macrophage' }] }, ctx);
    await expect(refused).rejects.toThrow(/expected_revision/);
  });
});
