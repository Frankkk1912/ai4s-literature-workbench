import type { Server } from 'node:http';
import express from 'express';
import { ADMIN_ONBOARDING_PREFIX, mountAdminOnboarding } from '../transports/admin.js';
import { openInBrowser } from './browser-open.js';
import type { OnboardingPaths, ProviderName } from './onboarding-core.mjs';

// A setup session runs the key-entry page from inside this process, so no one has to
// start a server or copy a code out of a terminal. It listens on 127.0.0.1 only and
// opens the user's browser with the one-time pairing code in the URL fragment. A
// fragment is handled by the browser alone and is never sent to the server, so it does
// not reach request logs or a Referer header. The page redeems it at once and clears it
// from the address bar. The same code can still be typed into the page as a fallback.

const HOST = '127.0.0.1';
export const SETUP_PAIRING_TTL_MS = 5 * 60_000;
export const SETUP_SESSION_TTL_MS = 30 * 60_000;
// Gives the page time to show its last message before the listener goes away.
const FINISH_GRACE_MS = 1500;

export interface SetupSessionOptions {
  /** Keys to offer, in order. Empty or omitted means all three. */
  keys?: ProviderName[];
  uiLanguage?: 'zh' | 'en';
  pairingTtlMs?: number;
  sessionTtlMs?: number;
  /** Keep the process alive while the session is open (the --setup launcher mode). */
  keepAlive?: boolean;
  open?: (url: string) => Promise<boolean>;
  env?: NodeJS.ProcessEnv;
  paths?: OnboardingPaths;
  fetchImpl?: typeof fetch;
}

export interface SetupSession {
  /** Address of the setup page, without any token. Safe to show to the user or an agent. */
  pageUrl: string;
  /** Address carrying the one-time code in its fragment. Only the browser launcher gets this. */
  launchUrl: string;
  port: number;
  /** One-time pairing code, for the page's code form when the browser could not be opened. */
  code: string;
  /** Whether the default browser was launched. A launch is not proof a window appeared. */
  opened: boolean;
  keys: ProviderName[];
  expiresAt: number;
  /** Resolves when the listener is closed: finished, expired, or replaced by a newer session. */
  finished: Promise<void>;
  close: () => void;
}

const ALL_KEYS: ProviderName[] = ['zotero', 'pubmed', 'easyscholar'];

let active: { close: () => void } | undefined;

export function closeSetupSession(): void {
  active?.close();
}

export async function startSetupSession(options: SetupSessionOptions = {}): Promise<SetupSession> {
  // One page at a time: a new request replaces the old one rather than leaving two listeners.
  closeSetupSession();

  const pairingTtlMs = options.pairingTtlMs ?? SETUP_PAIRING_TTL_MS;
  const sessionTtlMs = options.sessionTtlMs ?? SETUP_SESSION_TTL_MS;
  const keys = options.keys && options.keys.length > 0 ? [...new Set(options.keys)] : ALL_KEYS;
  const open = options.open ?? openInBrowser;

  let server: Server | undefined;
  let closed = false;
  let resolveFinished!: () => void;
  const finished = new Promise<void>((resolve) => {
    resolveFinished = resolve;
  });
  let pairTimer: NodeJS.Timeout | undefined;
  let sessionTimer: NodeJS.Timeout | undefined;
  let finishTimer: NodeJS.Timeout | undefined;

  const self = {
    close: (): void => {
      if (closed) return;
      closed = true;
      clearTimeout(pairTimer);
      clearTimeout(sessionTimer);
      clearTimeout(finishTimer);
      if (active === self) active = undefined;
      server?.close();
      server?.closeAllConnections();
      resolveFinished();
    },
  };

  // Claim the slot before any await, so a second call made while this one is still starting
  // up closes it instead of leaving two listeners.
  active = self;

  let code: string | undefined;
  const app = express();
  await mountAdminOnboarding(app, {
    pairingTtlMs,
    sessionTtlMs,
    requestedProviders: keys,
    uiLanguage: options.uiLanguage,
    env: options.env,
    paths: options.paths,
    fetchImpl: options.fetchImpl,
    // Capture the code instead of letting the router print it to stderr.
    pairingCodeSink: (value) => {
      code = value;
    },
    onPaired: () => {
      clearTimeout(pairTimer);
      sessionTimer = setTimeout(self.close, sessionTtlMs);
      if (!options.keepAlive) sessionTimer.unref();
    },
    onFinished: () => {
      finishTimer = setTimeout(self.close, FINISH_GRACE_MS);
      if (!options.keepAlive) finishTimer.unref();
    },
  });
  if (!code) throw new Error('The setup page could not create its one-time code.');

  const listening = await new Promise<Server>((resolve, reject) => {
    const s = app.listen(0, HOST, () => resolve(s));
    s.once('error', reject);
  });
  server = listening;
  if (closed) {
    listening.close();
    throw new Error('A newer setup page replaced this one before it finished starting.');
  }
  if (!options.keepAlive) listening.unref();
  const address = listening.address();
  if (!address || typeof address === 'string') {
    listening.close();
    throw new Error('Could not determine the setup page port.');
  }

  const expiresAt = Date.now() + pairingTtlMs;
  pairTimer = setTimeout(self.close, pairingTtlMs);
  if (!options.keepAlive) pairTimer.unref();

  const pageUrl = `http://${HOST}:${address.port}${ADMIN_ONBOARDING_PREFIX}/`;
  const launchUrl = `${pageUrl}#code=${encodeURIComponent(code)}`;
  const opened = await open(launchUrl).catch(() => false);

  return {
    pageUrl,
    launchUrl,
    port: address.port,
    code,
    opened,
    keys,
    expiresAt,
    finished,
    close: self.close,
  };
}
