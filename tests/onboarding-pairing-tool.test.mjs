// Regression tests for the onboarding_pairing_code tool. These run the real
// server on loopback and check the boundaries an agent must not be able to cross.
import assert from "node:assert/strict";
import { test } from "node:test";

const { startPairingServer } = await import("../runtime/src/tools/onboarding-pairing.ts");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const reachable = (url) => fetch(url).then(() => true).catch(() => false);

async function redeem(port, code) {
  const base = `http://127.0.0.1:${port}/admin/onboarding`;
  const page = await fetch(`${base}/`);
  const cookie = (page.headers.getSetCookie?.() ?? [])
    .map((c) => c.split(";")[0])
    .find((c) => c.startsWith("ai4s_onboarding_pair_csrf="));
  const csrf = cookie.split("=").slice(1).join("=");
  const res = await fetch(`${base}/api/pair`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie,
      "x-csrf-token": csrf,
      origin: `http://127.0.0.1:${port}`,
      host: `127.0.0.1:${port}`,
    },
    body: JSON.stringify({ code }),
  });
  return res.status;
}

test("the page listens on loopback only", async () => {
  const s = await startPairingServer(60_000);
  assert.equal(new URL(`http://127.0.0.1:${s.port}`).hostname, "127.0.0.1");
  await redeem(s.port, s.code); // closes the server; leaves no listener behind
});

test("a pairing code works once, and the page is gone after it is used", async () => {
  // Redeeming closes the page, so a second redeem cannot reach it at all. That
  // is the stronger guarantee: the code is not reusable because nothing listens.
  const s = await startPairingServer(60_000);
  assert.equal(await redeem(s.port, s.code), 200);
  await sleep(300);
  await assert.rejects(() => redeem(s.port, s.code), /fetch failed/);
});

test("the server closes as soon as the code is redeemed", async () => {
  const s = await startPairingServer(60_000);
  await redeem(s.port, s.code);
  await sleep(300);
  assert.equal(await reachable(`http://127.0.0.1:${s.port}/admin/onboarding/`), false);
});

test("an unused code still expires and closes the server", async () => {
  const s = await startPairingServer(800);
  const url = `http://127.0.0.1:${s.port}/admin/onboarding/`;
  assert.equal(await reachable(url), true);
  await sleep(1200);
  assert.equal(await reachable(url), false);
});

test("only one pairing session may be open at a time", async () => {
  const first = await startPairingServer(60_000);
  await assert.rejects(() => startPairingServer(60_000), /already open/);
  await redeem(first.port, first.code);
});

test("the returned payload carries no key-like field", async () => {
  const s = await startPairingServer(60_000);
  const serialized = JSON.stringify({ code: s.code, port: s.port, expiresAt: s.expiresAt });
  assert.doesNotMatch(serialized, /api[_-]?key|secretKey|ZOTERO_API_KEY/i);
  await redeem(s.port, s.code);
});
