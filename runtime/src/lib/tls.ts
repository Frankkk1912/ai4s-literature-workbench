// TLS trust for every outbound request the runtime makes.
//
// The rules, in order:
//  1. Certificate verification is the default and is never turned off silently.
//  2. `NODE_EXTRA_CA_CERTS` is honored by Node itself at startup; this module
//     validates the path so a typo cannot look "set but ineffective", and also
//     feeds the same file to the dispatcher below so it applies even when it
//     only became visible after startup (e.g. from a private env file).
//  3. `SSL_CERT_FILE` and `REQUESTS_CA_BUNDLE` (first non-empty wins) are NOT
//     honored by Node natively; the undici dispatcher below applies them.
//     Invalid paths raise a clear error instead of being silently skipped.
//  4. `LITERATURE_TLS_INSECURE` accepts only explicit truthy values (`1`,
//     `true`, `yes`, case-folded). When set, verification is disabled for this
//     process's fetch calls and a loud warning is logged. Everything else —
//     including `no`, `off`, `0`, or an unset variable — keeps verification on.
//
// `NODE_USE_SYSTEM_CA=1` (Node 22.15+) additionally opts Node into the
// operating system's certificate store; it is a Node-level switch, so it is
// documented rather than set from here.
import { accessSync, constants, readFileSync } from 'node:fs';
import { Agent, setGlobalDispatcher } from 'undici';

/** Minimal structural logger so the module is identical in both runtimes. */
export interface TlsLogger {
  info?: (message: string) => void;
  warn?: (message: string) => void;
}

export const TLS_INSECURE_ENV = 'LITERATURE_TLS_INSECURE';
export const CA_ENV_VARS = ['SSL_CERT_FILE', 'REQUESTS_CA_BUNDLE'] as const;
export type CaEnvVar = (typeof CA_ENV_VARS)[number];

export type TlsMode = 'default' | 'custom-ca' | 'insecure';

export interface TlsTrustSummary {
  mode: TlsMode;
  /** Every custom-CA env var actually applied (empty in the default mode). */
  caEnvVars: Array<CaEnvVar | 'NODE_EXTRA_CA_CERTS'>;
  insecure: boolean;
}

/** True only for an explicit truthy word: 1 / true / yes (case-folded). */
export function isExplicitTruthy(raw: string | undefined): boolean {
  return raw !== undefined && ['1', 'true', 'yes'].includes(raw.trim().toLowerCase());
}

export function tlsInsecureEnabled(env: NodeJS.ProcessEnv): boolean {
  return isExplicitTruthy(env[TLS_INSECURE_ENV]);
}

/** First non-empty CA-file env var among CA_ENV_VARS; empty values are ignored. */
export function customCaPath(env: NodeJS.ProcessEnv): { path: string; envVar: CaEnvVar } | null {
  for (const envVar of CA_ENV_VARS) {
    const raw = env[envVar];
    if (raw && raw.trim()) return { path: raw.trim(), envVar };
  }
  return null;
}

/** Query parameters that must never reach a log line or an error message. */
const SENSITIVE_QUERY = /api[_-]?key|secret|token|password|credential|key|mailto/i;

/** Origin + path with secret-looking query parameters stripped. */
export function sanitizeUrlForLog(url: string): string {
  try {
    const parsed = new URL(url);
    for (const key of [...parsed.searchParams.keys()]) {
      if (SENSITIVE_QUERY.test(key)) parsed.searchParams.delete(key);
    }
    return parsed.toString();
  } catch {
    return '<unparseable url>';
  }
}

export const TLS_FIX_GUIDANCE =
  'Behind a school or company gateway this usually means traffic is re-signed with a private root certificate. ' +
  'Fix: export that root certificate as a PEM file and point SSL_CERT_FILE or NODE_EXTRA_CA_CERTS at it, then restart. ' +
  'Node 22.15+ can also use the system certificate store with NODE_USE_SYSTEM_CA=1. ' +
  'Verification is never disabled by default; LITERATURE_TLS_INSECURE=1 disables it only as an explicit, warned override.';

function assertReadable(path: string, envVar: string): void {
  try {
    accessSync(path, constants.R_OK);
  } catch {
    throw new Error(
      `${envVar} is set to ${path}, which is not a readable file. Point it at a valid PEM certificate bundle or unset it; an invalid path is never silently ignored. ` +
        TLS_FIX_GUIDANCE,
    );
  }
}

/**
 * Apply TLS trust at startup, before any outbound fetch. Must run once, early;
 * the global dispatcher it installs covers every `fetch` in this process.
 * Never disables verification unless `LITERATURE_TLS_INSECURE` is explicitly
 * truthy, and warns loudly when it does.
 */
