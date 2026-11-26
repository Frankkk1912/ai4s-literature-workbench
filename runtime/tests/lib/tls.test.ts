import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { Agent, getGlobalDispatcher, setGlobalDispatcher } from 'undici';
import {
  applyTlsTrust,
  CA_ENV_VARS,
  classifyNetworkError,
  customCaPath,
  isExplicitTruthy,
  sanitizeUrlForLog,
  tlsInsecureEnabled,
  TLS_INSECURE_ENV,
} from '../../src/lib/tls.js';

const CA_PEM = `-----BEGIN CERTIFICATE-----
MIIDgTCCAmmgAwIBAgIUBV/9uy33aQklUnSZkoGHHhovujAwDQYJKoZIhvcNAQEL
BQAwUDEkMCIGA1UEAwwbQUk0UyBXb3JrYmVuY2ggVGVzdCBSb290IENBMSgwJgYD
-----END CERTIFICATE-----`;

describe('explicit truthy parsing', () => {
  it('accepts only 1 / true / yes, case-folded and trimmed', () => {
    for (const raw of ['1', 'true', 'yes', ' TRUE ', 'Yes', '1']) expect(isExplicitTruthy(raw)).toBe(true);
    for (const raw of ['0', 'no', 'off', 'false', 'maybe', '', ' ', '1x', undefined]) {
      expect(isExplicitTruthy(raw)).toBe(false);
    }
  });

  it('the insecure flag never turns on for anything else', () => {
    expect(tlsInsecureEnabled({ [TLS_INSECURE_ENV]: '1' } as NodeJS.ProcessEnv)).toBe(true);
    for (const raw of ['0', 'no', '', 'false']) {
      expect(tlsInsecureEnabled({ [TLS_INSECURE_ENV]: raw } as NodeJS.ProcessEnv)).toBe(false);
    }
    expect(tlsInsecureEnabled({} as NodeJS.ProcessEnv)).toBe(false);
  });
});

describe('custom CA env vars', () => {
  it('prefers SSL_CERT_FILE, then REQUESTS_CA_BUNDLE, and ignores empty values', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ai4s-tls-'));
    const ca = join(dir, 'ca.pem');
    writeFileSync(ca, CA_PEM);
    expect(customCaPath({ SSL_CERT_FILE: ca, REQUESTS_CA_BUNDLE: ca } as NodeJS.ProcessEnv)?.envVar).toBe('SSL_CERT_FILE');
    expect(customCaPath({ REQUESTS_CA_BUNDLE: `  ${ca}  ` } as NodeJS.ProcessEnv)?.envVar).toBe('REQUESTS_CA_BUNDLE');
    expect(customCaPath({ SSL_CERT_FILE: '', REQUESTS_CA_BUNDLE: '  ' } as NodeJS.ProcessEnv)).toBeNull();
    expect(CA_ENV_VARS).toEqual(['SSL_CERT_FILE', 'REQUESTS_CA_BUNDLE']);
  });

  it('an invalid path is a clear error that names the env var, never a silent skip', () => {
    expect(() =>
      applyTlsTrust({ env: { SSL_CERT_FILE: '/no/such/bundle.pem' } as NodeJS.ProcessEnv }),
    ).toThrowError(/SSL_CERT_FILE is set to \/no\/such\/bundle\.pem.*never silently ignored/s);
    expect(() =>
      applyTlsTrust({ env: { NODE_EXTRA_CA_CERTS: '/no/such/bundle.pem' } as NodeJS.ProcessEnv }),
    ).toThrowError(/NODE_EXTRA_CA_CERTS/);
  });
});

