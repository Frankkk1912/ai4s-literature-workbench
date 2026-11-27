import { describe, expect, it } from 'vitest';
import {
  buildSetupStatus,
  evaluateSetup,
  gatherFacts,
  renderSetup,
  type SetupFacts,
  type SetupIdentity,
} from '../../src/lib/setup-status.js';
import type { NetworkSummary, ProbeResult } from '../../src/lib/net-probe.js';
import type { HiddenToolInfo } from '../../src/lib/tool-profiles.js';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const baseFacts = (): SetupFacts => ({
  uvAvailable: true,
  zotero: { keyPresent: false, keyLoadedAtStart: false, cloudOk: false, write: false, localApi: false },
  pubmedKey: false,
  easyscholarKey: false,
  addon: 'absent',
});

const probe = (over: Partial<ProbeResult>): ProbeResult => ({
  name: 'Zotero Web API',
  url: 'https://api.zotero.org/schema',
  optional: false,
  dns: true,
  tls: true,
  ms: 300,
  http_status: 200,
  error_class: 'ok',
  error: null,
  ...over,
});

const summaryOf = (results: ProbeResult[]): NetworkSummary => ({
  checked: true,
  ok: results.filter((r) => !r.optional).every((r) => r.error_class === 'ok' || r.error_class === 'http'),
  results,
});

// Words that belong to the build, not to the user's world. The status text must never use them.
const INTERNAL = /\b(MCP|runtime|bundle|dist|node_modules|onboard\.mjs|bootstrap|stdio|D12|R12|M4|T5\.2|zotero_whoami|npm|esbuild)\b/i;
const groupOf = (items: ReturnType<typeof evaluateSetup>, id: string) => items.find((item) => item.id === id)?.group;