export function applyTlsTrust(opts: { env?: NodeJS.ProcessEnv; logger?: TlsLogger } = {}): TlsTrustSummary {
  const env = opts.env ?? process.env;
  const logger = opts.logger;

  if (tlsInsecureEnabled(env)) {
    logger?.warn?.(
      `${TLS_INSECURE_ENV}=1: TLS certificate verification is DISABLED for outbound fetch in this process. ` +
        'Use it only on a trusted private network while you fix the certificate setup.',
    );
    setGlobalDispatcher(new Agent({ connect: { rejectUnauthorized: false } }));
    return { mode: 'insecure', caEnvVars: [], insecure: true };
  }

  // Node applies NODE_EXTRA_CA_CERTS itself at startup; validate the path so a
  // typo cannot silently look "set but ineffective", and add it to the
  // dispatcher too so it also covers values that only appeared after startup.
  const caFiles: Array<{ path: string; envVar: 'NODE_EXTRA_CA_CERTS' | CaEnvVar }> = [];
  const extra = env.NODE_EXTRA_CA_CERTS;
  if (extra && extra.trim()) {
    const path = extra.trim();
    assertReadable(path, 'NODE_EXTRA_CA_CERTS');
    caFiles.push({ path, envVar: 'NODE_EXTRA_CA_CERTS' });
  }
  const ca = customCaPath(env);
  if (ca) {
    assertReadable(ca.path, ca.envVar);
    caFiles.push(ca);
  }

  if (caFiles.length > 0) {
    // Extra trust anchors on top of Node's built-in CAs, not a replacement.
    const pem = caFiles.map((file) => readFileSync(file.path, 'utf8'));
    setGlobalDispatcher(new Agent({ connect: { ca: pem, rejectUnauthorized: true } }));
    logger?.info?.(`TLS trust: added custom CAs from ${caFiles.map((f) => f.envVar).join(', ')} for outbound fetch.`);
    return { mode: 'custom-ca', caEnvVars: caFiles.map((f) => f.envVar), insecure: false };
  }

  // Default: Node's built-in CAs (plus whatever NODE_EXTRA_CA_CERTS and
  // NODE_USE_SYSTEM_CA the operator set before startup already provide).
  return { mode: 'default', caEnvVars: [], insecure: false };
}

export interface NetworkErrorClass {
  class: 'tls' | 'dns' | 'timeout' | 'http' | 'other';
  /** Short, sanitized description of what went wrong (never a raw URL). */
  reason: string;
  /** Present for `tls`: how to fix certificate trust. */
  guidance?: string;
}

const TLS_CODE_REASONS: Record<string, string> = {
  UNABLE_TO_VERIFY_LEAF_SIGNATURE: 'the certificate is not trusted (the signer is unknown to this process)',
  UNABLE_TO_GET_ISSUER_CERT_LOCALLY: 'the certificate is not trusted (its issuer is unknown to this process)',
  SELF_SIGNED_CERT_IN_CHAIN: 'the certificate chain contains a self-signed certificate (typical for an intercepting gateway)',
  DEPTH_ZERO_SELF_SIGNED_CERT: 'the server presented a self-signed certificate',
  CERT_HAS_EXPIRED: 'the server certificate has expired',
  ERR_TLS_CERT_ALTNAME_INVALID: 'the certificate does not match the server hostname',
  ERR_SSL_WRONG_VERSION_NUMBER: 'the TLS handshake failed (possibly a misconfigured proxy answering HTTPS with plain HTTP)',
};

function walkCause(error: unknown, depth = 0): Array<{ code?: string; message: string }> {
  if (error === null || typeof error !== 'object' || depth > 5) return [];
  const e = error as { code?: string; message?: string; cause?: unknown; name?: string };
  const entry: { code?: string; message: string } = {
    code: typeof e.code === 'string' ? e.code : undefined,
    message: `${e.name ?? ''} ${e.message ?? ''}`.trim(),
  };
  return [entry, ...walkCause(e.cause, depth + 1)];
}

/** Sort a network failure into tls / dns / timeout / http / other, with a short
 * sanitized reason. Certificate problems carry the fix-it guidance. */
export function classifyNetworkError(error: unknown): NetworkErrorClass {
  const chain = walkCause(error);
  const codes = chain.map((entry) => entry.code).filter((code): code is string => Boolean(code));
  const text = chain.map((entry) => entry.message).join(' ');

  for (const code of codes) {
    const tlsReason = TLS_CODE_REASONS[code];
    if (tlsReason) return { class: 'tls', reason: `${tlsReason} (${code})`, guidance: TLS_FIX_GUIDANCE };
  }
  if (codes.includes('ENOTFOUND') || codes.includes('EAI_AGAIN')) {
    return { class: 'dns', reason: 'the host name could not be resolved; this is a DNS or network problem, not a certificate problem' };
  }
  if (codes.includes('ECONNREFUSED')) {
    return { class: 'other', reason: 'the connection was refused; the host is reachable but nothing answered on that port' };
  }
  const aborted = error as { name?: string } | null;
  if (aborted?.name === 'AbortError' || aborted?.name === 'TimeoutError') {
    return { class: 'timeout', reason: 'the connection timed out' };
  }
  if (/certificate|SSL/i.test(text) && !codes.length) {
    return { class: 'tls', reason: 'the TLS handshake failed', guidance: TLS_FIX_GUIDANCE };
  }
  return {
    class: 'other',
    reason: codes.length > 0 ? `network error (${codes[0]})` : 'network error',
  };
}
