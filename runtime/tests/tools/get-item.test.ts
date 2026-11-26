import { describe, it, expect, vi } from 'vitest';
import getItem from '../../src/tools/get-item.js';

function ctx(getImpl: any, childrenImpl?: any) {
  return {
    router: {
      getItemWithMetadata: vi.fn(async (...args) => ({
        data: await getImpl(...args),
        source: 'cloud',
        lastModifiedVersion: 41300,
      })),
      getItemChildren:
        childrenImpl ?? vi.fn(async () => ({ data: [], totalResults: 0, lastModifiedVersion: 0 })),
      defaultLibrary: () => ({ type: 'user', id: 19552201 }),
    },
  } as any;
}

const fullItem = {
  key: 'ABCD',
  version: 5,
  data: {
    itemType: 'book',
    title: 'T',
    creators: [{ creatorType: 'author', lastName: 'Doe', firstName: 'J.' }],
    date: '2021',
    tags: [{ tag: 'to-read' }],
    collections: ['ZK1'],
  },
};

describe('zotero_get_item', () => {
  it('returns a concise projection by default, with the provenance kept', async () => {
    const getImpl = vi.fn(async () => fullItem);
    const res = await getItem.handler({ item_key: 'ABCD' }, ctx(getImpl));
    expect(getImpl).toHaveBeenCalledWith('ABCD', expect.any(Object));
    expect(res.structuredContent).toMatchObject({ source: 'cloud', libraryVersion: 41300 });
    const item = res.structuredContent?.item as any;
    expect(item).toEqual({
      key: 'ABCD',
      itemType: 'book',
      title: 'T',
      creatorSummary: 'Doe',
      date: '2021',
      DOI: undefined,
    });
    // Version, tags, and collections stay out of the concise projection.
    expect(item.version).toBeUndefined();
    expect(item.tags).toBeUndefined();
    expect(item.collections).toBeUndefined();
    expect((res.structuredContent as any).format).toBe('concise');
    const text = (res.content ?? []).map((c: { text: string }) => c.text).join('\n');
    expect(text).toMatch(/detailed/);
  });

  it('returns the full item record with response_format=detailed', async () => {
    const getImpl = vi.fn(async () => fullItem);
    const res = await getItem.handler({ item_key: 'ABCD', response_format: 'detailed' }, ctx(getImpl));
    const item = res.structuredContent?.item as any;
    expect(item.data.title).toBe('T');
    expect(item.version).toBe(5);
    expect(item.data.tags).toEqual([{ tag: 'to-read' }]);
    expect((res.structuredContent as any).format).toBeUndefined();
  });

  it('projects children in concise mode and returns them whole in detailed mode', async () => {
    const getImpl = vi.fn(async () => ({ key: 'ABCD', data: { itemType: 'book' } }));
    const childrenImpl = vi.fn(async () => ({
      data: [
        {
          key: 'NOTE1',
          data: {
            itemType: 'note',
            note: 'A long note that would otherwise flood the result with its whole body text.',
          },
        },
        { key: 'ATT1', data: { itemType: 'attachment', filename: 'paper.pdf' } },
      ],
      totalResults: 2,
      lastModifiedVersion: 5,
    }));
    const concise = await getItem.handler(
      { item_key: 'ABCD', include_children: true },
      ctx(getImpl, childrenImpl),
    );
    expect(childrenImpl).toHaveBeenCalled();
    const children = (concise.structuredContent?.children as any[]).map((c) => Object.keys(c).sort());
    for (const keys of children) expect(keys).toEqual(['itemType', 'key', 'title']);
    const notes = concise.structuredContent?.children as any[];
    expect(notes[0].title).toMatch(/^A long note/);
    expect(notes[1].title).toBe('paper.pdf');
    const detailed = await getItem.handler(
      { item_key: 'ABCD', include_children: true, response_format: 'detailed' },
      ctx(getImpl, childrenImpl),
    );
    expect((detailed.structuredContent?.children as any[])[0].data.note).toMatch(/whole body text/);
  });

  it('a typical 25-item read stays far below the old whole-item sizes', async () => {
    const items = Array.from({ length: 25 }, (_, i) => ({
      key: `KEY${String(i).padStart(4, '0')}`,
      version: 2100 + i,
      data: {
        itemType: 'journalArticle',
        title: `A reasonably long article title about topic number ${i} with several descriptive words`,
        creators: Array.from({ length: 3 }, (_, a) => ({ creatorType: 'author', lastName: `Author${a}`, firstName: 'A.' })),
        date: '2021-05',
        DOI: `10.1000/example-${i}`,
        tags: [{ tag: 'to-read' }, { tag: `project-${i}` }],
        collections: ['ZK1', 'ZK2'],
        abstractNote: 'A long abstract repeated here. '.repeat(40),
        url: `https://example.com/article/${i}`,
      },
    }));
    const router = vi.fn(async () => ({ data: items, totalResults: 25, lastModifiedVersion: 2114, source: 'local' }));
    // One whole item, concise: well under a kilobyte.
    const one = await getItem.handler({ item_key: 'KEY0000' }, ctx(async () => items[0]));
    expect(JSON.stringify(one.structuredContent?.item).length).toBeLessThan(600);
    // Twenty-five of them in a search-sized page also stay far from ~20 KB.
    const { default: searchItems } = await import('../../src/tools/search-items.js');
    const res = await searchItems.handler(
      { q: 'topic', limit: 25 },
      { router: { searchItems: router, defaultLibrary: () => ({ type: 'user', id: 19552201 }) } } as any,
    );
    expect((res.structuredContent?.items as any[]).length).toBe(25);
    expect(JSON.stringify(res.structuredContent?.items).length).toBeLessThan(8000);
    expect(res.structuredContent).toMatchObject({ totalResults: 25, source: 'local', libraryVersion: 2114 });
  });
});