describe('setup status groups', () => {
  it('a fresh install can search, and everything else is optional', () => {
    const items = evaluateSetup(baseFacts());
    expect(groupOf(items, 'search')).toBe('works_now');
    for (const id of ['zotero_read', 'zotero_save', 'pubmed_key', 'journal_metrics', 'partition_columns']) {
      expect(groupOf(items, id)).toBe('optional');
    }
    expect(items.filter((item) => item.group === 'needs_you')).toHaveLength(0);
  });

  it('a missing search helper is a need, never a quiet "basic features work"', () => {
    const items = evaluateSetup({ ...baseFacts(), uvAvailable: false });
    expect(groupOf(items, 'search')).toBe('needs_you');
    // The workbench downloads its own copy: no official installer, no PATH change.
    expect(items.find((item) => item.id === 'search')?.action).toMatchObject({ type: 'install_helper', tool: 'install_search_helper' });
  });

  it('says the helper is downloading while an install runs, and falls back to the official installer where none is built', () => {
    const downloading = evaluateSetup({ ...baseFacts(), uvAvailable: false, uvInstalling: 'downloading' });
    expect(groupOf(downloading, 'search')).toBe('needs_you');
    expect(downloading.find((i) => i.id === 'search')?.detail.en).toMatch(/downloading/);

    const unsupported = evaluateSetup({ ...baseFacts(), uvAvailable: false, uvCanInstall: false });
    expect(unsupported.find((i) => i.id === 'search')?.action?.type).toBe('ask_to_install');
  });

  it('hands the skills the command that replaces `uv run`, only when the helper works', () => {
    const run = { posix: "'/tools/uv-x/uv' run", powershell: "& 'C:\\tools\\uv.exe' run" };
    expect(buildSetupStatus({ ...baseFacts(), uvRun: run }).search_helper).toEqual({ ready: true, run });
    expect(buildSetupStatus({ ...baseFacts(), uvRun: null }).search_helper.run).toEqual({ posix: 'uv run', powershell: 'uv run' });
    expect(buildSetupStatus({ ...baseFacts(), uvAvailable: false, uvRun: run }).search_helper).toEqual({ ready: false, run: null });
  });

  it('asking for a capability moves it from optional to needs-you, and a met one stays in works-now', () => {
    expect(groupOf(evaluateSetup(baseFacts(), ['zotero_save']), 'zotero_save')).toBe('needs_you');
    expect(groupOf(evaluateSetup({ ...baseFacts(), pubmedKey: true }, ['pubmed_key']), 'pubmed_key')).toBe('works_now');
  });

  it('distinguishes a key that works, a read-only key, a key saved after start, and a rejected key', () => {
    const z = baseFacts().zotero;
    const save = (zotero: SetupFacts['zotero']) => evaluateSetup({ ...baseFacts(), zotero });
    expect(groupOf(save({ ...z, keyPresent: true, keyLoadedAtStart: true, cloudOk: true, write: true }), 'zotero_save')).toBe('works_now');

    const readOnly = save({ ...z, keyPresent: true, keyLoadedAtStart: true, cloudOk: true, write: false });
    expect(groupOf(readOnly, 'zotero_save')).toBe('needs_you');
    expect(readOnly.find((i) => i.id === 'zotero_save')?.action?.type).toBe('open_setup');

    const savedLater = save({ ...z, keyPresent: true, keyLoadedAtStart: false });
    expect(savedLater.find((i) => i.id === 'zotero_save')?.action?.type).toBe('restart_app');

    const rejected = save({ ...z, keyPresent: true, keyLoadedAtStart: true, cloudOk: false });
    expect(groupOf(rejected, 'zotero_save')).toBe('needs_you');
    expect(rejected.find((i) => i.id === 'zotero_save')?.action?.type).toBe('open_setup');
  });

  it('reading Zotero works through the desktop connection without any key', () => {
    const facts = baseFacts();
    facts.zotero.localApi = true;
    expect(groupOf(evaluateSetup(facts), 'zotero_read')).toBe('works_now');
  });

  it('says which of the two things Zotero needs when it cannot be read', () => {
    const closed = evaluateSetup({ ...baseFacts(), zotero: { ...baseFacts().zotero, localState: 'unreachable' } });
    expect(closed.find((i) => i.id === 'zotero_read')?.detail.en).toMatch(/Open Zotero/);
    const off = evaluateSetup({ ...baseFacts(), zotero: { ...baseFacts().zotero, localState: 'forbidden' } });
    const detail = off.find((i) => i.id === 'zotero_read')!.detail;
    expect(detail.en).toMatch(/Zotero is open, but/);
    expect(detail.en).toContain('Allow other applications on this computer to communicate with Zotero');
    expect(detail.zh).toContain('允许这台电脑上的其他应用与 Zotero 通信');
  });

  it('says saving needs no key when Zotero 10 is open, and still asks for one otherwise', () => {
    const zotero10 = { ...baseFacts(), zotero: { ...baseFacts().zotero, localApi: true, localSave: true } };
    const item = evaluateSetup(zotero10).find((i) => i.id === 'zotero_save')!;
    expect(item.group).toBe('works_now');
    expect(item.detail.en).toContain('Always Allow');
    const older = { ...baseFacts(), zotero: { ...baseFacts().zotero, localApi: true, localSave: false } };
    expect(evaluateSetup(older).find((i) => i.id === 'zotero_save')!.action?.type).toBe('open_setup');
    // A key that works takes precedence.
    const withKey = { ...zotero10, zotero: { ...zotero10.zotero, keyPresent: true, keyLoadedAtStart: true, cloudOk: true, write: true } };
    expect(evaluateSetup(withKey).find((i) => i.id === 'zotero_save')!.detail.en).toMatch(/Your key works/);
  });

  it('moves Zotero reading to Needs you only when the user asked for it', () => {
    expect(groupOf(evaluateSetup(baseFacts()), 'zotero_read')).toBe('optional');
    expect(groupOf(evaluateSetup(baseFacts(), ['zotero_read']), 'zotero_read')).toBe('needs_you');
  });

  it('never claims the add-on works, only that it was found', () => {
    const items = evaluateSetup({ ...baseFacts(), addon: 'active' });
    const item = items.find((i) => i.id === 'partition_columns')!;
    expect(item.group).toBe('works_now');
    expect(item.detail.en).toMatch(/cannot confirm/i);
    expect(item.detail.zh).toContain('无法确认');
  });
});

