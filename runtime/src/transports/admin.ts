import { createHash, randomBytes as nodeRandomBytes, timingSafeEqual } from 'node:crypto';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Express, NextFunction, Request, RequestHandler, Response } from 'express';
import express from 'express';
import { findUp } from '../lib/find-up.js';
import * as core from '../lib/onboarding-core.mjs';
import type {
  OnboardingPaths,
  ProviderName,
  RedactedOnboardingStatus,
} from '../lib/onboarding-core.mjs';

export const ADMIN_ONBOARDING_PREFIX = '/admin/onboarding';

// Agent hosts install plugins under dot-directories (~/.claude, ~/.codex), and
// sendFile rejects any path containing one unless dotfiles are allowed. The
// served names are fixed constants, so no user input reaches these paths.
const STATIC_FILE_OPTIONS = { dotfiles: 'allow' } as const;
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);
const SESSION_COOKIE = 'ai4s_onboarding_session';
const SESSION_CSRF_COOKIE = 'ai4s_onboarding_csrf';
const PAIR_CSRF_COOKIE = 'ai4s_onboarding_pair_csrf';
const PROVIDERS = new Set<ProviderName>(['zotero', 'pubmed', 'easyscholar']);

type RandomBytes = (size: number) => Buffer;

export interface AdminOnboardingOptions {
  prefix?: string;
  pairingTtlMs?: number;
  sessionTtlMs?: number;
  maxPairingAttempts?: number;
  now?: () => number;
  randomBytes?: RandomBytes;
  /** Receives the raw code for direct terminal display; never route this through a logger. */
  pairingCodeSink?: (code: string) => void;
  /** Called once, right after a pairing code is successfully redeemed. */
  onPaired?: () => void;
  fetchImpl?: typeof fetch;
  paths?: OnboardingPaths;
  env?: NodeJS.ProcessEnv;
  publicDir?: string;
}

interface SessionRecord {
  expiresAt: number;
  csrfToken: string;
}

function digest(value: string): Buffer {
  return createHash('sha256').update(value, 'utf8').digest();
}

function constantTimeEqual(left: string, rightDigest: Buffer): boolean {
  return timingSafeEqual(digest(left), rightDigest);
}

function cookies(req: Request): Record<string, string> {
  const result: Record<string, string> = {};
  for (const item of (req.headers.cookie ?? '').split(';')) {
    const separator = item.indexOf('=');
    if (separator < 0) continue;
    const name = item.slice(0, separator).trim();
    const value = item.slice(separator + 1).trim();
    if (!name) continue;
    try {
      result[name] = decodeURIComponent(value);
    } catch {
      // Ignore malformed cookies rather than reflecting their content in an error.
    }
  }
  return result;
}

function requestPort(req: Request): number | undefined {
  return req.socket.localPort;
}

function localUrl(value: string, expectedPort: number | undefined): boolean {
  try {
    const url = new URL(value);
    const normalizedPort = Number(
      url.port || (url.protocol === 'http:' ? 80 : url.protocol === 'https:' ? 443 : 0),
    );
    return (
      url.protocol === 'http:' &&
      !url.username &&
      !url.password &&
      url.pathname === '/' &&
      !url.search &&
      !url.hash &&
      LOOPBACK_HOSTS.has(url.hostname) &&
      normalizedPort === expectedPort
    );
  } catch {
    return false;
  }
}

function hostAndOriginGuard(req: Request, res: Response, next: NextFunction): void {
  const host = req.headers.host;
  const port = requestPort(req);
  if (!host || !localUrl(`http://${host}`, port)) {
    res.status(403).json({ error: 'Forbidden.' });
    return;
  }

  const origin = req.headers.origin;
  if (origin !== undefined && !localUrl(origin, port)) {
    res.status(403).json({ error: 'Forbidden.' });
    return;
  }

  if (!['GET', 'HEAD'].includes(req.method) && origin === undefined) {
    res.status(403).json({ error: 'Origin required.' });
    return;
  }
  next();
}

function token(size: number, random: RandomBytes): string {
  return random(size).toString('base64url');
}

function setCookie(
  res: Response,
  name: string,
  value: string,
  prefix: string,
  httpOnly: boolean,
  maxAge: number,
): void {
  res.cookie(name, value, {
    httpOnly,
    sameSite: 'strict',
    path: prefix,
    maxAge,
  });
}

function csrfMatches(req: Request, cookieName: string): boolean {
  const supplied = req.header('x-csrf-token') ?? '';
  const expected = cookies(req)[cookieName] ?? '';
  return Boolean(supplied && expected && constantTimeEqual(supplied, digest(expected)));
}

function providerFrom(req: Request): ProviderName | undefined {
  const value = req.params.provider;
  return typeof value === 'string' && PROVIDERS.has(value as ProviderName)
    ? (value as ProviderName)
    : undefined;
}

function credentialFrom(req: Request): string | undefined {
  if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) return undefined;
  const key = (req.body as Record<string, unknown>).key;
  if (typeof key !== 'string') return undefined;
  const trimmed = key.trim();
  if (!trimmed || /[\r\n]/.test(trimmed)) return undefined;
  return trimmed;
}

