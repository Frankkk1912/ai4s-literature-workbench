import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { renderReportMarkdown } from '../../src/features/project-sync/report-renderer.js';
import { projectStatePath, readProjectState } from '../../src/features/project-sync/state.js';
import { stableEvidenceId, syncLiteratureProject } from '../../src/features/project-sync/sync.js';

function dataOf(value: any): any { return value?.data ?? value; }
class FakeWeb {
  hasKey = true; collections: any[] = []; items: any[] = []; version = 1; next = 1;
  listQueries: any[] = [];
  hideBibliography = false;
  patchedKeys: string[] = [];
  private key(): string { return `K${String(this.next++).padStart(7, '0')}`; }
  async listCollections(_lib: any, query: any = {}) {
    const start = query.start ?? 0; const data = this.collections.slice(start, start + (query.limit ?? 100));
    return { data, totalResults: this.collections.length, lastModifiedVersion: this.version };
  }
  async listItems(_lib: any, query: any = {}) {
    this.listQueries.push(structuredClone(query));
    let found = this.items.filter((item) => !this.hideBibliography || dataOf(item).itemType === 'note');
    if (query.collectionKey) found = found.filter((item) => (dataOf(item).collections ?? []).includes(query.collectionKey));
    if (query.itemType) found = found.filter((item) => dataOf(item).itemType === query.itemType);
    if (query.top) found = found.filter((item) => !dataOf(item).parentItem);
    if (!query.includeTrashed) found = found.filter((item) => !dataOf(item).deleted);
    if (query.q) {
      const needle = String(query.q).toLowerCase();
      found = found.filter((item) => {
        const data = dataOf(item);
        return `${data.title ?? ''} ${JSON.stringify(data.creators ?? [])}`.toLowerCase().includes(needle);
      });
    }
    const start = query.start ?? 0; const data = found.slice(start, start + (query.limit ?? 100));
    return { data, totalResults: found.length, lastModifiedVersion: this.version };
  }
  async getItem(_lib: any, key: string) {
    const item = this.items.find((candidate) => candidate.key === key); if (!item) throw Object.assign(new Error('not found'), { status: 404 }); return structuredClone(item);
  }
  async writeCollections(_lib: any, objects: any[]) {
    const successful = objects.map((object, index) => { const key = this.key(); const version = ++this.version; this.collections.push({ key, version, data: { ...object, key, version } }); return { index, key, version }; });
    return { successful, unchanged: [], failed: [], newLibraryVersion: this.version };
  }
  async writeItems(_lib: any, objects: any[]) {
    const successful = objects.map((object, index) => { const key = this.key(); const version = ++this.version; this.items.push({ key, version, data: { ...structuredClone(object), key, version } }); return { index, key, version }; });
    return { successful, unchanged: [], failed: [], newLibraryVersion: this.version };
  }
  async patchItem(_lib: any, key: string, patch: any, _version: number) {
    this.patchedKeys.push(key);
    const item = this.items.find((candidate) => candidate.key === key); if (!item) throw new Error('not found');
    item.version = ++this.version; item.data = { ...item.data, ...structuredClone(patch), version: item.version }; return item.version;
  }
}
async function fixture(records: any[]) {
  const dir = await mkdtemp(join(tmpdir(), 'project-sync-')); const reportPath = join(dir, 'report.md'); const evidencePath = join(dir, 'ranked_all.json');
  await writeFile(reportPath, '# Literature Report\n\n## Answer\nEvidence-based answer.\n', 'utf8');
  await writeFile(evidencePath, JSON.stringify({ records }), 'utf8'); return { dir, reportPath, evidencePath };
}
function context(dataDir: string, web: FakeWeb): any { return { config: { dataDir }, web, schema: { validateItem: async () => ({ valid: true, errors: [] }) } }; }
const record = { source: 'pubmed', id: '123', title: 'A stable-ID study', doi: '10.1000/test.1', pmid: '12345678', authors: ['Smith J'], journal: 'Test Journal', date: '2025', article_types: ['Journal Article'] };

