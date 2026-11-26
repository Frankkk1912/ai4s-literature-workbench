import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  EasyScholarClient,
  defaultEasyScholarCacheFile,
  loadEasyScholarCache,
  normalizeJournalKey,
  parseCustomRank,
  parseOfficialRank,
  resolveEasyScholarKey,
  saveEasyScholarCache,
} from '../../src/features/scholar/easyscholar.js';

describe('easyscholar payload parsing', () => {
  it('keeps only non-empty officialRank values, per bucket', () => {
    const parsed = parseOfficialRank({ all: { sciif: '12.4', sci: '', sciUp: null }, select: { esi: 'X' }, ignored: {} });
    expect(parsed).toEqual({ all: { sciif: '12.4' }, select: { esi: 'X' } });
  });

  it('resolves customRank uuid&&&rankIndex strings against rankInfo', () => {
    const parsed = parseCustomRank({
      rankInfo: [{ uuid: 'u1', abbName: 'JCR', oneRankText: 'Q1' }, { uuid: 'u2', abbName: '中科院', twoRankText: '2区' }],
      rank: ['u1&&&1', 'u2&&&2', 'u1&&&not-a-number', 'missing&&&1'],
    });
    expect(parsed).toEqual([
      { uuid: 'u1', dataset: 'JCR', rank_index: 1, rank: 'Q1' },
      { uuid: 'u2', dataset: '中科院', rank_index: 2, rank: '2区' },
    ]);
  });

  it('normalizes journal names like the skill', () => {
    expect(normalizeJournalKey('The Journal of Physiology!')).toBe('thejournalofphysiology');
    expect(normalizeJournalKey('')).toBe('');
  });
});

describe('easyscholar cache and key resolution', () => {
  it('round-trips cache entries and starts fresh on corrupt files', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'easyscholar-cache-'));
    const path = join(dir, 'cache.json');
    const now = () => new Date('2026-11-26T00:00:00Z');
    saveEasyScholarCache(path, loadEasyScholarCache(path, now), now);
    const first = JSON.parse(await readFile(path, 'utf8'));
    expect(first).toMatchObject({ version: 1, entries: {} });
    saveEasyScholarCache(path, { version: 1, entries: { nature: { publication_name: 'Nature', official_rank: { all: { sciif: '1' } }, custom_rank: [], fetched_at: '2026-11-26T00:00:00.000Z' } } }, now);
    expect(loadEasyScholarCache(path).entries.nature!.official_rank).toEqual({ all: { sciif: '1' } });
    await writeFile(path, '{not json');
    expect(loadEasyScholarCache(path).entries).toEqual({});
  });

  it('prefers the environment key and reads no key from an empty home', () => {
    expect(resolveEasyScholarKey({ EASYSCHOLAR_SECRET_KEY: 'from-env' })).toBe('from-env');
    expect(resolveEasyScholarKey({}, 'darwin', '/nonexistent-easyscholar-home')).toBe(null);
  });

  it('uses the platform cache location the skill uses', () => {
    expect(defaultEasyScholarCacheFile({} as NodeJS.ProcessEnv, 'darwin', '/home/test')).toBe(
      '/home/test/Library/Caches/ai4s-literature-workbench/easyscholar_journal_ranks.json',
    );
    expect(defaultEasyScholarCacheFile({ LOCALAPPDATA: 'C:\\AppData\\Local' }, 'win32', 'C:\\Users\\test')).toBe(
      'C:\\AppData\\Local\\ai4s-literature-workbench\\cache\\easyscholar_journal_ranks.json',
    );
  });
});

describe('easyscholar client', () => {
  const fixedNow = () => new Date('2026-11-26T00:00:00Z');

  it('maps a successful API answer into the skill-compatible shape', async () => {
    const fetchImpl = async () =>
      new Response(JSON.stringify({
        code: 200,
        data: { officialRank: { all: { sciif: '64.8' } }, customRank: { rankInfo: [{ uuid: 'u1', abbName: 'JCR', oneRankText: 'Q1' }], rank: ['u1&&&1'] } },
      }), { status: 200 });
    const client = new EasyScholarClient({ secretKey: 'k', fetchImpl, minIntervalMs: 0, now: fixedNow });
    const result = await client.fetchRank('Nature');
    expect(result.ok).toBe(true);
    expect(result.entry).toMatchObject({
      publication_name: 'Nature',
      official_rank: { all: { sciif: '64.8' } },
      custom_rank: [{ uuid: 'u1', dataset: 'JCR', rank_index: 1, rank: 'Q1' }],
      fetched_at: '2026-11-26T00:00:00.000Z',
    });
  });

  it('returns ok:false without throwing on API errors, 429, and network failures', async () => {
    const responses: Array<Response | Error> = [
      new Response(JSON.stringify({ code: 500, msg: 'bad key' }), { status: 200 }),
      new Response('slow down', { status: 429 }),
      new Error('dns gone'),
    ];
    let call = 0;
    const fetchImpl = async () => {
      const next = responses[call++]!;
      if (next instanceof Error) throw next;
      return next;
    };
    const client = new EasyScholarClient({ secretKey: 'k', fetchImpl, minIntervalMs: 0, now: fixedNow, retries: 0 });
    expect((await client.fetchRank('A')).error).toMatch(/EasyScholar API error/);
    expect((await client.fetchRank('B')).error).toMatch(/429/);
    expect((await client.fetchRank('C')).error).toMatch(/network error/);
  });

  it('keeps the secret key out of every error message', async () => {
    const fetchImpl = async () => new Error('boom');
    const client = new EasyScholarClient({ secretKey: 'super-secret-value', fetchImpl, minIntervalMs: 0, retries: 0 });
    const result = await client.fetchRank('Nature');
    expect(result.ok).toBe(false);
    expect(JSON.stringify(result)).not.toContain('super-secret-value');
  });
});