/**
 * The onboarding page sits beside a single-file bundle (`bundle/public/onboarding/`),
 * beside compiled `dist/transports/`, or in `src/` when running from source.
 */
export function resolvePublicDirectory(moduleUrl: string = import.meta.url): string {
  for (const relative of ['./public/onboarding/', '../public/onboarding/']) {
    const candidate = new URL(relative, moduleUrl);
    if (existsSync(candidate)) return fileURLToPath(candidate);
  }
  return fileURLToPath(new URL('../../src/public/onboarding/', moduleUrl));
}

function publicDirectory(explicit?: string): string {
  return explicit || resolvePublicDirectory();
}

/** The plugin root holds bundle-manifest.json, whether the code runs from dist/ or a bundle. */
export function resolveRepositoryRoot(moduleUrl: string = import.meta.url): string {
  return findUp(dirname(fileURLToPath(moduleUrl)), 'bundle-manifest.json')
    ?? fileURLToPath(new URL('../../../', moduleUrl));
}

function repositoryRoot(): string {
  return resolveRepositoryRoot();
}

// Built means either the compiled dist/ entry or the prebuilt bundle exists.
function probeBuildArtifact(
  root: string,
  candidates: string[],
): {
  path: string;
  exists: boolean;
  evidence: string;
} {
  const found = candidates.find((candidate) => existsSync(join(root, candidate)));
  return {
    path: found ?? candidates[0]!,
    exists: found !== undefined,
    evidence: found !== undefined
      ? 'Build artifact exists; existence is not proof of connectivity.'
      : 'Build artifact is absent; artifact existence would not be proof of connectivity.',
  };
}

