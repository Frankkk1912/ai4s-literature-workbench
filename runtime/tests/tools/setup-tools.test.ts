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
// Never touch the network from a unit test: the probe module is mocked.
const netProbe = vi.hoisted(() => ({
  calls: 0,
  summary: { checked: true, ok: true, results: [] } as import('../../src/lib/net-probe.js').NetworkSummary,
}));
vi.mock('../../src/lib/net-probe.js', () => ({
  probeNetworkEndpoints: async () => {
    netProbe.calls += 1;
    return netProbe.summary;
  },
  PROBE_TARGETS: [],
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
    expect(Object.keys(setupStatus.inputSchema).sort()).toEqual(['language', 'probe_network', 'wanted']);
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

  it('includes the read-only network self-check by default, and skips it when asked', async () => {
    netProbe.calls = 0;
    netProbe.summary = {
      checked: true,
      ok: false,
      results: [
        {
          name: 'Zotero Web API',
          url: 'https://api.zotero.org/schema',
          optional: false,
          dns: false,
          tls: null,
          ms: 6000,
          http_status: null,
          error_class: 'timeout',
          error: 'no answer within 6s',
        },
      ],
    };
    const probed = await setupStatus.handler({}, ctx());
    expect(netProbe.calls).toBe(1);
    expect((probed.structuredContent as { network: { checked: boolean; ok: boolean } }).network).toMatchObject({ checked: true, ok: false });
    expect(probed.content[0]!.text).toContain('网络自检');

    const skipped = await setupStatus.handler({ probe_network: false }, ctx());
    expect(netProbe.calls).toBe(1); // unchanged: the call was skipped, not repeated
    expect((skipped.structuredContent as { network: { checked: boolean } }).network.checked).toBe(false);
    expect(skipped.content[0]!.text).not.toContain('网络自检');
  });

  it('lists the tools the active profile hides, with concrete switch instructions', async () => {
    const result = await setupStatus.handler(
      {},
      ctx({ hiddenTools: [{ name: 'zotero_create_items', reason: 'workbench_profile' }] }),
    );
    expect((result.structuredContent as { hidden_tools: Array<{ name: string; reason: string }> }).hidden_tools).toEqual([
      { name: 'zotero_create_items', reason: 'workbench_profile' },
    ]);
    expect(result.content[0]!.text).toContain('LITERATURE_ZOTERO_MCP_TOOL_PROFILE 设为 full');
  });

  it('says which tool server answered, with its profile, read-only switch, and write channel', async () => {
    const result = await setupStatus.handler(
      {},
      ctx({ config: { apiKey: undefined, toolProfile: 'workbench', readOnly: true } }),
    );
    const body = result.structuredContent as {
      server: { name: string; version: string; install: string };
      profile: string;
      read_only: boolean;
      write_channel: Record<string, boolean>;
    };
    expect(body.server.name).toBe('ai4s-literature-zotero');
    expect(body.server.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(['plugin', 'desktop_extension', 'unknown']).toContain(body.server.install);
    expect(body.profile).toBe('workbench');
    expect(body.read_only).toBe(true);
    expect(body.write_channel).toEqual({ cloud_key: false, local_desktop: false, read_only: true });
  });

  it('does not call online search available when a required endpoint fails', async () => {
    netProbe.calls = 0;
    netProbe.summary = {
      checked: true,
      ok: false,
      results: [
        {
          name: 'Zotero Web API',
          url: 'https://api.zotero.org/schema',
          optional: false,
          dns: false,
          tls: null,
          ms: 6000,
          http_status: null,
          error_class: 'timeout',
          error: 'no answer within 6s',
        },
      ],
    };
    const result = await setupStatus.handler({}, ctx());
    expect(netProbe.calls).toBe(1);
    const body = result.structuredContent as {
      works_now: Array<{ id: string }>;
      needs_you: Array<{ id: string }>;
      summary: { zh: string; en: string };
    };
    expect(body.works_now.map((item) => item.id)).not.toContain('search');
    expect(body.needs_you.map((item) => item.id)).toContain('search');
    expect(body.summary.zh).not.toContain('可以开始用了');
    expect(body.summary.en).not.toContain('You can start now');
    expect(result.content[0]!.text).toContain('联网检索暂不可用');
  });

  it('warns in the rendered text when the insecure TLS override is on', async () => {
    vi.stubEnv('LITERATURE_TLS_INSECURE', '1');
    const result = await setupStatus.handler({}, ctx());
    expect(result.content[0]!.text).toContain('LITERATURE_TLS_INSECURE');
    expect(result.content[0]!.text).toContain('警告');
    vi.unstubAllEnvs();
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
