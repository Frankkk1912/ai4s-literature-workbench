// A setup session is the key-entry page started from inside the MCP process, with the
// one-time code in the URL fragment. These tests run the real server on loopback and
// check the boundaries the design depends on.
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, statSync } from "node:fs";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";

const { startSetupSession, closeSetupSession } = await import("../runtime/src/lib/setup-session.ts");

afterEach(() => closeSetupSession());

// A session unrefs its listener and timers so it never keeps the MCP process alive. A test that
// awaits it must hold the event loop open itself, or the runner sees nothing left to wait for.
async function until(promise) {
  const hold = setInterval(() => {}, 50);
  try {
    return await promise;
  } finally {
    clearInterval(hold);
  }
}

const ZOTERO_OK = JSON.stringify({ userID: 7, username: "someone", access: { user: { library: true, write: true } } });
const fetchImpl = async () => new Response(ZOTERO_OK, { status: 200 });

function sandbox() {
  const dir = mkdtempSync(join(tmpdir(), "ai4s-setup-session-"));
  return {
    dir,
    paths: {
      zoteroEnv: join(dir, "zotero.env"),
      academicConfig: join(dir, "academic.json"),
      legacyZoteroEnv: join(dir, "legacy.env"),
      legacyAcademicConfig: join(dir, "legacy.json"),
      state: join(dir, "state.json"),
    },
    env: {},
  };
}

// A fresh socket per call (agent: false), so a test cannot pass by riding a kept-alive connection.
function call(session, method, path, { headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? undefined : JSON.stringify(body);
    const req = request(
      {
        host: "127.0.0.1",
        port: session.port,
        method,
        path: `/admin/onboarding${path}`,
        agent: false,
        headers: {
          ...(method === "POST" ? { origin: `http://127.0.0.1:${session.port}`, "content-type": "application/json" } : {}),
          ...(payload ? { "content-length": Buffer.byteLength(payload) } : {}),
          ...headers,
        },
      },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () =>
          resolve({ status: res.statusCode, headers: res.headers, text: Buffer.concat(chunks).toString("utf8") }),
        );
      },
    );
    req.on("error", reject);
    req.end(payload);
  });
}

function cookiesFrom(response) {
  return Object.fromEntries(
    (response.headers["set-cookie"] ?? []).map((c) => {
      const [pair] = c.split(";");
      const i = pair.indexOf("=");
      return [pair.slice(0, i), decodeURIComponent(pair.slice(i + 1))];
    }),
  );
}
const cookieHeader = (cookies) => Object.entries(cookies).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("; ");

async function pair(session, code) {
  const page = await call(session, "GET", "/");
  assert.equal(page.status, 200);
  const pairCookies = cookiesFrom(page);
  const response = await call(session, "POST", "/api/pair", {
    headers: {
      cookie: cookieHeader(pairCookies),
      "x-csrf-token": pairCookies.ai4s_onboarding_pair_csrf,
    },
    body: { code },
  });
  return { response, cookies: cookiesFrom(response) };
}