export async function createAdminOnboardingRouter(
  options: AdminOnboardingOptions = {},
): Promise<express.Router> {
  const prefix = options.prefix ?? ADMIN_ONBOARDING_PREFIX;
  const pairingTtlMs = options.pairingTtlMs ?? 5 * 60_000;
  const sessionTtlMs = options.sessionTtlMs ?? 30 * 60_000;
  const maxPairingAttempts = options.maxPairingAttempts ?? 5;
  const now = options.now ?? Date.now;
  const random = options.randomBytes ?? nodeRandomBytes;
  const fetchImpl = options.fetchImpl ?? fetch;
  const env = options.env ?? process.env;
  const paths = options.paths ?? core.onboardingPaths(env);
  const staticDir = publicDirectory(options.publicDir);

  const pairingCode = token(16, random);
  const pairingDigest = digest(pairingCode);
  const pairingExpiresAt = now() + pairingTtlMs;
  let pairingConsumed = false;
  let pairingAttempts = 0;
  const sessions = new Map<string, SessionRecord>();

  if (options.pairingCodeSink) {
    options.pairingCodeSink(pairingCode);
  } else {
    process.stderr.write(`\nAI4S local onboarding pairing code: ${pairingCode}\n`);
  }

  const router = express.Router();
  router.use(hostAndOriginGuard);
  router.use((_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; connect-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
    );
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    next();
  });
  router.use((req, res, next) => {
    if (Object.keys(req.query).length > 0) {
      res.status(400).json({ error: 'Query parameters are not accepted on management routes.' });
      return;
    }
    next();
  });

  const sendIndex: RequestHandler = (req, res) => {
    // The page uses relative asset URLs (./styles.css, ./app.js, ./api/...).
    // Served from the bare prefix they would resolve to /admin/* and 404, so
    // redirect the exact prefix request to its trailing-slash form first.
    if (req.originalUrl === prefix) {
      res.redirect(302, `${prefix}/`);
      return;
    }
    const pairCsrf = token(24, random);
    setCookie(res, PAIR_CSRF_COOKIE, pairCsrf, prefix, false, pairingTtlMs);
    res.sendFile(join(staticDir, 'index.html'), STATIC_FILE_OPTIONS);
  };
  router.get('/', sendIndex);
  router.get('/index.html', sendIndex);
  router.get('/app.js', (_req, res) => res.sendFile(join(staticDir, 'app.js'), STATIC_FILE_OPTIONS));
  router.get('/styles.css', (_req, res) => res.sendFile(join(staticDir, 'styles.css'), STATIC_FILE_OPTIONS));

  router.use(express.json({ limit: '8mb' }));

  router.post('/api/pair', (req, res) => {
    if (!csrfMatches(req, PAIR_CSRF_COOKIE)) {
      res.status(403).json({ error: 'CSRF validation failed.' });
      return;
    }
    if (pairingAttempts >= maxPairingAttempts) {
      res.status(429).json({ error: 'Pairing attempts exceeded.' });
      return;
    }
    if (pairingConsumed || now() >= pairingExpiresAt) {
      res.status(403).json({ error: 'Pairing code unavailable.' });
      return;
    }

    const rawCode =
      req.body && typeof req.body === 'object' && !Array.isArray(req.body)
        ? (req.body as Record<string, unknown>).code
        : undefined;
    // Trim: pairing codes are base64url (no spaces), and terminal copy-paste
    // routinely drags a trailing newline/space along.
    const code = typeof rawCode === 'string' ? rawCode.trim() : undefined;
    if (typeof code !== 'string' || !constantTimeEqual(code, pairingDigest)) {
      pairingAttempts += 1;
      res.status(403).json({ error: 'Pairing failed.' });
      return;
    }

    pairingConsumed = true;
    options.onPaired?.();
    const sessionToken = token(32, random);
    const csrfToken = token(24, random);
    sessions.set(digest(sessionToken).toString('hex'), {
      expiresAt: now() + sessionTtlMs,
      csrfToken,
    });
    setCookie(res, SESSION_COOKIE, sessionToken, prefix, true, sessionTtlMs);
    setCookie(res, SESSION_CSRF_COOKIE, csrfToken, prefix, false, sessionTtlMs);
    res.json({ paired: true, expires_in_seconds: Math.floor(sessionTtlMs / 1000) });
  });

  router.use((req, res, next) => {
    const sessionToken = cookies(req)[SESSION_COOKIE];
    const session = sessionToken ? sessions.get(digest(sessionToken).toString('hex')) : undefined;
    if (!session || now() >= session.expiresAt) {
      if (sessionToken) sessions.delete(digest(sessionToken).toString('hex'));
      res.status(401).json({ error: 'Pairing required.' });
      return;
    }
    res.locals.onboardingSession = session;
    next();
  });

  router.use((req, res, next) => {
    if (['GET', 'HEAD'].includes(req.method)) return next();
    const session = res.locals.onboardingSession as SessionRecord;
    const supplied = req.header('x-csrf-token') ?? '';
    if (!supplied || !constantTimeEqual(supplied, digest(session.csrfToken))) {
      res.status(403).json({ error: 'CSRF validation failed.' });
      return;
    }
    next();
  });

  const status = (): RedactedOnboardingStatus => core.redactedStatus(paths, env);
  router.get('/api/status', (_req, res) => res.json(status()));

  // Decoupled from /api/status so the wizard contract stays credential-focused.
  // Host overlay uses T3.2 compatibility clues only; this endpoint never scans
  // host configuration directories and never passes measured connection observations.
  const dashboardStatus = (): RedactedOnboardingStatus => {
    const root = repositoryRoot();
    const current = core.redactedStatus(paths, env, { repositoryRoot: root });
    return {
      ...current,
      build_artifacts: {
        runtime: probeBuildArtifact(root, ['runtime/dist/index.js', 'runtime/bundle/index.mjs']),
        fulltext_runtime: probeBuildArtifact(root, ['fulltext-runtime/dist/index.js', 'fulltext-runtime/bundle/index.mjs']),
      },
    };
  };
  router.get('/api/dashboard', (_req, res) => res.json(dashboardStatus()));

  const verify = async (provider: ProviderName, key: string): Promise<Record<string, unknown>> => {
    if (provider === 'zotero') return core.verifyZoteroKey(key, fetchImpl);
    if (provider === 'pubmed') return core.verifyPubmedKey(key, fetchImpl);
    return core.verifyEasyScholarKey(key, fetchImpl);
  };

  router.post('/api/providers/:provider/verify', async (req, res) => {
    const provider = providerFrom(req);
    const key = credentialFrom(req);
    if (!provider || !key) {
      res.status(400).json({ error: 'A valid provider and credential are required.' });
      return;
    }
    try {
      const capabilities = await verify(provider, key);
      res.json({ provider, status: 'validated', capabilities });
    } catch {
      res.status(400).json({ error: 'Credential validation failed.' });
    }
  });

  router.post('/api/providers/:provider/save', async (req, res) => {
    const provider = providerFrom(req);
    const key = credentialFrom(req);
    if (!provider || !key) {
      res.status(400).json({ error: 'A valid provider and credential are required.' });
      return;
    }
    try {
      const capabilities = await verify(provider, key);
      if (provider === 'zotero') {
        core.saveZoteroKey(paths.zoteroEnv, paths.legacyZoteroEnv, key);
      } else {
        core.saveAcademicKey(
          paths.academicConfig,
          paths.legacyAcademicConfig,
          provider === 'pubmed' ? 'pubmed_api_key' : 'easyscholar_secret_key',
          key,
        );
      }
      res.json({
        provider,
        status: 'saved',
        capabilities,
        configuration: status().providers[provider],
      });
    } catch {
      res
        .status(400)
        .json({ error: 'Credential validation failed; existing configuration was not changed.' });
    }
  });

  router.use((_req, res) => res.status(404).json({ error: 'Management endpoint not found.' }));
  router.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const statusCode =
      typeof error === 'object' && error !== null && 'status' in error
        ? Number((error as { status?: unknown }).status)
        : 500;
    res
      .status(statusCode === 413 ? 413 : 400)
      .json({ error: statusCode === 413 ? 'Request body too large.' : 'Invalid request.' });
  });
  return router;
}

export async function mountAdminOnboarding(
  app: Express,
  options: AdminOnboardingOptions = {},
): Promise<void> {
  const prefix = options.prefix ?? ADMIN_ONBOARDING_PREFIX;
  app.use(prefix, await createAdminOnboardingRouter({ ...options, prefix }));
}
