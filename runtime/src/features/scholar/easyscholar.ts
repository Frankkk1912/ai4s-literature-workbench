import { existsSync, readFileSync, writeFileSync, mkdirSync, renameSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, posix, win32 } from 'node:path';
import type { FetchLike } from '../../api/http.js';
import { defaultAcademicResearchConfigFile, legacyAcademicResearchConfigFiles } from '../../lib/env-files.js';

/**
 * EasyScholar journal-rank client.
 *
 * This is the runtime port of the existing `literature-research` skill client
 * (`literature_search.py`): same endpoint, same `publicationName` query, same
 * key sources (`EASYSCHOLAR_SECRET_KEY` or the `academic-research.json` written
 * by the local setup page — no new key parameter or key file), same shared disk
 * cache (`easyscholar_journal_ranks.json`), same minimum interval between
 * calls, and the same retry/backoff policy (3 retries with exponential delays
 * on 5xx/network errors; 429 is not retried).
 */
export const EASYSCHOLAR_BASE = 'https://www.easyscholar.cc/open/getPublicationRank';
const RANK_TEXT_FIELDS = ['oneRankText', 'twoRankText', 'threeRankText', 'fourRankText', 'fiveRankText'];
const USER_AGENT = 'AI4S-Literature-Workbench/zotero-backfill-metrics';

export interface EasyScholarRankEntry {
  publication_name: string;
  official_rank: Record<string, Record<string, unknown>>;
  custom_rank: Array<{ uuid: string; dataset: string; rank_index: number; rank: string }>;
  fetched_at: string;
}

export interface EasyScholarCache {
  version: 1;
  created_at?: string;
  updated_at?: string;
  entries: Record<string, EasyScholarRankEntry>;
}

