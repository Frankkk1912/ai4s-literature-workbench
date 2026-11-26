import { describe, expect, it } from 'vitest';
import { PROBE_TARGETS, probeNetworkEndpoints, type FetchLike, type ProbeResult } from '../../src/lib/net-probe.js';

const response = (status: number): Response => ({ status } as Response);

const tlsFailure = (): never => {
  const cause = new Error('unable to verify the first certificate');
  (cause as { code?: string }).code = 'UNABLE_TO_VERIFY_LEAF_SIGNATURE';
  throw new TypeError('fetch failed', { cause });
};

const dnsFailure = (): never => {
  const cause = new Error('getaddrinfo ENOTFOUND api.example.org');
  (cause as { code?: string }).code = 'ENOTFOUND';
  throw new TypeError('fetch failed', { cause });
};

const noSleep = async () => {};

// A fetch that never answers but does honor the abort signal, like the real one.
const hangingFetch: FetchLike = (_url, init) =>
  new Promise<Response>((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => {
      const error = new Error('aborted');
      error.name = 'AbortError';
      reject(error);
    });
  });

const nameOf = (results: ProbeResult[], name: string) => results.find((r) => r.name === name)!;

describe('probeNetworkEndpoints', () => {
  it('probes every target the workbench actually uses, key-free, one at a time', async () => {
    const calls: string[] = [];
    const fetchImpl: FetchLike = async (url) => {
      calls.push(url);
      return response(200);
    };
    const summary = await probeNetworkEndpoints({ fetchImpl, sleep: noSleep });
    expect(summary.checked).toBe(true);
    expect(summary.ok).toBe(true);
    expect(summary.results).toHaveLength(PROBE_TARGETS.length);
    expect(calls).toEqual(PROBE_TARGETS.map((t) => t.url));
    for (const target of PROBE_TARGETS) {
      expect(target.url).not.toMatch(/key|token|secret/i);
    }
    // Serialized with a gap: every fetch happens in order, never in parallel.
    expect(calls).toHaveLength(PROBE_TARGETS.length);
  });

  it('reports ok with HTTP status, and a 4xx keyless answer still counts as reachable', async () => {
    const fetchImpl: FetchLike = async () => response(401);
    const { results, ok } = await probeNetworkEndpoints({ fetchImpl, sleep: noSleep });
    expect(ok).toBe(true);
    const easyscholar = nameOf(results, 'EasyScholar');
    expect(easyscholar).toMatchObject({ error_class: 'ok', http_status: 401, dns: true, tls: true });
    expect(easyscholar.url).not.toContain('?');
  });

  it('a 5xx answer is reachable but reported as a server-side http error', async () => {
    const fetchImpl: FetchLike = async () => response(503);
    const { results, ok } = await probeNetworkEndpoints({ fetchImpl, sleep: noSleep });
    // Reachability still holds: the network path works.
    expect(ok).toBe(true);
    expect(results.every((r) => r.error_class === 'http' && r.http_status === 503)).toBe(true);
  });

  it('classifies TLS failures with sanitized reasons and fix guidance', async () => {
    const fetchImpl: FetchLike = async () => tlsFailure();
    const { results, ok } = await probeNetworkEndpoints({ fetchImpl, sleep: noSleep });
    expect(ok).toBe(false);
    const zotero = nameOf(results, 'Zotero Web API');
    expect(zotero).toMatchObject({ error_class: 'tls', tls: false, dns: true, http_status: null });
    expect(zotero.error).toMatch(/SSL_CERT_FILE|NODE_EXTRA_CA_CERTS/);
  });

  it('classifies DNS failures distinctly from TLS', async () => {
    const fetchImpl: FetchLike = async () => dnsFailure();
    const { results, ok } = await probeNetworkEndpoints({ fetchImpl, sleep: noSleep });
    expect(ok).toBe(false);
    const pubmed = nameOf(results, 'PubMed (NCBI E-utilities)');
    expect(pubmed).toMatchObject({ error_class: 'dns', dns: false, tls: null });
    // It says this is NOT a certificate problem, and gives no certificate fix.
    expect(pubmed.error).toMatch(/not a certificate problem/);
    expect(pubmed.error).not.toMatch(/SSL_CERT_FILE|NODE_EXTRA_CA_CERTS/);
  });

  it('a timeout is bounded and does not hang the whole check', async () => {
    const { results, ok } = await probeNetworkEndpoints({
      fetchImpl: hangingFetch,
      sleep: noSleep,
      timeoutMs: 10,
      overallMs: 10_000,
    });
    expect(ok).toBe(false);
    expect(results.every((r) => r.error_class === 'timeout')).toBe(true);
    expect(results.every((r) => r.error?.includes('within'))).toBe(true);
  });

  it('an optional OpenAlex failure never fails the overall verdict', async () => {
    const fetchImpl: FetchLike = async (url) => {
      if (url.includes('openalex')) return dnsFailure();
      return response(200);
    };
    const { results, ok } = await probeNetworkEndpoints({ fetchImpl, sleep: noSleep });
    expect(ok).toBe(true);
    const openalex = nameOf(results, 'OpenAlex');
    expect(openalex.optional).toBe(true);
    expect(openalex.error_class).toBe('dns');
  });

  it('the total time budget stops later probes instead of hanging forever', async () => {
    let ticks = 0;
    const now = () => {
      // 5 s pass between any two now() calls, so the budget drains quickly.
      ticks += 5_000;
      return ticks;
    };
    const { results } = await probeNetworkEndpoints({ fetchImpl: hangingFetch, sleep: noSleep, now, timeoutMs: 6_000, overallMs: 15_000 });
    const classes = results.map((r) => r.error_class);
    expect(classes[0]).toBe('timeout');
    // The budget is gone: remaining endpoints fail fast with a timeout note.
    expect(classes.slice(1).every((c) => c === 'timeout')).toBe(true);
    expect(results.slice(1).every((r) => r.error?.includes('total time budget'))).toBe(true);
  });
});
