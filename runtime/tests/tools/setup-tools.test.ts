import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const launcher = vi.hoisted(() => ({ opened: true, urls: [] as string[] }));
const helper = vi.hoisted(() => ({ result: undefined as unknown, state: 'downloading' }));
vi.mock('../../src/lib/browser-open.js', () => ({
  openInBrowser: async (url: string) => {
    launcher.urls.push(url);
    return launcher.opened;
  },
}));
// Never look for a real uv on the test machine: CI runners may or may not have one.
vi.mock('../../src/lib/search-helper.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/lib/search-helper.js')>()),
  probeSearchHelper: async () => ({ available: true, source: 'path', path: null, run: { posix: 'uv run', powershell: 'uv run' }, can_install: true }),
  INSTALL_WAIT_MS: 10,
  startSearchHelperInstall: () => ({
    state: helper.state,
    result: helper.result,
    promise: helper.result ? Promise.resolve(helper.result) : new Promise(() => {}),
  }),
}));

import openSetup from '../../src/tools/open-setup.js';
import installSearchHelper from '../../src/tools/install-search-helper.js';
import setupStatus from '../../src/tools/setup-status.js';
import { closeSetupSession } from '../../src/lib/setup-session.js';

const ctx = (overrides: Record<string, unknown> = {}) =>
  ({
    config: { apiKey: undefined },
    router: { whoami: () => null, refreshLocal: async () => {} },
    capabilities: { localApi: false, cloud: null },
    ...overrides,
  }) as never;

beforeEach(() => {
  // Point every settings location at an empty folder so the machine's real keys are never read.
  const home = mkdtempSync(join(tmpdir(), 'ai4s-setup-tools-'));
  for (const name of ['HOME', 'USERPROFILE', 'LOCALAPPDATA', 'APPDATA', 'XDG_CONFIG_HOME', 'XDG_DATA_HOME']) {
    vi.stubEnv(name, home);
  }
  vi.stubEnv('LITERATURE_ZOTERO_MCP_ENV_FILE', join(home, 'zotero.env'));
  vi.stubEnv('AI4S_ACADEMIC_CONFIG_FILE', join(home, 'academic.json'));
  vi.stubEnv('AI4S_ONBOARDING_STATE_FILE', join(home, 'state.json'));
  for (const name of ['ZOTERO_API_KEY', 'PUBMED_API_KEY', 'EASYSCHOLAR_SECRET_KEY']) vi.stubEnv(name, '');
  launcher.opened = true;
  launcher.urls.length = 0;
});

afterEach(() => {
  closeSetupSession();
  vi.unstubAllEnvs();
});

describe('setup_status tool', () => {
  it('is read-only, takes no key, and reports a fresh install as ready to search', async () => {
    expect(setupStatus.annotations?.readOnlyHint).toBe(true);
    expect(Object.keys(setupStatus.inputSchema).sort()).toEqual(['language', 'wanted']);
    const result = await setupStatus.handler({}, ctx());
    const body = result.structuredContent as { works_now: Array<{ id: string }>; needs_you: unknown[]; language: string };
    expect(body.language).toBe('zh');
    expect(body.works_now.map((item) => item.id)).toContain('search');
    expect(body.needs_you).toHaveLength(0);
    expect(result.content[0]!.text).toMatch(/^现在可用/);
  });

  it('answers in English when asked and promotes wanted capabilities', async () => {
    const result = await setupStatus.handler({ language: 'en', wanted: ['zotero_save'] }, ctx());
    expect(result.content[0]!.text).toMatch(/^Works now/);
    expect(result.content[0]!.text).toMatch(/Needs you \(1\)/);
    expect((result.structuredContent as { next_action: { type: string } }).next_action.type).toBe('open_setup');
  });

  it('never returns the key the running tools hold', async () => {
    const secret = 'live-key-abcdefghijklmnopqrstuvwxyz';
    const result = await setupStatus.handler(
      {},
      ctx({
        config: { apiKey: secret },
        router: {
          whoami: () => ({ key: secret, userID: 7, username: 'u', access: { user: { write: true } } }),
          refreshLocal: async () => {},
        },
      }),
    );
    expect(JSON.stringify(result)).not.toContain(secret);
    expect(JSON.stringify(result)).not.toContain('"username"');
  });
});

