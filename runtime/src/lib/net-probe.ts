// Read-only, key-free network probes for setup_status: one light GET per
// endpoint the workbench actually uses, run sequentially with a small gap so
// opening a session never hammers an external API. Every probe is bounded by a
// per-endpoint timeout and a total budget, and reports DNS/TLS reachability,
// timing, and an error class (ok / tls / dns / timeout / http / other) with a
// sanitized description. No probe URL ever carries a key.
import type { Logger } from './logger.js';
import { classifyNetworkError } from './tls.js';

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export type ProbeErrorClass = 'ok' | 'tls' | 'dns' | 'timeout' | 'http' | 'other';

export interface ProbeTarget {
  name: string;
  url: string;
  /** Optional endpoints never fail the overall verdict. */
  optional?: boolean;
}

export interface ProbeResult {
  name: string;
  /** Origin + path of the probe; never a query string, never a key. */
  url: string;
  optional: boolean;
  /** Did the name resolve? null when the probe never got that far. */
  dns: boolean | null;
  /** Did the TLS handshake complete? null when unknown. */
  tls: boolean | null;
  ms: number;
  http_status: number | null;
  error_class: ProbeErrorClass;
  error: string | null;
}

export interface NetworkSummary {
  checked: true;
  /** True when every required endpoint completed an HTTP exchange. */
  ok: boolean;
  results: ProbeResult[];
}

// The endpoints the workbench really calls. EasyScholar answers 4xx without a
// key, which still proves TLS/DNS reach; OpenAlex is optional and its failure
// never fails the verdict.
export const PROBE_TARGETS: readonly ProbeTarget[] = [
  { name: 'Zotero Web API', url: 'https://api.zotero.org/schema' },
  { name: 'PubMed (NCBI E-utilities)', url: 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils/einfo.fcgi' },
  {
    name: 'Europe PMC',
    url: 'https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=DOI%3A10.1038%2Fnature12373&format=json&pageSize=1',
  },
  { name: 'EasyScholar', url: 'https://www.easyscholar.cc/open/getPublicationRank' },
  { name: 'OpenAlex', url: 'https://api.openalex.org/works?per-page=1', optional: true },
];

export interface ProbeOptions {
  fetchImpl?: FetchLike;
  logger?: Logger;
  /** Per-endpoint budget, default 6 s. */
  timeoutMs?: number;
  /** Total budget across all endpoints, default 30 s. */
  overallMs?: number;
  /** Wait between endpoints, default 400 ms. */
  gapMs?: number;
  /** Injectable for tests. */
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  targets?: readonly ProbeTarget[];
}

const sleepDefault = (ms: number) => new Promise((r) => setTimeout(r, ms));

function reportUrl(targetUrl: string): string {
  try {
    const parsed = new URL(targetUrl);
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return targetUrl;
  }
}

export async function probeNetworkEndpoints(opts: ProbeOptions = {}): Promise<NetworkSummary> {
  const fetchImpl = opts.fetchImpl ?? (globalThis.fetch as FetchLike);
  const sleep = opts.sleep ?? sleepDefault;
  const now = opts.now ?? Date.now;
  const timeoutMs = opts.timeoutMs ?? 6_000;
  const overallMs = opts.overallMs ?? 30_000;
  const gapMs = opts.gapMs ?? 400;
  const targets = opts.targets ?? PROBE_TARGETS;

  const results: ProbeResult[] = [];
  const overallStart = now();
  for (const [index, target] of targets.entries()) {
    if (index > 0 && gapMs > 0) await sleep(gapMs);
    const deadline = Math.max(0, Math.min(timeoutMs, overallMs - (now() - overallStart)));
    const started = now();
    let result: ProbeResult;
    if (deadline === 0) {
      result = {
        name: target.name,
        url: reportUrl(target.url),
        optional: Boolean(target.optional),
        dns: null,
        tls: null,
        ms: 0,
        http_status: null,
        error_class: 'timeout',
        error: 'the network check ran out of its total time budget',
      };
    } else {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), deadline);
      (timer as { unref?: () => void }).unref?.();
      try {
        const res = await fetchImpl(target.url, { signal: controller.signal });
        const errorClass: ProbeErrorClass = res.status >= 500 ? 'http' : 'ok';
        result = {
          name: target.name,
          url: reportUrl(target.url),
          optional: Boolean(target.optional),
          dns: true,
          tls: true,
          ms: now() - started,
          http_status: res.status,
          error_class: errorClass,
          error: errorClass === 'http' ? `the endpoint answered HTTP ${res.status}` : null,
        };
      } catch (e) {
        const aborted = controller.signal.aborted;
        const classified = classifyNetworkError(e);
        const errorClass: ProbeErrorClass = aborted ? 'timeout' : classified.class;
        // What the error class proves about DNS and TLS. `null` means the probe
        // stopped before that step, so the answer is unknown rather than no.
        let dns: boolean | null = true;
        if (errorClass === 'dns') dns = false;
        else if (errorClass === 'timeout') dns = null;
        let tls: boolean | null = null;
        if (errorClass === 'tls') tls = false;
        result = {
          name: target.name,
          url: reportUrl(target.url),
          optional: Boolean(target.optional),
          dns,
          tls,
          ms: now() - started,
          http_status: null,
          error_class: errorClass,
          error: aborted
            ? `no answer within ${Math.round(deadline / 1000)}s`
            : [classified.reason, classified.guidance].filter(Boolean).join(' '),
        };
      } finally {
        clearTimeout(timer);
      }
    }
    opts.logger?.debug(
      `network probe ${result.name}: ${result.error_class}${result.http_status ? ` (${result.http_status})` : ''} in ${result.ms}ms`,
    );
    results.push(result);
  }

  const ok = results
    .filter((r) => !r.optional)
    .every((r) => r.error_class === 'ok' || r.error_class === 'http');
  return { checked: true, ok, results };
}
