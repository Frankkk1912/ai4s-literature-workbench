import { describe, expect, it } from 'vitest';
import {
  buildSetupStatus,
  evaluateSetup,
  gatherFacts,
  renderSetup,
  type SetupFacts,
} from '../../src/lib/setup-status.js';
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
    expect(items.find((item) => item.id === 'search')?.action?.type).toBe('ask_to_install');
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
