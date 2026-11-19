import { describe, it, expect, vi, beforeEach } from 'vitest';
import { clearLibraryDoiCache, libraryDoiSet, LIBRARY_DOI_PAGE_SIZE } from '../../src/features/scholar/library-dois.js';
import scholar from '../../src/tools/scholar.js';

beforeEach(() => clearLibraryDoiCache());

function items(count: number, doiAt = (i: number) => (i % 2 === 0 ? `10.1000/item${i}` : '')) {
  return Array.from({ length: count }, (_, i) => ({
    key: `K${i}`,
    data: { DOI: doiAt(i) },
  }));
}

function pagedLibrary(count: number, version = 4) {
  const library = items(count);
  const searchItems = vi.fn(async (query: { start?: number; limit?: number; top?: boolean }) => {
    expect(query.top).toBe(true);
    const start = query.start ?? 0;
    const limit = query.limit ?? LIBRARY_DOI_PAGE_SIZE;
    return {
      data: library.slice(start, start + limit),
      totalResults: library.length,
      lastModifiedVersion: version,
    };
  });
  return { searchItems, ctx: { router: { searchItems } } as any };
}

describe('libraryDoiSet', () => {
  it('reads only top-level pages and reuses them while the library version is unchanged', async () => {
    const { searchItems, ctx } = pagedLibrary(250);
    const first = await libraryDoiSet(ctx);
    expect(first.has('10.1000/item0')).toBe(true);
    expect(first.has('10.1000/item1')).toBe(false);
    // 250 items: one page of 100, then the two remaining pages. Not one request per item.
    expect(searchItems).toHaveBeenCalledTimes(3);
    expect(searchItems.mock.calls.every((call) => call[0].top === true)).toBe(true);

    const second = await libraryDoiSet(ctx);
    expect(second).toBe(first);
    // One version probe, then the cached set. The library is not paged again.
    expect(searchItems).toHaveBeenCalledTimes(4);
    expect(searchItems.mock.calls[3][0]).toMatchObject({ limit: 1, top: true });
  });

  it('stops when every page repeats the same item keys', async () => {
    const page = items(LIBRARY_DOI_PAGE_SIZE);
    let calls = 0;
    const searchItems = vi.fn(async () => {
      calls += 1;
      return { data: page, totalResults: 5000, lastModifiedVersion: 9 };
    });
    const dois = await libraryDoiSet({ router: { searchItems } } as any);
    expect(dois.has('10.1000/item0')).toBe(true);
    // First page, then one wave that is identical. Must not walk all 5,000 slots.
    expect(calls).toBeLessThanOrEqual(1 + 4);
    expect(calls).toBeGreaterThan(1);
  });

  it('normalizes a DOI stored as a doi.org URL', async () => {
    const searchItems = vi.fn(async () => ({
      data: [{ key: 'K1', data: { DOI: 'https://doi.org/10.5555/ABC' } }],
      totalResults: 1,
      lastModifiedVersion: 2,
    }));
    const dois = await libraryDoiSet({ router: { searchItems } } as any);
    expect(dois.has('10.5555/abc')).toBe(true);
    expect(searchItems).toHaveBeenCalledTimes(1);
  });
});

describe('zotero_scholar library matching', () => {
  it('flags only the result DOIs and does not scan the library when matching is off', async () => {
    const { searchItems, ctx } = pagedLibrary(300);
    const works = [
      { doi: '10.1000/item0', authors: [], title: 'Saved' },
      { doi: '10.9/missing', authors: [], title: 'New' },
    ];
    ctx.capabilities = { localApi: true, cloud: null };
    ctx.scholar = { references: vi.fn(async () => works) };

    const matched = await scholar.handler({ action: 'references', doi: '10.1/seed' }, ctx);
    const results = (matched.structuredContent as any).results;
    expect(results[0].inLibrary).toBe(true);
    expect(results[1].inLibrary).toBe(false);
    expect(searchItems.mock.calls.length).toBeLessThanOrEqual(4);

    searchItems.mockClear();
    await scholar.handler({ action: 'references', doi: '10.1/seed', include_in_library: false }, ctx);
    expect(searchItems).not.toHaveBeenCalled();
  });
});