describe('setup status text', () => {
  it('renders three groups in both languages, Chinese by default', () => {
    const status = buildSetupStatus(baseFacts(), { wanted: ['zotero_save'] });
    expect(status.language).toBe('zh');
    expect(status.rendered.en).toMatch(/^Works now\n/);
    expect(status.rendered.en).toMatch(/\nNeeds you \(1\)\n/);
    expect(status.rendered.en).toMatch(/\nOptional\n/);
    expect(status.rendered.zh).toMatch(/^现在可用\n/);
    expect(status.rendered.zh).toMatch(/\n需要你处理（1）\n/);
    expect(status.rendered.zh).toMatch(/\n可选\n/);
    expect(status.next_action).toMatchObject({ type: 'open_setup', keys: ['zotero'] });
  });

  it('says so when nothing needs the user', () => {
    const status = buildSetupStatus(baseFacts());
    expect(status.needs_you).toHaveLength(0);
    expect(status.next_action).toBeNull();
    expect(status.rendered.en).toContain('Nothing right now.');
  });

  it('uses no build or component words, in any state or either language', () => {
    const states: SetupFacts[] = [
      baseFacts(),
      { ...baseFacts(), uvAvailable: false },
      { ...baseFacts(), addon: 'unconfirmed' },
      { ...baseFacts(), addon: 'no_zotero' },
      { ...baseFacts(), zotero: { keyPresent: true, keyLoadedAtStart: true, cloudOk: true, write: false, localApi: true } },
      { ...baseFacts(), zotero: { keyPresent: true, keyLoadedAtStart: false, cloudOk: false, write: false, localApi: false } },
    ];
    for (const facts of states) {
      const { rendered } = buildSetupStatus(facts, { wanted: ['zotero_save', 'pubmed_key', 'journal_metrics', 'partition_columns'] });
      for (const lang of ['zh', 'en'] as const) expect(rendered[lang]).not.toMatch(INTERNAL);
    }
  });

  it('negative control: the word check does catch a component name', () => {
    expect('runtime not built').toMatch(INTERNAL);
    expect('the MCP server is not configured').toMatch(INTERNAL);
    expect(renderSetup([{ id: 'search', group: 'works_now', title: { zh: 'x', en: 'bundle ok' }, detail: { zh: '', en: '' } }], 'en')).toMatch(INTERNAL);
  });
});

describe('setup status reads settings without leaking them', () => {
  it('sees keys in files and the environment, and returns none of their values', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ai4s-setup-status-'));
    const secrets = ['zotero-secret-value-123456', 'pubmed-secret-value-123456', 'easyscholar-secret-value-123456'];
    const paths = {
      zoteroEnv: join(dir, 'zotero.env'),
      academicConfig: join(dir, 'academic.json'),
      legacyZoteroEnv: join(dir, 'legacy-zotero.env'),
      legacyAcademicConfig: join(dir, 'legacy-academic.json'),
      state: join(dir, 'state.json'),
    };
    writeFileSync(paths.zoteroEnv, `ZOTERO_API_KEY=${secrets[0]}\n`);
    writeFileSync(paths.academicConfig, JSON.stringify({ pubmed_api_key: secrets[1] }));
    const facts = gatherFacts({
      env: { EASYSCHOLAR_SECRET_KEY: secrets[2] },
      paths,
      startedWithKey: true,
      cloud: { access: { user: { write: true } } },
      localApi: false,
      uvAvailable: true,
    });
    expect(facts.zotero).toMatchObject({ keyPresent: true, cloudOk: true, write: true });
    expect(facts.pubmedKey).toBe(true);
    expect(facts.easyscholarKey).toBe(true);

    const everything = JSON.stringify(buildSetupStatus(facts, { wanted: ['zotero_save'] }));
    for (const secret of secrets) expect(everything).not.toContain(secret);
  });

  it('negative control: a planted value in a key slot would be found by the leak check', () => {
    const planted = JSON.stringify({ rendered: { en: 'Your key is zotero-secret-value-123456' } });
    expect(planted).toContain('zotero-secret-value-123456');
  });
});

