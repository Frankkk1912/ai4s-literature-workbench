import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import findDuplicates from '../../src/tools/find-duplicates.js';

const batch = {
  key: 'BATCH001',
  version: 1,
  data: { itemType: 'journalArticle', title: 'Duplicate paper', DOI: '10.1000/test' },
};
const existing = {
  key: 'LIB00001',
  version: 2,
  data: { itemType: 'journalArticle', title: 'Duplicate paper', DOI: '10.1000/test' },
};

async function context(searchItems: ReturnType<typeof vi.fn>) {
  return {
    config: { dataDir: await mkdtemp(join(tmpdir(), 'literature-zotero-mcp-')) },
    router: {
      defaultLibrary: () => ({ type: 'user', id: 19552201 }),
      searchItems,
    },
  } as any;
}

describe('zotero_find_duplicates', () => {
  it('is explicitly read-only', () => {
    expect(findDuplicates.annotations?.readOnlyHint).toBe(true);
    expect(findDuplicates.annotations?.destructiveHint).toBe(false);
    expect(findDuplicates.annotations?.idempotentHint).toBe(false);
  });

  it('requires exactly one batch selector and an explicit limit', async () => {
    const ctx = await context(vi.fn());

    expect((await findDuplicates.handler({ limit: 100 }, ctx)).isError).toBe(true);
    expect(
      (
        await findDuplicates.handler(
          { collection_key: 'COLL', tag: 'import-run:test', limit: 100 },
          ctx,
        )
      ).isError,
    ).toBe(true);
    expect((await findDuplicates.handler({ collection_key: 'COLL' }, ctx)).isError).toBe(true);
  });

  it('compares a collection batch against the whole library and persists an audit report', async () => {
    const searchItems = vi.fn(async (query: any) => {
      if (query.collectionKey === 'COLL0001') {
        return { data: [batch], totalResults: 1, lastModifiedVersion: 8, source: 'cloud' };
      }
      return { data: [batch, existing], totalResults: 2, lastModifiedVersion: 8, source: 'cloud' };
    });
    const ctx = await context(searchItems);

    const result = await findDuplicates.handler({ collection_key: 'COLL0001', limit: 100 }, ctx);

    expect(result.isError).toBeUndefined();
    expect(searchItems).toHaveBeenCalledWith(
      expect.objectContaining({ collectionKey: 'COLL0001', top: true }),
    );
    expect(searchItems).toHaveBeenCalledWith(
      expect.objectContaining({ top: true, includeTrashed: false }),
    );
    expect(result.structuredContent?.clusterCount).toBe(1);
    expect(result.structuredContent).toMatchObject({ source: 'cloud', libraryVersion: 8 });
    expect(result.structuredContent?.reportId).toMatch(/^duplicates-/);
    const reportPath = result.structuredContent?.reportPath as string;
    const report = JSON.parse(await readFile(reportPath, 'utf8'));
    expect(report.clusters[0].batch_item_keys).toEqual(['BATCH001']);
    expect(report.clusters[0].master_outside_scope).toBe(false);
    expect(report.clusters[0].master_scope_steps).toBeUndefined();
    expect(report.master_outside_scope_count).toBe(0);
    expect(report.clusters[0].native_merge_required).toBe(true);
    expect(JSON.stringify(report)).not.toContain('api-key');
  });

  it('supports a tag-scoped batch', async () => {
    const searchItems = vi.fn(async (query: any) => ({
      data: query.tag ? [batch] : [batch, existing],
      totalResults: query.tag ? 1 : 2,
      lastModifiedVersion: 8,
    }));
    const ctx = await context(searchItems);

    await findDuplicates.handler({ tag: 'import-run:test-20260711', limit: 100 }, ctx);

    expect(searchItems).toHaveBeenCalledWith(
      expect.objectContaining({ tag: 'import-run:test-20260711' }),
    );
  });

  it('fails instead of silently truncating when the selected batch exceeds limit', async () => {
    const searchItems = vi.fn(async (query: any) => ({
      data: query.collectionKey ? [batch] : [batch, existing],
      totalResults: query.collectionKey ? 101 : 300,
      lastModifiedVersion: 8,
    }));
    const ctx = await context(searchItems);

    const result = await findDuplicates.handler({ collection_key: 'COLL0001', limit: 100 }, ctx);

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/101.*limit.*100/i);
    expect(result.content[0].text).toMatch(/batch/i);
    expect(result.content[0].text).not.toMatch(/full library/i);
  });

  it('scans a small collection batch without applying its limit to the full-library comparison', async () => {
    const inBatchA = {
      key: 'BATCH001',
      version: 1,
      data: { itemType: 'journalArticle', title: 'Duplicate paper', DOI: '10.1000/test' },
    };
    const inBatchB = {
      key: 'BATCH002',
      version: 1,
      data: { itemType: 'journalArticle', title: 'Duplicate paper', DOI: '10.1000/test' },
    };
    const inBatchFiller = {
      key: 'BATCH003',
      version: 1,
      data: { itemType: 'journalArticle', title: 'Unrelated in-batch paper', DOI: '10.1000/other' },
    };
    const library = [inBatchA, inBatchB, inBatchFiller];
    for (let i = 0; i < 297; i += 1) {
      library.push({
        key: `LIB${String(i).padStart(5, '0')}`,
        version: 1,
        data: {
          itemType: 'journalArticle',
          title: `Library filler paper ${i}`,
          DOI: `10.1000/filler-${i}`,
        },
      });
    }
    const searchItems = vi.fn(async (query: any) => {
      if (query.collectionKey === 'COLL0001') {
        return {
          data: [inBatchA, inBatchB, inBatchFiller],
          totalResults: 3,
          lastModifiedVersion: 8,
          source: 'cloud',
        };
      }
      return {
        data: library.slice(query.start, query.start + query.limit),
        totalResults: library.length,
        lastModifiedVersion: 8,
        source: 'cloud',
      };
    });
    const ctx = await context(searchItems);

    const result = await findDuplicates.handler({ collection_key: 'COLL0001', limit: 10 }, ctx);

    expect(result.isError).toBeUndefined();
    expect(result.structuredContent?.clusterCount).toBe(1);
    expect(result.structuredContent?.batchItemsScanned).toBe(3);
    expect(result.structuredContent?.itemsScanned).toBe(300);
    expect(result.structuredContent?.masterOutsideScopeCount).toBe(0);
    const report = JSON.parse(
      await readFile(result.structuredContent?.reportPath as string, 'utf8'),
    );
    expect(report.batch_total_results).toBe(3);
    expect(report.source_total_results).toBe(300);
    expect(report.explicit_limit).toBe(10);
    expect(report.library_scan_safety_cap).toBeGreaterThan(300);
    expect(report.clusters[0].batch_item_keys).toEqual(['BATCH001', 'BATCH002']);
    expect(report.clusters[0].master_outside_scope).toBe(false);
  });

  it('flags a cluster whose recommended master is outside the selected collection', async () => {
    const copyA = {
      key: 'BATCH001',
      version: 1,
      data: { itemType: 'journalArticle', title: 'Duplicate paper', DOI: '10.1000/test' },
    };
    const copyB = {
      key: 'BATCH002',
      version: 1,
      data: { itemType: 'journalArticle', title: 'Duplicate paper', DOI: '10.1000/test' },
    };
    const outsideMaster = {
      key: 'LIB00001',
      version: 3,
      data: {
        itemType: 'journalArticle',
        title: 'Duplicate paper',
        DOI: '10.1000/test',
        abstractNote: 'Detailed abstract of the record kept outside the batch collection.',
        publicationTitle: 'Journal of Duplicate Testing',
        creators: [{ creatorType: 'author', firstName: 'Jane', lastName: 'Smith' }],
        tags: [{ tag: 'project:test' }],
        collections: ['COLL9999'],
      },
      meta: { numChildren: 2 },
    };
    const searchItems = vi.fn(async (query: any) => {
      if (query.collectionKey === 'COLL0001') {
        return { data: [copyA, copyB], totalResults: 2, lastModifiedVersion: 8, source: 'cloud' };
      }
      return {
        data: [copyA, copyB, outsideMaster],
        totalResults: 3,
        lastModifiedVersion: 8,
        source: 'cloud',
      };
    });
    const ctx = await context(searchItems);

    const result = await findDuplicates.handler({ collection_key: 'COLL0001', limit: 100 }, ctx);

    expect(result.isError).toBeUndefined();
    expect(result.structuredContent?.masterOutsideScopeCount).toBe(1);
    expect(result.content[0].text).toMatch(/master outside the selected batch/i);
    const report = JSON.parse(
      await readFile(result.structuredContent?.reportPath as string, 'utf8'),
    );
    expect(report.master_outside_scope_count).toBe(1);
    const cluster = report.clusters[0];
    expect(cluster.recommended_master_key).toBe('LIB00001');
    expect(cluster.master_outside_scope).toBe(true);
    expect(cluster.batch_item_keys).toEqual(['BATCH001', 'BATCH002']);
    expect(cluster.master_scope_steps.join(' ')).toMatch(/COLL0001/);
    expect(cluster.master_scope_steps.join(' ')).toMatch(/LIB00001/);
    expect(cluster.master_scope_steps.join(' ')).toMatch(
      /drag item LIB00001 into the batch collection/i,
    );
    expect(cluster.master_scope_steps.join(' ')).toMatch(
      /do not merge or trash the in-scope copies/i,
    );
  });

  it('reports an actionable error when the library comparison scan exceeds its safety cap', async () => {
    const searchItems = vi.fn(async (query: any) => ({
      data: query.collectionKey ? [batch] : [batch, existing],
      totalResults: query.collectionKey ? 1 : 5001,
      lastModifiedVersion: 8,
    }));
    const ctx = await context(searchItems);

    const result = await findDuplicates.handler({ collection_key: 'COLL0001', limit: 100 }, ctx);

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/full library/i);
    expect(result.content[0].text).toMatch(/5001/);
    expect(result.content[0].text).toMatch(/safety cap/i);
    expect(result.content[0].text).not.toMatch(/batch contains 5001/i);
  });

  it('filters child and deleted records before analysis', async () => {
    const attachment = {
      key: 'ATTACH01',
      data: { itemType: 'attachment', title: 'Duplicate paper' },
    };
    const deleted = {
      key: 'DELETED1',
      data: { itemType: 'journalArticle', title: 'Duplicate paper', deleted: 1 },
    };
    const searchItems = vi.fn(async (query: any) => ({
      data: query.collectionKey
        ? [batch, attachment, deleted]
        : [batch, existing, attachment, deleted],
      totalResults: query.collectionKey ? 3 : 4,
      lastModifiedVersion: 8,
    }));
    const ctx = await context(searchItems);

    const result = await findDuplicates.handler({ collection_key: 'COLL0001', limit: 100 }, ctx);
    const report = JSON.parse(
      await readFile(result.structuredContent?.reportPath as string, 'utf8'),
    );

    expect(report.items_scanned).toBe(2);
    expect(report.batch_items_scanned).toBe(1);
  });
});