describe('project sync', () => {
  it('imports a search record as the project Note', async () => {
    const files = await fixture([record]);
    const searchRecord = [
      '# Literature search record',
      '',
      '## Question',
      'EXAMPLE-GENE in heart failure',
      '',
      '## Selected papers',
      '| Rank | Title | Journal | Year | PMID | DOI | Priority |',
      '| --- | --- | --- | --- | --- | --- | --- |',
      '| 1 | A stable-ID study | Test Journal | 2025 | 12345678 | 10.1000/test.1 | 1 |',
      '',
      '## Limitations',
      'Capped search, abstract-level.',
      '',
    ].join('\n');
    await writeFile(files.reportPath, searchRecord, 'utf8');
    const web = new FakeWeb();
    const result = await syncLiteratureProject(context(files.dir, web), { type: 'user', id: 1 }, {
      projectSlug: 'search-record', collectionName: 'Search Record', searchDate: '2026-11-19',
      reportPath: files.reportPath, evidencePath: files.evidencePath,
    });
    expect(result).toMatchObject({ status: 'complete', created: 1, report: 'created' });
    const note = dataOf(web.items.find((item) => dataOf(item).itemType === 'note')).note as string;
    expect(note).toContain('EXAMPLE-GENE in heart failure');
    expect(note).toContain('<table>');
    expect(note).toContain('A stable-ID study');
    expect(note).toContain('Capped search, abstract-level.');
    expect(note).not.toContain('## Question');
  });
  it('renders report tables and escapes raw HTML', () => {
    const html = renderReportMarkdown('# Report\n\n| A | B |\n|---|---|\n| <x> | [link](https://example.com) |');
    expect(html).toContain('<h1>Report</h1>'); expect(html).toContain('<table>'); expect(html).toContain('&lt;x&gt;'); expect(html).toContain('<a href="https://example.com">link</a>');
  });
  it('uses stable identifiers and rejects a conflicting supplied ID', () => {
    expect(stableEvidenceId(record)).toBe('doi:10.1000/test.1'); expect(() => stableEvidenceId({ ...record, evidence_id: 'pmid:12345678' })).toThrow(/mismatch/);
  });
  it('creates once, reuses on rerun, and updates the same report Note', async () => {
    const files = await fixture([record]); const priorityPath = join(files.dir, 'priority_recommendations.json');
    await writeFile(priorityPath, JSON.stringify({ schema_version: '1.0', artifact_type: 'literature-priority-recommendations', scope: 'test-project', review_depth: 'abstract', default_for_selected: 1, recommendations: { 'doi:10.1000/test.1': { priority: 3, reason_codes: ['core-conclusion'] } } }), 'utf8');
    const web = new FakeWeb(); const ctx = context(files.dir, web);
    const input = { projectSlug: 'test-project', collectionName: 'Test Project', searchDate: '2026-07-17', reportPath: files.reportPath, evidencePath: files.evidencePath, priorityRecommendationsPath: priorityPath };
    const first = await syncLiteratureProject(ctx, { type: 'user', id: 1 }, input);
    expect(first).toMatchObject({ status: 'complete', created: 1, report: 'created' }); expect(web.collections).toHaveLength(1);
    expect(dataOf(web.items.find((item) => dataOf(item).itemType === 'journalArticle')).tags).toContainEqual({ tag: 'AI4S:Priority:3' });
    const second = await syncLiteratureProject(ctx, { type: 'user', id: 1 }, { ...input, collectionName: undefined });
    expect(second).toMatchObject({ status: 'complete', created: 0, reused: 1, report: 'unchanged' });
    expect(web.items).toHaveLength(2);
    expect(web.listQueries.every((query) => !query.q && !query.qmode)).toBe(true);
    await writeFile(files.reportPath, '# Literature Report\n\nUpdated synthesis.\n', 'utf8');
    const third = await syncLiteratureProject(ctx, { type: 'user', id: 1 }, input);
    expect(third.report).toBe('updated'); expect(web.items.filter((item) => dataOf(item).itemType === 'note')).toHaveLength(1);
  });
  it('does not search DOI or PMID through q, and reuses a paginated library match outside the collection', async () => {
    const files = await fixture([record]); const web = new FakeWeb();
    await web.writeCollections({}, [{ name: 'Existing' }]);
    await web.writeItems({}, Array.from({ length: 101 }, (_, i) => ({ itemType: 'journalArticle', title: `Unrelated ${i}` })));
    await web.writeItems({}, [{ itemType: 'journalArticle', title: record.title, DOI: 'https://doi.org/10.1000/TEST.1.', extra: `PMID: ${record.pmid}`, collections: [] }]);
    expect((await web.listItems({}, { q: record.doi, qmode: 'everything' })).data).toHaveLength(0);
    expect((await web.listItems({}, { q: record.pmid, qmode: 'everything' })).data).toHaveLength(0);
    const input = { ...files, projectSlug: 'existing', collectionName: 'Existing', searchDate: '2026-07-17' };
    const first = await syncLiteratureProject(context(files.dir, web), { type: 'user', id: 1 }, input);
    expect(first).toMatchObject({ status: 'complete', created: 0, reused: 1 });
    expect(dataOf(web.items[101]).collections).toContain(web.collections[0].key);
    const second = await syncLiteratureProject(context(files.dir, web), { type: 'user', id: 1 }, input);
    expect(second).toMatchObject({ status: 'complete', created: 0, reused: 1 });
    expect(web.items).toHaveLength(103);
  });
  it('paginates collection matches and refuses multiple or conflicting identifiers', async () => {
    for (const conflict of [false, true]) {
      const files = await fixture([record]); const web = new FakeWeb();
      await web.writeCollections({}, [{ name: 'Existing' }]);
      const collections = [web.collections[0].key];
      await web.writeItems({}, Array.from({ length: 101 }, (_, i) => ({ itemType: 'journalArticle', title: `Other ${i}`, collections })));
      await web.writeItems({}, [{ itemType: 'journalArticle', title: record.title, DOI: record.doi, extra: `PMID: ${conflict ? '99999999' : record.pmid}`, collections }]);
      if (!conflict) await web.writeItems({}, [{ itemType: 'journalArticle', title: 'Duplicate', DOI: record.doi, collections }]);
      const result = await syncLiteratureProject(context(files.dir, web), { type: 'user', id: 1 }, { ...files, projectSlug: 'conflict', collectionName: 'Existing', searchDate: '2026-07-17' });
      expect(result).toMatchObject({ status: 'needs_review', created: 0 });
      expect(result.risks).toContain('multiple-or-conflicting-identifier-matches:1');
    }
  });
  it.each(['doi:10.1000/test.1', '10.1000/TEST.1.', 'https://doi.org/10.1000/TEST.1', 'pmid:12345678', '12345678'])('applies priority alias %s to the DOI-first evidence', async (key) => {
    const files = await fixture([record]); const web = new FakeWeb();
    const priorityPath = join(files.dir, 'priority.json');
    await writeFile(priorityPath, JSON.stringify({ schema_version: '1.0', artifact_type: 'literature-priority-recommendations', scope: 'aliases', review_depth: 'abstract', default_for_selected: 1, recommendations: { [key]: { priority: 3, reason_codes: ['direct-question-match'] } } }));
    const result = await syncLiteratureProject(context(files.dir, web), { type: 'user', id: 1 }, { ...files, projectSlug: 'aliases', collectionName: 'Aliases', searchDate: '2026-07-17', priorityRecommendationsPath: priorityPath });
    expect(result.status).toBe('complete');
    expect(dataOf(web.items[0]).tags).toContainEqual({ tag: 'AI4S:Priority:3' });
  });
  it('rejects unknown priority keys before any writes', async () => {
    const files = await fixture([record]); const web = new FakeWeb(); const priorityPath = join(files.dir, 'priority.json');
    await writeFile(priorityPath, JSON.stringify({ schema_version: '1.0', artifact_type: 'literature-priority-recommendations', scope: 'unknown', review_depth: 'abstract', default_for_selected: 1, recommendations: { '10.1000/unknown': { priority: 3, reason_codes: ['direct-question-match'] } } }));
    await expect(syncLiteratureProject(context(files.dir, web), { type: 'user', id: 1 }, { ...files, projectSlug: 'unknown', collectionName: 'Unknown', searchDate: '2026-07-17', priorityRecommendationsPath: priorityPath })).rejects.toThrow(/unknown evidence ID/);
    expect(web.items).toHaveLength(0); expect(web.collections).toHaveLength(0);
  });
  it('reuses the saved item key even when lists cannot find bibliography', async () => {
    const files = await fixture([record]); const web = new FakeWeb(); const ctx = context(files.dir, web);
    const lib = { type: 'user' as const, id: 1 };
    const input = { ...files, projectSlug: 'by-key', collectionName: 'By Key', searchDate: '2026-07-17' };
    await syncLiteratureProject(ctx, lib, input);
    const saved = await readProjectState(projectStatePath(files.dir, lib, input.projectSlug));
    expect(saved).toMatchObject({ schema_version: '1.1', synced_items: { 'doi:10.1000/test.1': { item_key: web.items[0].key, version: web.items[0].version } } });
    web.hideBibliography = true;
    expect(await syncLiteratureProject(ctx, lib, input)).toMatchObject({ status: 'complete', created: 0, reused: 1 });
    expect(web.items).toHaveLength(2);
  });
  it('blocks previously synced creates even with a confirmation token', async () => {
    const files = await fixture([record]); const web = new FakeWeb(); const ctx = context(files.dir, web); const lib = { type: 'user' as const, id: 1 };
    const input = { ...files, projectSlug: 'missing-key', collectionName: 'Missing Key', searchDate: '2026-07-17' };
    const first = await syncLiteratureProject(ctx, lib, input);
    web.items = web.items.filter((item) => dataOf(item).itemType === 'note'); web.hideBibliography = true;
    const result = await syncLiteratureProject(ctx, lib, { ...input, confirmReviewId: 'a'.repeat(64) });
    expect(result).toMatchObject({ status: 'needs_review', created: 0, createReview: { collection_name: 'Missing Key', collection_key: first.collectionKey, collection_exists: true, new_items: 1, previously_synced: 1, evidence_ids: ['doi:10.1000/test.1'] } });
    expect(result.risks).toContain('previously-synced-would-create'); expect(web.items).toHaveLength(1);
  });
  it('reads old 1.0 state, falls back to identifiers, and upgrades it', async () => {
    const files = await fixture([record]); const web = new FakeWeb(); const ctx = context(files.dir, web); const lib = { type: 'user' as const, id: 1 };
    const input = { ...files, projectSlug: 'legacy', collectionName: 'Legacy', searchDate: '2026-07-17' };
    await syncLiteratureProject(ctx, lib, input);
    const path = projectStatePath(files.dir, lib, input.projectSlug);
    const old = JSON.parse(await readFile(path, 'utf8')); old.schema_version = '1.0'; delete old.synced_items;
    await writeFile(path, JSON.stringify(old));
    expect((await readProjectState(path))?.synced_items).toEqual({});
    expect(await syncLiteratureProject(ctx, lib, input)).toMatchObject({ status: 'complete', created: 0, reused: 1 });
    const next = JSON.parse(await readFile(path, 'utf8'));
    expect(next.schema_version).toBe('1.1'); expect(next.synced_items['doi:10.1000/test.1'].item_key).toBe(web.items[0].key);
    delete next.synced_items; next.schema_version = '1.0'; await writeFile(path, JSON.stringify(next));
    web.items = web.items.filter((item) => dataOf(item).itemType === 'note');
    expect((await syncLiteratureProject(ctx, lib, input)).risks).toContain('previously-synced-would-create');
  });
  it('refuses a saved key whose identifiers now conflict', async () => {
    const files = await fixture([record]); const web = new FakeWeb(); const ctx = context(files.dir, web);
    const input = { ...files, projectSlug: 'changed-key', collectionName: 'Changed Key', searchDate: '2026-07-17' };
    await syncLiteratureProject(ctx, { type: 'user', id: 1 }, input);
    web.items[0].data.extra = 'PMID: 99999999';
    const result = await syncLiteratureProject(ctx, { type: 'user', id: 1 }, input);
    expect(result).toMatchObject({ status: 'needs_review', created: 0 });
    expect(result.risks).toContain('multiple-or-conflicting-identifier-matches:1');
  });
  it('makes identical reruns zero-write, including metrics, Priority, and report', async () => {
    const enriched = { ...record, easyscholar: { official_rank: { all: { sciif: '5.8', sci: 'Q1' } }, fetched_at: '2026-07-17T00:00:00Z' } };
    const files = await fixture([enriched]); const web = new FakeWeb(); const ctx = context(files.dir, web); const lib = { type: 'user' as const, id: 1 };
    const priorityPath = join(files.dir, 'priority.json');
    await writeFile(priorityPath, JSON.stringify({ schema_version: '1.0', artifact_type: 'literature-priority-recommendations', scope: 'no-op', review_depth: 'abstract', default_for_selected: 1, recommendations: {} }));
    const input = { ...files, projectSlug: 'no-op', collectionName: 'No Op', searchDate: '2026-07-17', priorityRecommendationsPath: priorityPath };
    await syncLiteratureProject(ctx, lib, input);
    const versions = web.items.map((item) => item.version); web.patchedKeys = [];
    expect(await syncLiteratureProject(ctx, lib, input)).toMatchObject({ status: 'complete', created: 0, reused: 1, unchanged: 1, report: 'unchanged' });
    expect(web.patchedKeys).toEqual([]); expect(web.items.map((item) => item.version)).toEqual(versions);
    expect((await readProjectState(projectStatePath(files.dir, lib, input.projectSlug)))?.synced_items['doi:10.1000/test.1'].version).toBe(versions[0]);
  });
  it('creates only new evidence and retains deselected IDs and bindings', async () => {
    const records = [0, 1, 2].map((n) => ({ ...record, doi: `10.1000/incremental.${n}`, pmid: undefined, title: `Incremental study ${n}`, easyscholar: { official_rank: { all: { sciif: '5.8', sci: 'Q1' } } } }));
    const files = await fixture(records.slice(0, 2)); const web = new FakeWeb(); const ctx = context(files.dir, web); const lib = { type: 'user' as const, id: 1 };
    const input = { ...files, projectSlug: 'incremental', collectionName: 'Incremental', searchDate: '2026-07-17' };
    await syncLiteratureProject(ctx, lib, input); web.patchedKeys = [];
    const statePath = projectStatePath(files.dir, lib, input.projectSlug); const original = await readProjectState(statePath);
    const selectionPath = join(files.dir, 'selection.json');
    await writeFile(selectionPath, JSON.stringify({ schema_version: '1.0', evidence_ids: ['doi:10.1000/incremental.0'] }));
    await syncLiteratureProject(ctx, lib, { ...input, selectionPath });
    const reduced = await readProjectState(statePath);
    expect(reduced?.synced_evidence_ids).toEqual(original?.synced_evidence_ids); expect(reduced?.synced_items).toEqual(original?.synced_items);
    await writeFile(files.evidencePath, JSON.stringify({ records }));
    expect(await syncLiteratureProject(ctx, lib, input)).toMatchObject({ status: 'complete', created: 1, reused: 2, unchanged: 2 });
    expect(web.patchedKeys).toEqual([]); expect(web.items).toHaveLength(4);
    expect(Object.keys((await readProjectState(statePath))!.synced_items)).toHaveLength(3);
  });
  it('patches only the one changed metric payload', async () => {
    const records = [0, 1].map((n) => ({ ...record, doi: `10.1000/metrics.${n}`, pmid: String(90000000 + n), title: `Metrics study ${n}`, easyscholar: { official_rank: { all: { sciif: '5.8', sci: 'Q2' } } } }));
    const files = await fixture(records); const web = new FakeWeb(); const ctx = context(files.dir, web);
    const input = { ...files, projectSlug: 'metrics', collectionName: 'Metrics', searchDate: '2026-07-17' };
    await syncLiteratureProject(ctx, { type: 'user', id: 1 }, input); web.patchedKeys = [];
    records[1]!.easyscholar.official_rank.all.sci = 'Q1';
    await writeFile(files.evidencePath, JSON.stringify({ records }));
    expect(await syncLiteratureProject(ctx, { type: 'user', id: 1 }, input)).toMatchObject({ created: 0, reused: 2, unchanged: 1 });
    expect(web.patchedKeys).toEqual([web.items[1].key]);
    expect(web.items[0].data.tags).toContainEqual({ tag: 'JCR:Q2' }); expect(web.items[1].data.tags).toContainEqual({ tag: 'JCR:Q1' });
    web.patchedKeys = []; await syncLiteratureProject(ctx, { type: 'user', id: 1 }, input); expect(web.patchedKeys).toEqual([]);
  });
  it('refreshes only changed project-managed Priority and preserves manual overrides', async () => {
    const records = [0, 1].map((n) => ({ ...record, doi: `10.1000/priority.${n}`, pmid: String(90000000 + n), title: `Priority study ${n}` }));
    const files = await fixture(records); const web = new FakeWeb(); const ctx = context(files.dir, web); const priorityPath = join(files.dir, 'priority.json');
    const priority = { schema_version: '1.0', artifact_type: 'literature-priority-recommendations', scope: 'priority', review_depth: 'abstract', default_for_selected: 1, recommendations: {} as Record<string, unknown> };
    await writeFile(priorityPath, JSON.stringify(priority));
    const input = { ...files, projectSlug: 'priority', collectionName: 'Priority', searchDate: '2026-07-17', priorityRecommendationsPath: priorityPath };
    await syncLiteratureProject(ctx, { type: 'user', id: 1 }, input); web.patchedKeys = [];
    priority.recommendations = { 'pmid:90000000': { priority: 3, reason_codes: ['direct-question-match'] } };
    await writeFile(priorityPath, JSON.stringify(priority));
    expect(await syncLiteratureProject(ctx, { type: 'user', id: 1 }, input)).toMatchObject({ created: 0, reused: 2, unchanged: 1 });
    expect(web.patchedKeys).toEqual([web.items[0].key]);
    expect(web.items[0].data.tags).toContainEqual({ tag: 'AI4S:Priority:3' }); expect(web.items[0].data.tags).not.toContainEqual({ tag: 'AI4S:Priority:1' });
    await web.patchItem({}, web.items[0].key, { tags: [...web.items[0].data.tags.filter((entry: any) => !entry.tag.startsWith('AI4S:Priority:')), { tag: 'AI4S:Priority:2' }] }, web.items[0].version);
    web.patchedKeys = [];
    await syncLiteratureProject(ctx, { type: 'user', id: 1 }, input);
    expect(web.items[0].data.tags).toContainEqual({ tag: 'AI4S:Priority:2' }); expect(web.patchedKeys).toEqual([]);
  });
  it('restores missing collection membership once without touching other items', async () => {
    const files = await fixture([record]); const web = new FakeWeb(); const ctx = context(files.dir, web);
    const input = { ...files, projectSlug: 'membership', collectionName: 'Membership', searchDate: '2026-07-17' };
    const first = await syncLiteratureProject(ctx, { type: 'user', id: 1 }, input);
    await web.patchItem({}, web.items[0].key, { collections: ['OTHER001'] }, web.items[0].version); web.patchedKeys = [];
    expect(await syncLiteratureProject(ctx, { type: 'user', id: 1 }, input)).toMatchObject({ created: 0, reused: 1, unchanged: 0 });
    expect(web.patchedKeys).toEqual([web.items[0].key]); expect(web.items[0].data.collections).toEqual(['OTHER001', first.collectionKey]);
    web.patchedKeys = []; await syncLiteratureProject(ctx, { type: 'user', id: 1 }, input); expect(web.patchedKeys).toEqual([]);
  });
  it('stops when the managed report was edited in Zotero', async () => {
    const files = await fixture([record]); const web = new FakeWeb(); const ctx = context(files.dir, web);
    const input = { projectSlug: 'manual-edit', collectionName: 'Manual Edit', searchDate: '2026-07-17', reportPath: files.reportPath, evidencePath: files.evidencePath };
    await syncLiteratureProject(ctx, { type: 'user', id: 1 }, input); const note = web.items.find((item) => dataOf(item).itemType === 'note'); note.data.note = '<p>Manual change</p>';
    const result = await syncLiteratureProject(ctx, { type: 'user', id: 1 }, input); expect(result.status).toBe('needs_review'); expect(result.risks).toContain('report-note-manually-modified');
  });
  it('requires one review token above fifty creates', async () => {
    const records = Array.from({ length: 51 }, (_, index) => ({ ...record, id: String(index), doi: `10.1000/batch.${index}`, pmid: String(90000000 + index), title: `Study ${index}` }));
    const files = await fixture(records); const web = new FakeWeb();
    await web.writeCollections({}, [{ name: 'Large Batch' }]);
    const result = await syncLiteratureProject(context(files.dir, web), { type: 'user', id: 1 }, { projectSlug: 'large-batch', collectionName: 'Large Batch', searchDate: '2026-07-17', reportPath: files.reportPath, evidencePath: files.evidencePath });
    expect(result.status).toBe('needs_review'); expect(result.risks).toEqual(['large-create-batch:51']); expect(result.reviewId).toMatch(/^[0-9a-f]{64}$/); expect(web.items).toHaveLength(0);
    expect(result.createReview).toEqual({ collection_name: 'Large Batch', collection_key: web.collections[0].key, collection_exists: true, new_items: 51, previously_synced: 0, evidence_ids: [] });
  });
});
