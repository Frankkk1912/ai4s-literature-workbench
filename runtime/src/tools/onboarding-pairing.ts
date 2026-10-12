import { randomBytes } from 'node:crypto';
import type { Server } from 'node:http';
import express from 'express';
import { mountAdminOnboarding } from '../transports/admin.js';
import type { ToolDefinition } from '../registry/registry.js';
import { ok } from '../registry/registry.js';

// Lets an agent hand the user a one-time pairing code for the local onboarding
// page, which is where API keys are typed. The agent receives only the address,
// the code, and its expiry. It never receives, stores, or returns any key.
//
// The page listens on 127.0.0.1 only. The server is started on demand and closed
// when the code expires, so nothing stays listening between uses.

const PAIRING_TTL_MS = 5 * 60_000;
const HOST = '127.0.0.1';

let active: { server: Server; timer: NodeJS.Timeout } | undefined;

function closeActive(): void {
  if (!active) return;
  clearTimeout(active.timer);
  active.server.close();
  active = undefined;
}

export async function startPairingServer(
  ttlMs: number = PAIRING_TTL_MS,
): Promise<{ port: number; code: string; expiresAt: number }> {
  if (active) {
    // Reuse a live server only while its code is still valid. Otherwise start fresh.
    throw new Error('A pairing session is already open. Wait for it to expire or finish, then ask again.');
  }
  const app = express();
  let capturedCode: string | undefined;
  await mountAdminOnboarding(app, {
    pairingTtlMs: ttlMs,
    // Capture the code instead of letting the admin router write it to stderr,
    // so the agent can read it and relay it to the user.
    pairingCodeSink: (code) => {
      capturedCode = code;
    },
    // Close the page as soon as the code is used, not when the timer expires.
    onPaired: () => closeActive(),
  });
  const server = await new Promise<Server>((resolve, reject) => {
    const s = app.listen(0, HOST, () => resolve(s));
    s.on('error', reject);
  });
  const address = server.address();
  if (!address || typeof address === 'string') {
    server.close();
    throw new Error('Could not determine the pairing server port.');
  }
  const timer = setTimeout(closeActive, ttlMs);
  timer.unref();
  active = { server, timer };
  if (!capturedCode) {
    server.close();
    active = undefined;
    throw new Error('Pairing code was not generated.');
  }
  return { port: address.port, code: capturedCode, expiresAt: Date.now() + ttlMs };
}

const onboardingPairingTool: ToolDefinition = {
  name: 'onboarding_pairing_code',
  title: 'Open the local API-key setup page',
  description:
    'Start the local onboarding page and return its address and a one-time pairing code. Relay ONLY the address and the code to the user, and tell them to type their API keys on that page. Never ask the user for an API key in chat, and never pass a key to this tool. The code expires in 5 minutes and works once.',
  inputSchema: {},
  annotations: { readOnlyHint: false, openWorldHint: false },
  handler: async () => {
    const { port, code, expiresAt } = await startPairingServer();
    const url = `http://${HOST}:${port}/admin/onboarding/`;
    return ok(
      {
        url,
        pairing_code: code,
        expires_at: new Date(expiresAt).toISOString(),
        instructions:
          'Open the URL, enter the pairing code, then type the API keys on that page. Keys are not sent to this chat.',
      },
      `Local setup page: ${url} . Pairing code valid for 5 minutes.`,
    );
  },
};

export default onboardingPairingTool;
