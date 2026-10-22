import { describe, it, expect, vi } from 'vitest';
import { LibraryRouter } from '../../src/router/library-router.js';
import { loadConfig } from '../../src/config.js';
import { LocalApiError } from '../../src/api/local-client.js';

const cloudInfo = { userID: 19552201, username: 'oscardvs', access: {} };

function makeRouter(opts: { local: 'auto' | 'on' | 'off'; localApi: boolean; hasKey?: boolean; now?: () => number }) {
  const web = {
    hasKey: opts.hasKey ?? true,
    listItems: vi.fn(async () => ({ data: [{ key: 'CLOUD' }], totalResults: 1, lastModifiedVersion: 1 })),
    getItem: vi.fn(async () => ({ key: 'CLOUD' })),
  };
  const local = {
    listItems: vi.fn(async () => ({ data: [{ key: 'LOCAL' }], totalResults: 1, lastModifiedVersion: 1 })),
    getItem: vi.fn(async () => ({ key: 'LOCAL' })),
    getItemChildren: vi.fn(async () => ({ data: [{ key: 'KID' }], totalResults: 1, lastModifiedVersion: 1 })),
    probe: vi.fn(async () => ({ state: opts.localApi ? 'ok' : 'unreachable' })),
  };
  const cfg = loadConfig({ ZOTEUS_LOCAL: opts.local } as any);
  const capabilities: any = { cloud: cloudInfo as any, localApi: opts.localApi };
  const router = new LibraryRouter({
    config: cfg,
    capabilities,
    web: web as any,
    local: local as any,
    now: opts.now,
  });
  return { router, web, local, capabilities };
}

describe('LibraryRouter', () => {
  it('reads from the local API when available and not disabled', async () => {
    const { router, web, local } = makeRouter({ local: 'auto', localApi: true });
    const r = await router.searchItems({ q: 'x' });
    expect(r.data[0].key).toBe('LOCAL');
    expect(local.listItems).toHaveBeenCalled();
    expect(web.listItems).not.toHaveBeenCalled();
  });

  it('falls back to the cloud when local is unavailable', async () => {
    const { router, web } = makeRouter({ local: 'auto', localApi: false });
    const r = await router.searchItems({ q: 'x' });
    expect(r.data[0].key).toBe('CLOUD');
    expect(web.listItems).toHaveBeenCalled();
  });

  it('always uses the cloud for an explicit group library', async () => {
    const { router, web, local } = makeRouter({ local: 'auto', localApi: true });
    await router.searchItems({ q: 'x', library: { type: 'group', id: 999 } });
    expect(web.listItems).toHaveBeenCalled();
    expect(local.listItems).not.toHaveBeenCalled();
  });

  it('defaultLibrary uses the resolved cloud userID', () => {
    const { router } = makeRouter({ local: 'auto', localApi: true });
    expect(router.defaultLibrary()).toEqual({ type: 'user', id: 19552201 });
  });

  it('reads children from the desktop connection too, so no key is needed for them', async () => {
    const { router, web, local } = makeRouter({ local: 'auto', localApi: true });
    const r = await router.getItemChildren('ABC');
    expect(r.data[0].key).toBe('KID');
    expect(local.getItemChildren).toHaveBeenCalledWith('ABC', {});
    expect(web.getItemChildren).toBeUndefined();
  });

  describe('Zotero opened after the tools started', () => {
    it('looks again once the interval has passed, then reads from the desktop', async () => {
      let clock = 1_000_000;
      const { router, web, local, capabilities } = makeRouter({ local: 'auto', localApi: false, now: () => clock });
      await router.searchItems({ q: 'x' });
      expect(web.listItems).toHaveBeenCalledTimes(1);
      // Within the interval it does not probe again.
      expect(local.probe).not.toHaveBeenCalled();
      local.probe.mockResolvedValue({ state: 'ok', serverId: undefined });
      clock += 25_000;
      const r = await router.searchItems({ q: 'x' });
      expect(local.probe).toHaveBeenCalledTimes(1);
      expect(r.data[0].key).toBe('LOCAL');
      expect(capabilities.localApi).toBe(true);
      expect(capabilities.localState).toBe('ok');
    });

    it('makes one probe for many concurrent reads', async () => {
      let clock = 0;
      const { router, local } = makeRouter({ local: 'auto', localApi: false, now: () => clock });
      clock += 30_000;
      await Promise.all([router.searchItems({}), router.searchItems({}), router.searchItems({})]);
      expect(local.probe).toHaveBeenCalledTimes(1);
    });

    it('never probes when the desktop connection is switched off', async () => {
      let clock = 0;
      const { router, local } = makeRouter({ local: 'off', localApi: false, now: () => clock });
      clock += 60_000;
      await router.searchItems({});
      expect(local.probe).not.toHaveBeenCalled();
    });
  });

  describe('Zotero closed or changed mid-session', () => {
    it('falls back to the cloud when the desktop connection stops answering', async () => {
      const { router, web, local, capabilities } = makeRouter({ local: 'auto', localApi: true });
      local.listItems.mockRejectedValue(new TypeError('fetch failed'));
      const r = await router.searchItems({ q: 'x' });
      expect(r.data[0].key).toBe('CLOUD');
      expect(web.listItems).toHaveBeenCalled();
      expect(capabilities.localApi).toBe(false);
    });

    it('returns an answer about the data as it is instead of asking the cloud', async () => {
      const { router, web, local } = makeRouter({ local: 'auto', localApi: true });
      local.getItem.mockRejectedValue(new LocalApiError(404, '/items/NOPE'));
      await expect(router.getItem('NOPE')).rejects.toThrow(/404/);
      expect(web.getItem).not.toHaveBeenCalled();
    });

    it('treats a 403 (setting switched off) as the connection going away', async () => {
      const { router, local, capabilities } = makeRouter({ local: 'auto', localApi: true, hasKey: false });
      local.listItems.mockRejectedValue(new LocalApiError(403, '/items'));
      await expect(router.searchItems({})).rejects.toThrow(/not allowing other applications/);
      expect(capabilities.localState).toBe('forbidden');
    });
  });

  describe('with no key and no desktop connection', () => {
    it('tells the user to open Zotero and tick the setting', async () => {
      const { router, web } = makeRouter({ local: 'auto', localApi: false, hasKey: false });
      await expect(router.searchItems({})).rejects.toThrow(/Open Zotero.*Allow other applications on this computer to communicate with Zotero/s);
      expect(web.listItems).not.toHaveBeenCalled();
    });

    it('still lets a group library go to the cloud', async () => {
      const { router, web } = makeRouter({ local: 'auto', localApi: false, hasKey: false });
      await router.searchItems({ library: { type: 'group', id: 5 } });
      expect(web.listItems).toHaveBeenCalled();
    });
  });
});