describe('applyTlsTrust', () => {
  const originalDispatcher = getGlobalDispatcher();
  afterEach(() => {
    setGlobalDispatcher(originalDispatcher);
  });

  it('the default path verifies and leaves the dispatcher untouched', () => {
    const before = getGlobalDispatcher();
    const summary = applyTlsTrust({ env: {} as NodeJS.ProcessEnv });
    expect(summary).toMatchObject({ mode: 'default', insecure: false });
    expect(getGlobalDispatcher()).toBe(before);
  });

  it('a readable CA file installs a verifying dispatcher', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ai4s-tls-'));
    const ca = join(dir, 'ca.pem');
    writeFileSync(ca, CA_PEM);
    const summary = applyTlsTrust({ env: { REQUESTS_CA_BUNDLE: ca } as NodeJS.ProcessEnv });
    expect(summary).toMatchObject({ mode: 'custom-ca', insecure: false, caEnvVars: ['REQUESTS_CA_BUNDLE'] });
    const dispatcher = getGlobalDispatcher();
    expect(dispatcher).not.toBe(originalDispatcher);
    // The installed agent must keep verification on: this is the whole point.
    expect((dispatcher as Agent).options?.connect?.rejectUnauthorized).not.toBe(false);
  });

  it('the insecure override only fires on explicit truthy values and warns', () => {
    const warnings: string[] = [];
    for (const raw of ['0', 'no', 'false', 'off']) {
      expect(applyTlsTrust({ env: { [TLS_INSECURE_ENV]: raw } as NodeJS.ProcessEnv }).insecure).toBe(false);
    }
    const summary = applyTlsTrust({
      env: { [TLS_INSECURE_ENV]: '1' } as NodeJS.ProcessEnv,
      logger: { warn: (m: string) => warnings.push(m), info: () => {} },
    });
    expect(summary).toMatchObject({ mode: 'insecure', insecure: true });
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('DISABLED');
    expect(getGlobalDispatcher()).not.toBe(originalDispatcher);
  });
});

describe('classifyNetworkError', () => {
  const withCode = (code: string, message = 'fetch failed') => {
    const cause = new Error(message);
    (cause as { code?: string }).code = code;
    return new TypeError('fetch failed', { cause });
  };

  it('tells untrusted, expired, and hostname-mismatch certificates apart, with the fix', () => {
    const untrusted = classifyNetworkError(withCode('UNABLE_TO_VERIFY_LEAF_SIGNATURE'));
    expect(untrusted.class).toBe('tls');
    expect(untrusted.reason).toMatch(/not trusted/);
    expect(untrusted.guidance).toMatch(/SSL_CERT_FILE|NODE_EXTRA_CA_CERTS/);
    expect(untrusted.guidance).toMatch(/LITERATURE_TLS_INSECURE/);

    const expired = classifyNetworkError(withCode('CERT_HAS_EXPIRED'));
    expect(expired.class).toBe('tls');
    expect(expired.reason).toMatch(/expired/);

    const mismatch = classifyNetworkError(withCode('ERR_TLS_CERT_ALTNAME_INVALID'));
    expect(mismatch.class).toBe('tls');
    expect(mismatch.reason).toMatch(/hostname/);
  });

  it('keeps DNS, timeout, and refused connections out of the certificate bucket', () => {
    expect(classifyNetworkError(withCode('ENOTFOUND')).class).toBe('dns');
    expect(classifyNetworkError(withCode('EAI_AGAIN')).class).toBe('dns');
    expect(classifyNetworkError(withCode('ECONNREFUSED')).class).toBe('other');
    const abort = new Error('aborted');
    abort.name = 'AbortError';
    expect(classifyNetworkError(abort).class).toBe('timeout');
  });

  it('the guidance never contains a key or a full URL', () => {
    const url = 'https://api.example.org/works?api_key=SECRET123&secretkey=SEKRET&mailto=a@b.c&q=gene';
    const error = new Error(`fetch failed for ${url}`);
    const classified = classifyNetworkError(error);
    expect(classified.reason).not.toContain('SECRET123');
    expect(classified.reason).not.toContain('SEKRET');
  });
});

describe('sanitizeUrlForLog', () => {
  it('strips secret-looking query parameters and keeps the rest', () => {
    const sanitized = sanitizeUrlForLog('https://api.example.org/works?q=gene&api_key=SECRET1&secretkey=SECRET2&key=SECRET3&mailto=a@b.c');
    expect(sanitized).toContain('q=gene');
    expect(sanitized).not.toContain('SECRET1');
    expect(sanitized).not.toContain('SECRET2');
    expect(sanitized).not.toContain('SECRET3');
    expect(sanitized).not.toContain('a@b.c');
  });
});