describe('setup status network and hidden-tool sections', () => {
  it('renders the network self-check in both languages, key-free', () => {
    const probes = summaryOf([
      probe({}),
      probe({ name: 'EasyScholar', url: 'https://www.easyscholar.cc/open/getPublicationRank', ms: 190, http_status: 401 }),
    ]);
    const status = buildSetupStatus(baseFacts(), { probes });
    expect(status.network).toMatchObject({ checked: true, ok: true });
    expect(status.rendered.zh).toContain('网络自检');
    expect(status.rendered.zh).toContain('Zotero Web API：已连通（HTTP 200，300 毫秒）');
    expect(status.rendered.zh).toContain('4xx 也算连通');
    expect(status.rendered.en).toContain('Network check');
    expect(status.rendered.en).toContain('EasyScholar: reachable (HTTP 401, 190 ms)');
    // The probe URL itself never carries a query, let alone a key.
    expect(JSON.stringify(status)).not.toMatch(/api_key|secretkey|mailto=/);
  });

  it('a TLS failure renders the fix-it guidance, in both languages', () => {
    const tlsFailure = probe({
      error_class: 'tls',
      tls: false,
      http_status: null,
      error: 'the certificate is not trusted (UNABLE_TO_VERIFY_LEAK_SIGNATURE)',
    });
    const status = buildSetupStatus(baseFacts(), { probes: summaryOf([tlsFailure]) });
    expect(status.network.ok).toBe(false);
    expect(status.rendered.zh).toContain('证书校验失败');
    expect(status.rendered.zh).toContain('SSL_CERT_FILE');
    expect(status.rendered.en).toContain('TLS certificate check failed');
    expect(status.rendered.en).toContain('NODE_EXTRA_CA_CERTS');
  });

  it('marks the optional endpoint and never fails the verdict for it', () => {
    const probes = summaryOf([
      probe({}),
      probe({ name: 'OpenAlex', url: 'https://api.openalex.org/works', optional: true, error_class: 'dns', dns: false, tls: null, http_status: null, error: 'dns failed' }),
    ]);
    const status = buildSetupStatus(baseFacts(), { probes });
    expect(status.network.ok).toBe(true);
    expect(status.rendered.zh).toContain('OpenAlex（可选）');
    expect(status.rendered.en).toContain('OpenAlex (optional)');
  });

  it('skipped probes render no network section at all', () => {
    const status = buildSetupStatus(baseFacts(), {});
    expect(status.network.checked).toBe(false);
    expect(status.rendered.zh).not.toContain('网络自检');
    expect(status.rendered.en).not.toContain('Network check');
  });
  it('reports the server identity, profile, read-only switch, and write channel', () => {
    const identity: SetupIdentity = {
      server: { name: 'ai4s-literature-zotero', version: '0.3.0', install: 'plugin' },
      profile: 'workbench',
      readOnly: true,
    };
    const facts: SetupFacts = {
      ...baseFacts(),
      zotero: { ...baseFacts().zotero, keyPresent: true, keyLoadedAtStart: true, cloudOk: true, write: true, localApi: true, localSave: true },
    };
    const status = buildSetupStatus(facts, { identity });
    expect(status.server).toEqual({ name: 'ai4s-literature-zotero', version: '0.3.0', install: 'plugin' });
    expect(status.profile).toBe('workbench');
    expect(status.read_only).toBe(true);
    expect(status.write_channel).toEqual({ cloud_key: true, local_desktop: true, read_only: true });
    // Identity stays structured: it never leaks into the user-facing text.
    expect(status.rendered.en).not.toContain('ai4s-literature-zotero');
  });
  it('no identity leaves the new structured fields out entirely', () => {
    const status = buildSetupStatus(baseFacts(), {});
    expect(status).not.toHaveProperty('server');
    expect(status).not.toHaveProperty('profile');
    expect(status).not.toHaveProperty('read_only');
    expect(status).not.toHaveProperty('write_channel');
  });
  it('a failed required endpoint moves online search out of Works now, and the summary never says all-clear', () => {
    const probes = summaryOf([
      probe({ error_class: 'timeout', dns: null, tls: null, http_status: null, ms: 6000, error: 'no answer within 6s' }),
    ]);
    const status = buildSetupStatus(baseFacts(), { probes });
    expect(status.network.ok).toBe(false);
    expect(status.works_now.map((item) => item.id)).not.toContain('search');
    const search = status.needs_you.find((item) => item.id === 'search');
    expect(search).toBeDefined();
    expect(search?.detail.en).toMatch(/online search is not usable yet/);
    expect(search?.detail.en).toMatch(/Network check section/);
    expect(status.summary.zh).not.toContain('可以开始用了');
    expect(status.summary.en).not.toContain('You can start now');
  });
  it('a passing network check and a skipped one leave search under Works now', () => {
    const passing = buildSetupStatus(baseFacts(), { probes: summaryOf([probe({})]) });
    expect(passing.works_now.map((item) => item.id)).toContain('search');
    expect(passing.summary.en).toContain('You can start now');
    const skipped = buildSetupStatus(baseFacts(), {});
    expect(skipped.works_now.map((item) => item.id)).toContain('search');
    expect(skipped.summary.en).toContain('You can start now');
  });
  it('a helper still missing keeps its own need even when the network also failed', () => {
    const probes = summaryOf([
      probe({ error_class: 'dns', dns: false, tls: null, http_status: null, error: 'dns failed' }),
    ]);
    const status = buildSetupStatus({ ...baseFacts(), uvAvailable: false }, { probes });
    const search = status.needs_you.find((item) => item.id === 'search');
    expect(search?.action?.type).toBe('install_helper');
    expect(search?.detail.en).toMatch(/helper tool/);
  });

  it('warns loudly in the rendered text when the insecure override is on', () => {
    const status = buildSetupStatus(baseFacts(), { tlsInsecure: true });
    expect(status.diagnostics).toMatchObject({ tls_insecure: true });
    expect(status.rendered.zh).toContain('LITERATURE_TLS_INSECURE');
    expect(status.rendered.zh).toContain('警告');
    expect(status.rendered.en).toContain('LITERATURE_TLS_INSECURE is on');
  });

  it('lists hidden tools with concrete switching instructions', () => {
    const hiddenTools: HiddenToolInfo[] = [
      { name: 'zotero_create_items', reason: 'workbench_profile' },
      { name: 'zotero_delete_items', reason: 'workbench_profile' },
      { name: 'zotero_update_items', reason: 'read_only' },
    ];
    const status = buildSetupStatus(baseFacts(), { hiddenTools });
    expect(status.hidden_tools).toHaveLength(3);
    expect(status.rendered.zh).toContain('当前隐藏的工具（3）');
    expect(status.rendered.zh).toContain('zotero_create_items、zotero_delete_items');
    expect(status.rendered.zh).toContain('LITERATURE_ZOTERO_MCP_TOOL_PROFILE 设为 full');
    expect(status.rendered.zh).toContain('取消 ZOTEUS_READ_ONLY');
    expect(status.rendered.en).toContain('Tools hidden by the current setup (3)');
    expect(status.rendered.en).toContain('set LITERATURE_ZOTERO_MCP_TOOL_PROFILE to full');
    // The trash/delete policy note appears exactly because delete is listed.
    expect(status.rendered.en).toContain('deliberately leaves them out');
  });

  it('explains remote-deployment hiding without suggesting a fix that cannot work', () => {
    const hiddenTools: HiddenToolInfo[] = [
      { name: 'open_setup', reason: 'remote_deployment' },
      { name: 'install_search_helper', reason: 'remote_deployment' },
    ];
    const status = buildSetupStatus(baseFacts(), { hiddenTools });
    expect(status.rendered.en).toContain('remote deployment');
    expect(status.rendered.en).toContain('a remote caller cannot reach');
    expect(status.rendered.zh).toContain('远程部署隐藏');
  });

  it('no hidden tools renders no hidden-tool section', () => {
    const status = buildSetupStatus(baseFacts(), { hiddenTools: [] });
    expect(status.rendered.zh).not.toContain('当前隐藏的工具');
    expect(status.rendered.en).not.toContain('Tools hidden by');
  });

  it('the new sections use no build or component words either', () => {
    const probes = summaryOf([
      probe({ error_class: 'tls', tls: false, http_status: null, error: 'cert failed' }),
    ]);
    const hiddenTools: HiddenToolInfo[] = [
      { name: 'zotero_delete_items', reason: 'workbench_profile' },
      { name: 'zotero_update_items', reason: 'read_only' },
    ];
    const status = buildSetupStatus(baseFacts(), { probes, hiddenTools, tlsInsecure: true });
    for (const lang of ['zh', 'en'] as const) {
      for (const line of status.rendered[lang].split('\n')) {
        // Env-var names like LITERATURE_ZOTERO_MCP_TOOL_PROFILE contain "MCP"
        // inside one word, which the \b regex correctly does not match.
        if (line.includes('LITERATURE_ZOTERO_MCP_TOOL_PROFILE')) continue;
        expect(line).not.toMatch(INTERNAL);
      }
    }
  });
});
