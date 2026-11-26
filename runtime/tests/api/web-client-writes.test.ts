import { describe, it, expect, vi } from 'vitest';
import { WebApiClient } from '../../src/api/web-client.js';
import { RateLimitedFetcher } from '../../src/api/http.js';

function makeClient(fetchImpl: any) {
  return new WebApiClient({ apiKey: 'KEY', fetcher: new RateLimitedFetcher({ fetchImpl, maxConcurrency: 4 }) });
}

const lib = { type: 'user', id: 19552201 } as const;

describe('WebApiClient writes', () => {
  it('create batch sends a Zotero-Write-Token and parses successful', async () => {
    let sentHeaders: Record<string, string> = {};
    const fetchImpl = vi.fn(async (url: string, init: RequestInit) => {
      sentHeaders = init.headers as Record<string, string>;
      expect(init.method).toBe('POST');
      const body = JSON.parse(init.body as string);
      expect(body).toHaveLength(1);
      return new Response(
        JSON.stringify({ successful: { '0': { key: 'NEW1', version: 5 } }, success: { '0': 'NEW1' } }),
        { status: 200, headers: { 'Last-Modified-Version': '5' } },
      );
    });
    const r = await makeClient(fetchImpl).writeItems(lib, [{ itemType: 'book', title: 'T' }]);
    expect(sentHeaders['Zotero-Write-Token']).toMatch(/^[0-9a-f]{32}$/);
    expect(sentHeaders['If-Unmodified-Since-Version']).toBeUndefined();
    expect(r.successful[0]).toEqual({ index: 0, key: 'NEW1', version: 5 });
    expect(r.newLibraryVersion).toBe(5);
  });

  it('all-update batch relies on per-object version (no token, no precondition header)', async () => {
    let sentHeaders: Record<string, string> = {};
    const fetchImpl = vi.fn(async (_url: string, init: RequestInit) => {
      sentHeaders = init.headers as Record<string, string>;
      return new Response(JSON.stringify({ failed: { '0': { key: 'K1', code: 412, message: 'conflict' } } }), {
        status: 200,
        headers: { 'Last-Modified-Version': '9' },
      });
    });
    const r = await makeClient(fetchImpl).writeItems(lib, [{ key: 'K1', version: 3, deleted: 1 }]);
    expect(sentHeaders['Zotero-Write-Token']).toBeUndefined();
    expect(sentHeaders['If-Unmodified-Since-Version']).toBeUndefined();
    expect(r.failed[0]).toMatchObject({ index: 0, code: 412 });
  });

  it('auto-chunks more than 50 objects into multiple POSTs with merged indices', async () => {
    let posts = 0;
    const fetchImpl = vi.fn(async (_url: string, init: RequestInit) => {
      posts++;
      const body = JSON.parse(init.body as string) as any[];
      const successful: Record<string, any> = {};
      body.forEach((_, i) => (successful[String(i)] = { key: `K${posts}_${i}`, version: 1 }));
      return new Response(JSON.stringify({ successful }), {
        status: 200,
        headers: { 'Last-Modified-Version': '1' },
      });
    });
    const objects = Array.from({ length: 60 }, (_, i) => ({ itemType: 'book', title: `t${i}` }));
    const r = await makeClient(fetchImpl).writeItems(lib, objects);
    expect(posts).toBe(2);
    expect(r.successful).toHaveLength(60);
    expect(r.successful.map((s) => s.index)).toEqual(Array.from({ length: 60 }, (_, i) => i));
  });

  it('patchItem sends If-Unmodified-Since-Version and returns the new version', async () => {
    const fetchImpl = vi.fn(async (url: string, init: RequestInit) => {
      expect(init.method).toBe('PATCH');
      expect(url).toContain('/users/19552201/items/ABCD');
      expect((init.headers as Record<string, string>)['If-Unmodified-Since-Version']).toBe('3');
      return new Response(null, { status: 204, headers: { 'Last-Modified-Version': '4' } });
    });
    const v = await makeClient(fetchImpl).patchItem(lib, 'ABCD', { title: 'New' }, 3);
    expect(v).toBe(4);
  });

  it('patchItem throws an actionable 412 on stale version', async () => {
    const fetchImpl = vi.fn(
      async () => new Response('conflict', { status: 412, headers: { 'Last-Modified-Version': '9' } }),
    );
    await expect(makeClient(fetchImpl).patchItem(lib, 'ABCD', { title: 'x' }, 3)).rejects.toThrow(
      /changed on the server/i,
    );
  });

  it('does not notify the router for failed or unchanged-only batches', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ failed: { 0: { code: 412, message: 'conflict' } } }), { headers: { 'Last-Modified-Version': '9' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ unchanged: { 0: 'K1' } }), { headers: { 'Last-Modified-Version': '9' } }))
      .mockResolvedValueOnce(new Response('conflict', { status: 412 }));
    const client = makeClient(fetchImpl);
    const listener = vi.fn();
    client.onCloudWrite(listener);
    await client.writeItems(lib, [{ key: 'K1', version: 3 }]);
    await client.writeItems(lib, [{ key: 'K1', version: 9 }]);
    await expect(client.patchItem(lib, 'K1', { title: 'T' }, 3)).rejects.toThrow();
    expect(listener).not.toHaveBeenCalled();
  });

  it('notifies for a partially successful batch, even if a later chunk fails', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ successful: { 0: { key: 'K1', version: 10 } }, failed: { 1: { code: 400, message: 'invalid' } } }), { headers: { 'Last-Modified-Version': '10' } }))
      .mockResolvedValueOnce(new Response('conflict', { status: 412 }));
    const client = makeClient(fetchImpl);
    const listener = vi.fn();
    client.onCloudWrite(listener);
    await expect(client.writeItems(lib, Array.from({ length: 51 }, () => ({ title: 'T' })))).rejects.toThrow();
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith(lib, 10);
  });

  it('uses a pending marker when a successful write has no version header', async () => {
    const client = makeClient(vi.fn(async () => new Response(null, { status: 204 })));
    const listener = vi.fn();
    client.onCloudWrite(listener);
    await client.patchItem(lib, 'K1', { deleted: 1 }, 3);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith(lib, 0);
  });

  it('does not report writes to a custom endpoint as cloud writes', async () => {
    const client = new WebApiClient({ baseUrl: 'https://example.test', fetcher: new RateLimitedFetcher({ fetchImpl: vi.fn(async () => new Response(null, { status: 204 })) }) });
    const listener = vi.fn();
    client.onCloudWrite(listener);
    await client.patchItem(lib, 'K1', { title: 'T' }, 3);
    expect(client.isCloud).toBe(false);
    expect(listener).not.toHaveBeenCalled();
  });

  it('deleteItems sends a comma itemKey list and the precondition header', async () => {
    const fetchImpl = vi.fn(async (url: string, init: RequestInit) => {
      expect(init.method).toBe('DELETE');
      expect(url).toContain('itemKey=AAA,BBB');
      expect((init.headers as Record<string, string>)['If-Unmodified-Since-Version']).toBe('100');
      return new Response(null, { status: 204 });
    });
    await makeClient(fetchImpl).deleteItems(lib, ['AAA', 'BBB'], 100);
    expect(fetchImpl).toHaveBeenCalledOnce();
  });
});
