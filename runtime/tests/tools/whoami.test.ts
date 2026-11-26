import { describe, it, expect } from 'vitest';
import whoami from '../../src/tools/whoami.js';
import { SERVER_NAME } from '../../src/lib/server-identity.js';

function ctxWith(cloud: any, overrides: Record<string, unknown> = {}) {
  return {
    router: {
      whoami: () => cloud,
      defaultLibrary: () => ({ type: 'user', id: cloud?.userID ?? 0 }),
    },
    capabilities: { cloud, localApi: true, localServerId: 'zotero-10-server-id' },
    config: { toolProfile: 'workbench', readOnly: true },
    hiddenTools: [
      { name: 'zotero_create_items', reason: 'workbench_profile' },
      { name: 'zotero_update_items', reason: 'read_only' },
    ],
    ...overrides,
  } as any;
}

describe('zotero_whoami', () => {
  it('returns the resolved identity and access', async () => {
    const res = await whoami.handler(
      {},
      ctxWith({ userID: 19552201, username: 'oscardvs', access: { user: { write: true } } }),
    );
    expect(res.isError).toBeUndefined();
    expect(res.structuredContent?.userID).toBe(19552201);
    expect(res.content[0].text).toMatch(/oscardvs/);
  });

  it('reports local-only mode when no cloud key is configured', async () => {
    const res = await whoami.handler({}, ctxWith(null));
    expect(res.structuredContent?.cloud).toBe(false);
    expect(res.content[0].text).toMatch(/local/i);
  });

  it('identifies which tool server answered, its profile, and its write channel', async () => {
    const res = await whoami.handler(
      {},
      ctxWith({ userID: 19552201, username: 'oscardvs', access: { user: { write: true } } }),
    );
    const body = res.structuredContent as Record<string, any>;
    expect(body.server).toMatchObject({ name: SERVER_NAME });
    expect(body.server.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(['plugin', 'desktop_extension', 'unknown']).toContain(body.server.install);
    expect(body.profile).toBe('workbench');
    expect(body.read_only).toBe(true);
    // A working cloud key with write access and a Zotero 10 desktop connection.
    expect(body.write_channel).toEqual({ cloud_key: true, local_desktop: true, read_only: true });
    expect(body.hidden_tools).toEqual([
      { name: 'zotero_create_items', reason: 'workbench_profile' },
      { name: 'zotero_update_items', reason: 'read_only' },
    ]);
    expect(res.content[0].text).toContain(SERVER_NAME);
    expect(res.content[0].text).toMatch(/read-only/);
  });

  it('with no key and no local save, the write channel is honestly empty', async () => {
    const res = await whoami.handler(
      {},
      ctxWith(null, {
        capabilities: { cloud: null, localApi: true, localServerId: undefined },
        config: { toolProfile: 'full', readOnly: false },
        hiddenTools: [],
      }),
    );
    const body = res.structuredContent as Record<string, any>;
    expect(body.profile).toBe('full');
    expect(body.write_channel).toEqual({ cloud_key: false, local_desktop: false, read_only: false });
    expect(body.hidden_tools).toEqual([]);
    expect(res.content[0].text).not.toMatch(/read-only\)/);
  });
});