/** Strict, punctuation-insensitive journal-name key (same rule as the skill). */
export function normalizeJournalKey(value: unknown): string {
  return String(value ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** The shared cache file used by the literature-research skill. */
export function defaultEasyScholarCacheFile(
  env: NodeJS.ProcessEnv = process.env,
  platform = process.platform,
  home = homedir(),
): string {
  const platformPath = platform === 'win32' ? win32 : posix;
  if (platform === 'win32') {
    const localAppData = env.LOCALAPPDATA?.trim() || platformPath.join(home, 'AppData', 'Local');
    return platformPath.join(localAppData, 'ai4s-literature-workbench', 'cache', 'easyscholar_journal_ranks.json');
  }
  if (platform === 'darwin') {
    return platformPath.join(home, 'Library', 'Caches', 'ai4s-literature-workbench', 'easyscholar_journal_ranks.json');
  }
  const cacheHome = env.XDG_CACHE_HOME?.trim() || platformPath.join(home, '.cache');
  return platformPath.join(cacheHome, 'ai4s-literature-workbench', 'easyscholar_journal_ranks.json');
}

/** Historical cache locations kept readable for migration parity with the skill. */
export function legacyEasyScholarCacheFiles(
  env: NodeJS.ProcessEnv = process.env,
  platform = process.platform,
  home = homedir(),
): string[] {
  const platformPath = platform === 'win32' ? win32 : posix;
  const paths = [platformPath.join(home, '.cache', 'frank-ai4s', 'easyscholar_journal_ranks.json')];
  if (platform === 'win32') {
    const localAppData = env.LOCALAPPDATA?.trim() || platformPath.join(home, 'AppData', 'Local');
    paths.push(platformPath.join(localAppData, 'frank-ai4s', 'cache', 'easyscholar_journal_ranks.json'));
  }
  const xdg = env.XDG_CACHE_HOME?.trim();
  if (xdg && platform !== 'win32') paths.push(platformPath.join(xdg, 'frank-ai4s', 'easyscholar_journal_ranks.json'));
  return [...new Set(paths)];
}

/**
 * Resolve the EasyScholar secret key from the already-configured sources only:
 * the `EASYSCHOLAR_SECRET_KEY` environment variable or the
 * `easyscholar_secret_key` field of the workbench `academic-research.json`
 * (plus its documented legacy locations). This mirrors `academicKeyConfigured`
 * in onboarding-core; no new key storage is introduced and the value never
 * appears in plans, receipts, or tool results.
 */
export function resolveEasyScholarKey(
  env: NodeJS.ProcessEnv = process.env,
  platform = process.platform,
  home = homedir(),
): string | null {
  const envValue = env.EASYSCHOLAR_SECRET_KEY?.trim();
  if (envValue) return envValue;
  const candidates = [
    env.AI4S_ACADEMIC_CONFIG_FILE?.trim() || defaultAcademicResearchConfigFile(env, platform, home),
    ...legacyAcademicResearchConfigFiles(env, platform, home),
  ];
  for (const candidate of candidates) {
    if (!candidate || !existsSync(candidate)) continue;
    try {
      const config = JSON.parse(readFileSync(candidate, 'utf8')) as Record<string, unknown>;
      const value = String(config.easyscholar_secret_key ?? '').trim();
      if (value) return value;
    } catch {
      // Unreadable or invalid JSON: fall through to the next candidate.
    }
  }
  return null;
}

function emptyCache(now: () => Date): EasyScholarCache {
  return { version: 1, created_at: now().toISOString().slice(0, 10), entries: {} };
}

/** Load the shared cache, starting fresh (never throwing) on any problem. */
export function loadEasyScholarCache(path: string, now: () => Date = () => new Date()): EasyScholarCache {
  if (!existsSync(path)) return emptyCache(now);
  try {
    const data = JSON.parse(readFileSync(path, 'utf8')) as EasyScholarCache;
    if (data && typeof data === 'object' && data.entries && typeof data.entries === 'object') {
      return { ...data, entries: data.entries };
    }
  } catch {
    // Same behavior as the skill: a corrupt cache starts fresh.
  }
  return emptyCache(now);
}

export function saveEasyScholarCache(path: string, cache: EasyScholarCache, now: () => Date = () => new Date()): void {
  mkdirSync(dirname(path), { recursive: true });
  const target = { ...cache, version: 1 as const, updated_at: now().toISOString().slice(0, 10) };
  const tmp = `${path}.tmp-${process.pid}`;
  writeFileSync(tmp, `${JSON.stringify(target, null, 2)}\n`);
  renameSync(tmp, path);
}

/** Parse `officialRank` into non-empty `all`/`select` buckets (skill-compatible shape). */
export function parseOfficialRank(officialRank: unknown): Record<string, Record<string, unknown>> {
  const output: Record<string, Record<string, unknown>> = {};
  if (!officialRank || typeof officialRank !== 'object' || Array.isArray(officialRank)) return output;
  for (const bucket of ['all', 'select'] as const) {
    const data = (officialRank as Record<string, unknown>)[bucket];
    if (!data || typeof data !== 'object' || Array.isArray(data)) continue;
    const cleaned: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
      const text = value === null || value === undefined ? '' : String(value).trim();
      if (text) cleaned[key] = value;
    }
    if (Object.keys(cleaned).length) output[bucket] = cleaned;
  }
  return output;
}

/** Parse `customRank` (`uuid&&&rankIndex` strings resolved against `rankInfo`) into readable entries. */
export function parseCustomRank(customRank: unknown): EasyScholarRankEntry['custom_rank'] {
  if (!customRank || typeof customRank !== 'object' || Array.isArray(customRank)) return [];
  const source = customRank as Record<string, unknown>;
  const rankInfoRaw = source.rankInfo;
  const rankInfoList = Array.isArray(rankInfoRaw) ? rankInfoRaw : rankInfoRaw ? [rankInfoRaw] : [];
  const byUuid = new Map<string, Record<string, unknown>>();
  for (const info of rankInfoList) {
    if (info && typeof info === 'object' && !Array.isArray(info)) {
      const uuid = String((info as Record<string, unknown>).uuid ?? '');
      if (uuid) byUuid.set(uuid, info as Record<string, unknown>);
    }
  }
  const rawRanks = source.rank;
  const rankStrings = Array.isArray(rawRanks) ? rawRanks.map(String) : rawRanks !== undefined ? [String(rawRanks)] : [];
  const output: EasyScholarRankEntry['custom_rank'] = [];
  for (const raw of rankStrings) {
    const parts = raw.split('&&&');
    if (parts.length !== 2) continue;
    const uuid = parts[0]!;
    const rankIndex = Number(parts[1]!.trim());
    if (!Number.isInteger(rankIndex)) continue;
    const info = byUuid.get(uuid);
    if (!info) continue;
    const textField = RANK_TEXT_FIELDS[rankIndex - 1];
    const rankText = textField ? String(info[textField] ?? '') : '';
    output.push({ uuid, dataset: String(info.abbName ?? ''), rank_index: rankIndex, rank: rankText });
  }
  return output;
}

export interface EasyScholarFetchResult {
  ok: boolean;
  entry?: EasyScholarRankEntry;
  error?: string;
}

export interface EasyScholarClientOptions {
  secretKey: string | null;
  fetchImpl?: FetchLike;
  /** Minimum delay between requests, mirroring the skill's default 1s. */
  minIntervalMs?: number;
  now?: () => Date;
  retries?: number;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export class EasyScholarClient {
  private readonly secretKey: string | null;
  private readonly fetchImpl: FetchLike;
  private readonly minIntervalMs: number;
  private readonly now: () => Date;
  private readonly retries: number;
  private lastRequestAt = 0;

  constructor(opts: EasyScholarClientOptions) {
    this.secretKey = opts.secretKey;
    this.fetchImpl = opts.fetchImpl ?? (globalThis.fetch as FetchLike);
    this.minIntervalMs = opts.minIntervalMs ?? 1000;
    this.now = opts.now ?? (() => new Date());
    this.retries = opts.retries ?? 3;
  }

  /**
   * Fetch journal-rank data for one publication name. Mirrors the skill's
   * `fetch_easyscholar_rank`: a transient server/network error is retried with
   * exponential backoff (up to 3 times); a rate limit (429) is not retried; any
   * final failure returns `ok: false` instead of throwing, so one journal never
   * aborts a batch.
   */
  async fetchRank(publicationName: string): Promise<EasyScholarFetchResult> {
    const name = publicationName.trim();
    if (!name) return { ok: false, error: 'empty publication name' };
    const params = new URLSearchParams({ publicationName: name });
    if (this.secretKey) params.set('secretKey', this.secretKey);
    const url = `${EASYSCHOLAR_BASE}?${params.toString()}`;

    for (let attempt = 0; attempt <= this.retries; attempt++) {
      const wait = this.minIntervalMs - (Date.now() - this.lastRequestAt);
      if (wait > 0) await sleep(wait);
      this.lastRequestAt = Date.now();
      let response: Response;
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 45_000);
        (timer as { unref?: () => void }).unref?.();
        try {
          response = await this.fetchImpl(url, { headers: { 'User-Agent': USER_AGENT }, signal: controller.signal });
        } finally {
          clearTimeout(timer);
        }
      } catch (error) {
        if (attempt < this.retries) {
          await sleep(2 ** attempt * 1000);
          continue;
        }
        return { ok: false, error: `network error: ${error instanceof Error ? error.message : String(error)}` };
      }
      if (response.status === 429) {
        return { ok: false, error: 'rate limited by easyscholar.cc (HTTP 429)' };
      }
      if (response.status >= 500) {
        if (attempt < this.retries) {
          await sleep(2 ** attempt * 1000);
          continue;
        }
        return { ok: false, error: `HTTP ${response.status} from easyscholar.cc` };
      }
      if (!response.ok) {
        return { ok: false, error: `HTTP ${response.status} from easyscholar.cc` };
      }
      let data: Record<string, unknown>;
      try {
        data = JSON.parse(await response.text()) as Record<string, unknown>;
      } catch {
        return { ok: false, error: 'easyscholar.cc returned non-JSON content' };
      }
      if (data.code !== 200) {
        return { ok: false, error: `EasyScholar API error: ${String(data.code)} ${String(data.msg ?? 'unknown error')}` };
      }
      const payload = data.data;
      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
        return { ok: false, error: 'EasyScholar returned empty data' };
      }
      return {
        ok: true,
        entry: {
          publication_name: name,
          official_rank: parseOfficialRank((payload as Record<string, unknown>).officialRank),
          custom_rank: parseCustomRank((payload as Record<string, unknown>).customRank),
          fetched_at: this.now().toISOString(),
        },
      };
    }
    return { ok: false, error: 'request failed after retries' };
  }
}

/** Whether a cached/fetched entry actually carries usable rank data. */
export function hasUsableRankData(entry: EasyScholarRankEntry): boolean {
  return Object.keys(entry.official_rank).length > 0 || entry.custom_rank.length > 0;
}
