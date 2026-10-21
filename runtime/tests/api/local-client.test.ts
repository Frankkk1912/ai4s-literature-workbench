import { describe, it, expect, vi } from 'vitest';
import { LocalApiClient } from '../../src/api/local-client.js';
import { RateLimitedFetcher } from '../../src/api/http.js';

function makeLocal(fetchImpl: any, port = 23119) {
  return new LocalApiClient({ port, fetcher: new RateLimitedFetcher({ fetchImpl, maxConcurrency: 4 }) });
}

describe('LocalApiClient', () => {
  it('ping returns true when the local API responds', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      expect(url).toContain('http://127.0.0.1:23119/api/users/0/items');
      return new Response(JSON.stringify([]), { status: 200, headers: { 'Total-Results': '0' } });
    });
    expect(await makeLocal(fetchImpl).ping()).toBe(true);
  });

  it('ping returns false on connection error', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('ECONNREFUSED');
    });
    expect(await makeLocal(fetchImpl).ping()).toBe(false);
  });

  it('lists items against users/0', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      expect(url).toContain('/api/users/0/items');
      expect(url).toContain('limit=5');
      return new Response(JSON.stringify([{ key: 'A' }]), {
        status: 200,
        headers: { 'Total-Results': '1', 'Last-Modified-Version': '10' },
      });
    });
    const r = await makeLocal(fetchImpl).listItems({ limit: 5 });
    expect(r.data).toHaveLength(1);
    expect(r.totalResults).toBe(1);
  });

  it('scopes listItems by collection via the path segment, not a query param', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      expect(url).toContain('/api/users/0/collections/ABC/items');
      expect(url).not.toContain('collectionKey=');
      return new Response(JSON.stringify([{ key: 'A' }]), {
        status: 200,
        headers: { 'Total-Results': '1', 'Last-Modified-Version': '10' },
      });
    });
    const r = await makeLocal(fetchImpl).listItems({ collectionKey: 'ABC' });
    expect(r.data).toHaveLength(1);
  });

  describe('probe', () => {
    it('reports ok, and whether this Zotero accepts writes', async () => {
      const fetchImpl = vi.fn(
        async () => new Response('[]', { status: 200, headers: { 'Zotero-Server-ID': 'srv-1', 'X-Zotero-Version': '10.0.6' } }),
      );
      expect(await makeLocal(fetchImpl).probe()).toEqual({ state: 'ok', serverId: 'srv-1', version: '10.0.6' });
      const older = vi.fn(async () => new Response('[]', { status: 200, headers: { 'X-Zotero-Version': '9.0.6' } }));
      expect((await makeLocal(older).probe()).serverId).toBeUndefined();
    });

    it('tells a switched-off setting (403) from a closed Zotero', async () => {
      const off = vi.fn(async () => new Response('Forbidden', { status: 403 }));
      expect((await makeLocal(off).probe()).state).toBe('forbidden');
      const closed = vi.fn(async () => {
        throw new TypeError('fetch failed');
      });
      expect((await makeLocal(closed).probe()).state).toBe('unreachable');
      const broken = vi.fn(async () => new Response('x', { status: 500 }));
      expect((await makeLocal(broken).probe()).state).toBe('unreachable');
    });
  });

  it('reads the children of an item from the desktop', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      expect(url).toContain('/api/users/0/items/ABCD1234/children');
      expect(url).toContain('limit=100');
      return new Response(JSON.stringify([{ key: 'KID' }]), { status: 200, headers: { 'Total-Results': '1' } });
    });
    const r = await makeLocal(fetchImpl).getItemChildren('ABCD1234', { limit: 100 });
    expect(r.data[0].key).toBe('KID');
  });
});
