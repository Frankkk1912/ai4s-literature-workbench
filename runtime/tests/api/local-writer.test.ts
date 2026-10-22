import { createServer } from 'node:http';
import type { IncomingMessage, Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { LocalWebClient } from '../../src/api/local-writer.js';

// A stand-in for Zotero 10's desktop connection, written from Zotero's local API page.
// It is a real HTTP server so the headers, status codes and bodies cross a real socket.
interface Fake {
  serverId?: string;
  remember: boolean;
  denyDialog: boolean;
  dialogDelayMs: number;
  validKeys: Set<string>;
  authorizeCalls: number;
  writes: Array<{ key?: string; serverId?: string; body: unknown }>;
  seenReadKeys: Array<string | undefined>;
  nextKey: number;
}

const live: Server[] = [];
afterEach(async () => {
  await Promise.all(live.splice(0).map((s) => new Promise((r) => s.close(r))));
});

async function body(req: IncomingMessage): Promise<string> {
  let text = '';
  for await (const chunk of req) text += chunk;
  return text;
}

async function start(over: Partial<Fake> = {}) {
  const fake: Fake = {
    serverId: 'server-1',
    remember: true,
    denyDialog: false,
    dialogDelayMs: 0,
    validKeys: new Set(),
    authorizeCalls: 0,
    writes: [],
    seenReadKeys: [],
    nextKey: 1,
    ...over,
  };
  const server = createServer(async (req, res) => {
    if (fake.serverId) res.setHeader('Zotero-Server-ID', fake.serverId);
    const url = req.url ?? '';
    if (req.method === 'GET') {
      fake.seenReadKeys.push(req.headers['zotero-api-key'] as string | undefined);
      res.setHeader('Last-Modified-Version', '7');
      res.setHeader('Content-Type', 'application/json');
      res.end(url.includes('/items/') ? JSON.stringify({ key: 'ITEM0001', version: 7, data: {} }) : '[]');
      return;
    }
    const text = await body(req);
    if (url === '/api/local/authorize') {
      if (!fake.serverId) { res.statusCode = 404; res.end(); return; }
      if (req.headers['zotero-server-id'] !== fake.serverId) { res.statusCode = 428; res.end(); return; }
      fake.authorizeCalls += 1;
      await new Promise((r) => setTimeout(r, fake.dialogDelayMs));
      if (fake.denyDialog) { res.statusCode = 403; res.end(JSON.stringify({ denied: true })); return; }
      const key = `localkey${String(fake.nextKey++).padStart(25, '0')}`;
      fake.validKeys.add(key);
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ key, remember: fake.remember }));
      return;
    }
    const key = req.headers['zotero-api-key'] as string | undefined;
    if (!key || !fake.validKeys.has(key)) { res.statusCode = 401; res.end(); return; }
    if (req.headers['zotero-server-id'] !== fake.serverId) { res.statusCode = 412; res.end(); return; }
    if (!fake.remember) fake.validKeys.delete(key);
    fake.writes.push({ key, serverId: req.headers['zotero-server-id'] as string, body: JSON.parse(text) });
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Last-Modified-Version', '8');
    res.end(JSON.stringify({ successful: { '0': { key: 'NEWITEM1', version: 8 } }, unchanged: {}, failed: {} }));
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  live.push(server);
  const port = (server.address() as AddressInfo).port;
  return { fake, port, client: new LocalWebClient({ port, requestTimeoutMs: 1000, authorizeTimeoutMs: 2000 }) };
}

const lib = { type: 'user' as const, id: 0 };