const codeOf = (session) => decodeURIComponent(new URL(session.launchUrl).hash.replace(/^#code=/, ""));

test("the launch address carries the code in the fragment, and the page address carries nothing", async () => {
  const box = sandbox();
  const session = await startSetupSession({ ...box, open: async () => true });
  assert.equal(session.opened, true);
  assert.equal(new URL(session.launchUrl).hostname, "127.0.0.1");
  assert.equal(codeOf(session), session.code);
  assert.equal(session.pageUrl.includes("#"), false);
  assert.equal(session.pageUrl.includes(session.code), false);
  assert.equal(new URL(session.launchUrl).search, "");
});

test("the fragment code opens a session once; the same code cannot be used again", async () => {
  const session = await startSetupSession({ ...sandbox(), open: async () => false });
  const first = await pair(session, codeOf(session));
  assert.equal(first.response.status, 200);
  const second = await pair(session, codeOf(session));
  assert.equal(second.response.status, 403);
  const wrong = await pair(session, "not-the-code");
  assert.notEqual(wrong.response.status, 200);
});

test("the page stays reachable on a new connection after pairing (the old tool closed it too early)", async () => {
  const session = await startSetupSession({ ...sandbox(), keys: ["zotero", "pubmed"], uiLanguage: "en", open: async () => false });
  const { response, cookies } = await pair(session, session.code);
  assert.equal(response.status, 200);
  await new Promise((r) => setTimeout(r, 400));
  const status = await call(session, "GET", "/api/status", { headers: { cookie: cookieHeader(cookies) } });
  assert.equal(status.status, 200);
  const body = JSON.parse(status.text);
  assert.deepEqual(body.requested_providers, ["zotero", "pubmed"]);
  assert.equal(body.ui_language, "en");
});

test("without a session, the page serves nothing but itself", async () => {
  const session = await startSetupSession({ ...sandbox(), open: async () => false });
  for (const path of ["/api/status", "/api/dashboard"]) {
    assert.equal((await call(session, "GET", path)).status, 401, path);
  }
  assert.equal((await call(session, "POST", "/api/finish", { body: {} })).status, 401);
  assert.equal((await call(session, "POST", "/api/providers/zotero/save", { body: { key: "x" } })).status, 401);
  // The page is still up: nothing above could close it.
  assert.equal((await call(session, "GET", "/")).status, 200);
});

test("a request with a foreign Host header is refused (DNS rebinding)", async () => {
  const session = await startSetupSession({ ...sandbox(), open: async () => false });
  const response = await call(session, "GET", "/", { headers: { host: `evil.example:${session.port}` } });
  assert.equal(response.status, 403);
});

test("the page sends no referrer and is never cached, so the fragment cannot travel on", async () => {
  const session = await startSetupSession({ ...sandbox(), open: async () => false });
  const page = await call(session, "GET", "/");
  assert.equal(page.headers["referrer-policy"], "no-referrer");
  assert.equal(page.headers["cache-control"], "no-store");
});

test("a saved key lands in a private file and never comes back out", async () => {
  const box = sandbox();
  const session = await startSetupSession({ ...box, keys: ["zotero"], fetchImpl, open: async () => false });
  const { cookies } = await pair(session, session.code);
  const key = "test-fixture-not-a-real-zotero-key";
  const saved = await call(session, "POST", "/api/providers/zotero/save", {
    headers: { cookie: cookieHeader(cookies), "x-csrf-token": cookies.ai4s_onboarding_csrf },
    body: { key },
  });
  assert.equal(saved.status, 200);
  assert.equal(saved.text.includes(key), false);
  assert.match(readFileSync(box.paths.zoteroEnv, "utf8"), new RegExp(`ZOTERO_API_KEY=${key}`));
  if (process.platform !== "win32") assert.equal(statSync(box.paths.zoteroEnv).mode & 0o777, 0o600);

  for (const path of ["/api/status", "/api/dashboard"]) {
    const response = await call(session, "GET", path, { headers: { cookie: cookieHeader(cookies) } });
    assert.equal(response.text.includes(key), false, path);
  }
});

test("a rejected key changes nothing on disk", async () => {
  const box = sandbox();
  const reject = async () => new Response("{}", { status: 403 });
  const session = await startSetupSession({ ...box, fetchImpl: reject, open: async () => false });
  const { cookies } = await pair(session, session.code);
  const saved = await call(session, "POST", "/api/providers/zotero/save", {
    headers: { cookie: cookieHeader(cookies), "x-csrf-token": cookies.ai4s_onboarding_csrf },
    body: { key: "bad-key-value-123456" },
  });
  assert.equal(saved.status, 400);
  assert.equal(existsSync(box.paths.zoteroEnv), false);
});

test("finishing closes the page; so does an unused code after its time", async () => {
  const done = await startSetupSession({ ...sandbox(), open: async () => false });
  const { cookies } = await pair(done, done.code);
  const finish = await call(done, "POST", "/api/finish", {
    headers: { cookie: cookieHeader(cookies), "x-csrf-token": cookies.ai4s_onboarding_csrf },
    body: {},
  });
  assert.equal(finish.status, 200);
  await until(done.finished);
  await assert.rejects(() => call(done, "GET", "/"), /ECONNREFUSED/);

  const idle = await startSetupSession({ ...sandbox(), pairingTtlMs: 120, open: async () => false });
  await until(idle.finished);
  await assert.rejects(() => call(idle, "GET", "/"), /ECONNREFUSED/);
});

test("starting a new page closes the old one", async () => {
  const first = await startSetupSession({ ...sandbox(), open: async () => false });
  const second = await startSetupSession({ ...sandbox(), open: async () => false });
  await until(first.finished);
  await assert.rejects(() => call(first, "GET", "/"), /ECONNREFUSED/);
  assert.equal((await call(second, "GET", "/")).status, 200);
});

test("two pages started at once leave exactly one listening", async () => {
  const results = await Promise.allSettled([
    startSetupSession({ ...sandbox(), open: async () => false }),
    startSetupSession({ ...sandbox(), open: async () => false }),
  ]);
  const started = results.filter((r) => r.status === "fulfilled").map((r) => r.value);
  assert.ok(started.length >= 1);
  let listening = 0;
  for (const session of started) {
    try {
      if ((await call(session, "GET", "/")).status === 200) listening += 1;
    } catch {
      // closed
    }
  }
  assert.equal(listening, 1);
});