describe('open_setup tool', () => {
  it('takes no key, and says only keys that unlock something are offered', () => {
    expect(Object.keys(openSetup.inputSchema).sort()).toEqual(['keys', 'language']);
    expect(openSetup.description).toMatch(/never ask the user for a key in chat/i);
  });

  it('opens the browser with the code in the fragment and returns no code and no token', async () => {
    const result = await openSetup.handler({ keys: ['zotero'] }, ctx());
    const body = result.structuredContent as Record<string, unknown>;
    expect(body.opened).toBe(true);
    expect(body.keys).toEqual(['zotero']);
    expect(launcher.urls).toHaveLength(1);
    const launched = new URL(launcher.urls[0]!);
    expect(launched.hostname).toBe('127.0.0.1');
    const code = launched.hash.replace(/^#code=/, '');
    expect(code.length).toBeGreaterThan(10);

    const text = JSON.stringify(result);
    expect(text).not.toContain(code);
    expect(body).not.toHaveProperty('fallback_code');
    expect(String(body.url)).not.toContain('#');
    expect(String(body.url)).toBe(`${launched.origin}${launched.pathname}`);
  });

  it('returns the typed code only when the browser could not be opened', async () => {
    launcher.opened = false;
    const result = await openSetup.handler({ language: 'en' }, ctx());
    const body = result.structuredContent as { opened: boolean; fallback_code: string; message: string };
    expect(body.opened).toBe(false);
    expect(body.fallback_code).toBe(new URL(launcher.urls[0]!).hash.replace(/^#code=/, ''));
    expect(body.message).toMatch(/could not open your browser/i);
  });

  it('replaces the previous page rather than leaving two listeners', async () => {
    const first = (await openSetup.handler({}, ctx())).structuredContent as { url: string };
    const second = (await openSetup.handler({}, ctx())).structuredContent as { url: string };
    expect(second.url).not.toBe(first.url);
    await expect(fetch(first.url)).rejects.toThrow();
    expect((await fetch(second.url)).status).toBe(200);
  });
});

describe('install_search_helper tool', () => {
  it('takes no input, and answers "still downloading" instead of blocking the agent', async () => {
    expect(Object.keys(installSearchHelper.inputSchema)).toEqual([]);
    expect(installSearchHelper.annotations?.readOnlyHint).toBe(false);
    helper.result = undefined;
    helper.state = 'downloading';
    const body = (await installSearchHelper.handler({}, ctx())).structuredContent as Record<string, unknown>;
    expect(body).toMatchObject({ state: 'downloading', done: false, run: null });
  });

  it('hands back the command to use, and a plain reason when it fails', async () => {
    const run = { posix: "'/x/uv' run", powershell: "& '/x/uv' run" };
    helper.result = { state: 'installed', python_ready: false, path: '/x/uv', run };
    const ready = (await installSearchHelper.handler({}, ctx())).structuredContent as { run: unknown; message: { en: string } };
    expect(ready.run).toEqual(run);
    expect(ready.message.en).toMatch(/first search also fetches Python/);

    helper.result = { state: 'failed', python_ready: false, path: null, run: null, error: 'could not download the helper from GitHub (503)' };
    const failed = (await installSearchHelper.handler({}, ctx())).structuredContent as { state: string; message: { zh: string; en: string } };
    expect(failed.state).toBe('failed');
    expect(failed.message.en).toMatch(/Reason: could not download/);
    expect(failed.message.zh).toMatch(/原因/);
  });
});