describe('saving through the desktop connection (Zotero 10)', () => {
  it('asks once, then saves with the write key and the server id', async () => {
    const { fake, client } = await start();
    const result = await client.writeItems(lib, [{ itemType: 'note', note: 'x' }]);
    expect(result.successful[0]).toMatchObject({ key: 'NEWITEM1', version: 8 });
    expect(fake.authorizeCalls).toBe(1);
    expect(fake.writes[0]!.serverId).toBe('server-1');
    expect(fake.writes[0]!.key).toMatch(/^localkey/);
  });

  it('reuses a remembered key for later writes, and asks only once for concurrent ones', async () => {
    const { fake, client } = await start({ dialogDelayMs: 50 });
    await Promise.all([client.writeItems(lib, [{ itemType: 'note' }]), client.writeItems(lib, [{ itemType: 'note' }])]);
    await client.writeItems(lib, [{ itemType: 'note' }]);
    expect(fake.authorizeCalls).toBe(1);
    expect(fake.writes).toHaveLength(3);
  });

  it('asks again for every write when Zotero hands out single-use keys', async () => {
    const { fake, client } = await start({ remember: false });
    await client.writeItems(lib, [{ itemType: 'note' }]);
    await client.writeItems(lib, [{ itemType: 'note' }]);
    expect(fake.authorizeCalls).toBe(2);
  });

  it('asks again once when a key stops working', async () => {
    const { fake, client } = await start();
    await client.writeItems(lib, [{ itemType: 'note' }]);
    fake.validKeys.clear();
    await client.writeItems(lib, [{ itemType: 'note' }]);
    expect(fake.authorizeCalls).toBe(2);
    expect(fake.writes).toHaveLength(2);
  });

  it('keeps asking the user\'s patience: a slow answer to the dialog is not a timeout', async () => {
    const { client } = await start({ dialogDelayMs: 300 });
    const patient = new LocalWebClient({ port: Number(new URL((client as any).baseUrl).port), requestTimeoutMs: 100, authorizeTimeoutMs: 2000 });
    await expect(patient.writeItems(lib, [{ itemType: 'note' }])).resolves.toBeTruthy();
  });

  it('says so plainly when the user declines', async () => {
    const { fake, client } = await start({ denyDialog: true });
    await expect(client.writeItems(lib, [{ itemType: 'note' }])).rejects.toThrow(/declined the request in Zotero/);
    expect(fake.writes).toHaveLength(0);
  });

  it('says to update or add a key on Zotero 9 and earlier, and never asks', async () => {
    const { fake, client } = await start({ serverId: undefined });
    await expect(client.writeItems(lib, [{ itemType: 'note' }])).rejects.toThrow(/Zotero 10 or later/);
    expect(fake.authorizeCalls).toBe(0);
  });

  it('says to open Zotero when nothing answers', async () => {
    const closed = new LocalWebClient({ port: 1, requestTimeoutMs: 500 });
    await expect(closed.writeItems(lib, [{ itemType: 'note' }])).rejects.toThrow(/Zotero is not open/);
  });

  it('follows a restart of Zotero (new server id) without a failure', async () => {
    const { fake, client } = await start();
    await client.writeItems(lib, [{ itemType: 'note' }]);
    fake.serverId = 'server-2';
    fake.validKeys.clear();
    await expect(client.writeItems(lib, [{ itemType: 'note' }])).resolves.toBeTruthy();
    expect(fake.writes.at(-1)!.serverId).toBe('server-2');
  });

  it('sends no key with reads and does not trigger the dialog', async () => {
    const { fake, client } = await start();
    await client.getItem(lib, 'ITEM0001');
    await client.listCollections(lib);
    expect(fake.authorizeCalls).toBe(0);
    expect(fake.seenReadKeys.every((k) => k === undefined)).toBe(true);
  });

  it('never puts the write key in an error message', async () => {
    const { fake, client } = await start();
    await client.writeItems(lib, [{ itemType: 'note' }]);
    const key = [...fake.validKeys][0]!;
    fake.serverId = undefined; // now Zotero "downgrades": a write must fail
    fake.validKeys.clear();
    const err = await client.writeItems(lib, [{ itemType: 'note' }]).catch((e) => e as Error);
    expect(String((err as Error).message)).not.toContain(key);
  });

  it('is not a key-holder: the router still treats it as having no Zotero key', async () => {
    const { client } = await start();
    expect(client.hasKey).toBe(false);
    expect(client.canWrite).toBe(true);
  });
});
