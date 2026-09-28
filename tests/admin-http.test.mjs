import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { request as httpRequest } from "node:http";
import { afterEach, test } from "node:test";

// Root node:test runs before the runtime build in CI. Build here so this black-box
// suite exercises the same emitted JavaScript and copied static assets users run.
execFileSync(
  process.platform === "win32" ? "npm.cmd" : "npm",
  ["run", "build"],
  {
    cwd: new URL("../runtime/", import.meta.url),
    stdio: "pipe",
  },
);

const { McpServer } =
  await import("../runtime/node_modules/@modelcontextprotocol/sdk/dist/esm/server/mcp.js");
const { loadOnboardingCore } =
  await import("../runtime/dist/lib/onboarding-core.js");
const { createMetrics } = await import("../runtime/dist/lib/metrics.js");
const { startHttp } = await import("../runtime/dist/transports/http.js");
const sharedCore = await import("../scripts/onboarding-core.mjs");

const openServers = new Set();
afterEach(async () => {
  await Promise.all(
    [...openServers].map(
      (server) => new Promise((resolve) => server.close(resolve)),
    ),
  );
  openServers.clear();
});

function bareServer() {
  return new McpServer(
    { name: "admin-http-test", version: "0.0.0" },
    { capabilities: { tools: {} } },
  );
}

function temporaryPaths(prefix = "ai4s-admin-http-") {
  const root = mkdtempSync(join(tmpdir(), prefix));
  return {
    root,
    paths: {
      zoteroEnv: join(root, "native", "zotero.env"),
      legacyZoteroEnv: join(root, "legacy", "zotero.env"),
      academicConfig: join(root, "native", "academic.json"),
      legacyAcademicConfig: join(root, "legacy", "academic.json"),
      state: join(root, "native", "onboarding.json"),
    },
  };
}

function baseUrl(server, hostname = "127.0.0.1") {
  const address = server.address();
  assert.equal(typeof address, "object");
  return `http://${hostname}:${address.port}`;
}

function responseCookies(response) {
  return Object.fromEntries(
    response.headers.getSetCookie().map((entry) => {
      const [pair] = entry.split(";");
      const separator = pair.indexOf("=");
      return [
        pair.slice(0, separator),
        decodeURIComponent(pair.slice(separator + 1)),
      ];
    }),
  );
}

function cookieHeader(values) {
  return Object.entries(values)
    .map(([name, value]) => `${name}=${encodeURIComponent(value)}`)
    .join("; ");
}

function rawRequest(url, options = {}) {
  return new Promise((resolve, reject) => {
    const request = httpRequest(url, options, (response) => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => {
        body += chunk;
      });
      response.on("end", () =>
        resolve({
          status: response.statusCode,
          body,
          headers: response.headers,
        }),
      );
    });
    request.on("error", reject);
    if (options.body) request.write(options.body);
    request.end();
  });
}

async function startAdmin(overrides = {}) {
  const capturedCodes = [];
  const logs = [];
  const { paths } = temporaryPaths();
  const server = await startHttp(() => bareServer(), {
    port: 0,
    host: "127.0.0.1",
    logger: {
      debug: (...args) => logs.push(["debug", ...args]),
      info: (...args) => logs.push(["info", ...args]),
      warn: (...args) => logs.push(["warn", ...args]),
      error: (...args) => logs.push(["error", ...args]),
    },
    adminOnboarding: {
      paths,
      env: {},
      pairingCodeSink: (code) => capturedCodes.push(code),
      ...overrides.adminOnboarding,
    },
    ...overrides.http,
  });
  openServers.add(server);
  return { server, base: baseUrl(server), paths, capturedCodes, logs };
}

async function pairingPage(base) {
  const response = await fetch(`${base}/admin/onboarding`);
  assert.equal(response.status, 200);
  return {
    response,
    cookies: responseCookies(response),
    text: await response.text(),
  };
}

async function pair(base, code, pairCookies) {
  const csrf = pairCookies.ai4s_onboarding_pair_csrf;
  const response = await fetch(`${base}/admin/onboarding/api/pair`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: base,
      Cookie: cookieHeader(pairCookies),
      "X-CSRF-Token": csrf,
    },
    body: JSON.stringify({ code }),
  });
  return { response, cookies: responseCookies(response) };
}

function sessionHeaders(
  base,
  sessionCookies,
  includeOrigin = true,
  includeCsrf = true,
) {
  return {
    Cookie: cookieHeader(sessionCookies),
    ...(includeOrigin ? { Origin: base } : {}),
    ...(includeCsrf
      ? { "X-CSRF-Token": sessionCookies.ai4s_onboarding_csrf }
      : {}),
  };
}

async function pairedAdmin(overrides = {}) {
  const started = await startAdmin(overrides);
  const page = await pairingPage(started.base);
  const paired = await pair(
    started.base,
    started.capturedCodes[0],
    page.cookies,
  );
  assert.equal(paired.response.status, 200);
  return {
    ...started,
    page,
    pairResponse: paired.response,
    sessionCookies: paired.cookies,
  };
}

test("runtime bridge and CLI load the exact same onboarding core implementation", async () => {
  const bridged = await loadOnboardingCore();
  assert.equal(bridged.redactedStatus, sharedCore.redactedStatus);
  assert.equal(bridged.verifyZoteroKey, sharedCore.verifyZoteroKey);
  assert.equal(bridged.saveAcademicKey, sharedCore.saveAcademicKey);
});

test("loopback mode serves only the public pairing page before authorization and preserves ops/MCP routes", async () => {
  const metrics = createMetrics();
  metrics.inc("http_requests_total", 1, { status_class: "2xx" });
  const started = await startAdmin({
    http: { metrics, readiness: async () => ({ ok: true, checks: {} }) },
  });
  const page = await pairingPage(started.base);
  assert.match(page.text, /配置向导/);
  assert.doesNotMatch(page.text, /configured|private_config|environment/);
  assert.equal(started.capturedCodes.length, 1);
  assert.ok(
    started.capturedCodes[0].length >= 22,
    "16 random bytes must provide at least 128 bits",
  );

  for (const endpoint of ["/api/status", "/dashboard", "/api/other"]) {
    const response = await fetch(`${started.base}/admin/onboarding${endpoint}`);
    assert.equal(response.status, 401, `${endpoint} must require pairing`);
  }
  const write = await fetch(
    `${started.base}/admin/onboarding/api/providers/zotero/verify`,
    {
      method: "POST",
      headers: { Origin: started.base, "Content-Type": "application/json" },
      body: JSON.stringify({ key: "not-authorized" }),
    },
  );
  assert.equal(write.status, 401);

  assert.equal((await fetch(`${started.base}/healthz`)).status, 200);
  assert.equal((await fetch(`${started.base}/readyz`)).status, 200);
  assert.equal((await fetch(`${started.base}/metrics`)).status, 200);
  const mcp = await fetch(`${started.base}/mcp`);
  assert.equal(mcp.status, 400);
  assert.equal(mcp.headers.get("access-control-allow-origin"), "*");
  assert.equal((await fetch(`${started.base}/not-found`)).status, 404);
});

test("OAuth and non-loopback modes do not mount endpoints or produce a pairing code", async () => {
  const oauthCodes = [];
  const oauth = {
    mount() {},
    provider: {
      verifyAccessToken: async () => {
        throw new Error("unused");
      },
    },
    resourceMetadataUrl:
      "https://auth.invalid/.well-known/oauth-protected-resource",
    allowedHosts: ["127.0.0.1"],
  };
  const oauthServer = await startHttp(() => bareServer(), {
    port: 0,
    host: "127.0.0.1",
    oauth,
    adminOnboarding: { pairingCodeSink: (code) => oauthCodes.push(code) },
  });
  openServers.add(oauthServer);
  assert.equal(
    (await fetch(`${baseUrl(oauthServer)}/admin/onboarding`)).status,
    404,
  );
  assert.deepEqual(oauthCodes, []);

  const remoteCodes = [];
  const remoteServer = await startHttp(() => bareServer(), {
    port: 0,
    host: "0.0.0.0",
    allowInsecureBind: true,
    adminOnboarding: { pairingCodeSink: (code) => remoteCodes.push(code) },
  });
  openServers.add(remoteServer);
  assert.equal(
    (await fetch(`${baseUrl(remoteServer)}/admin/onboarding`)).status,
    404,
  );
  assert.deepEqual(remoteCodes, []);
});

test("pairing is single-use, rate-limited, expiring, and absent from URL/logger output", async () => {
  let now = 10_000;
  const started = await startAdmin({
    adminOnboarding: {
      now: () => now,
      pairingTtlMs: 100,
      maxPairingAttempts: 2,
    },
  });
  const page = await pairingPage(started.base);
  const code = started.capturedCodes[0];
  assert.equal(page.text.includes(code), false);

  const firstWrong = await pair(started.base, "wrong-one", page.cookies);
  assert.equal(firstWrong.response.status, 403);
  const secondWrong = await pair(started.base, "wrong-two", page.cookies);
  assert.equal(secondWrong.response.status, 403);
  const limited = await pair(started.base, code, page.cookies);
  assert.equal(limited.response.status, 429);

  const expiring = await startAdmin({
    adminOnboarding: { now: () => now, pairingTtlMs: 100 },
  });
  const expiringPage = await pairingPage(expiring.base);
  now += 100;
  const expired = await pair(
    expiring.base,
    expiring.capturedCodes[0],
    expiringPage.cookies,
  );
  assert.equal(expired.response.status, 403);

  const replaying = await startAdmin();
  const replayPage = await pairingPage(replaying.base);
  const paired = await pair(
    replaying.base,
    replaying.capturedCodes[0],
    replayPage.cookies,
  );
  assert.equal(paired.response.status, 200);
  const replay = await pair(
    replaying.base,
    replaying.capturedCodes[0],
    replayPage.cookies,
  );
  assert.equal(replay.response.status, 403);

  const serializedLogs = JSON.stringify([
    ...started.logs,
    ...expiring.logs,
    ...replaying.logs,
  ]);
  for (const candidate of [
    code,
    expiring.capturedCodes[0],
    replaying.capturedCodes[0],
  ]) {
    assert.equal(serializedLogs.includes(candidate), false);
  }
  assert.ok(
    started.logs.every((entry) => !String(entry[2]?.path ?? "").includes("?")),
  );
});

test("sessions support multiple operations, expire, and are invalid after server restart", async () => {
  let now = 50_000;
  const first = await pairedAdmin({
    adminOnboarding: { now: () => now, sessionTtlMs: 100 },
  });
  const sessionSetCookie = first.pairResponse.headers.getSetCookie().join("\n");
  assert.match(sessionSetCookie, /ai4s_onboarding_session=.*HttpOnly/i);
  assert.match(sessionSetCookie, /SameSite=Strict/i);
  assert.match(sessionSetCookie, /Path=\/admin\/onboarding/i);
  const headers = sessionHeaders(
    first.base,
    first.sessionCookies,
    false,
    false,
  );
  assert.equal(
    (await fetch(`${first.base}/admin/onboarding/api/status`, { headers }))
      .status,
    200,
  );
  assert.equal(
    (await fetch(`${first.base}/admin/onboarding/api/status`, { headers }))
      .status,
    200,
  );

  const second = await startAdmin();
  const oldSessionOnRestart = await fetch(
    `${second.base}/admin/onboarding/api/status`,
    {
      headers: { Cookie: cookieHeader(first.sessionCookies) },
    },
  );
  assert.equal(oldSessionOnRestart.status, 401);

  now += 100;
  assert.equal(
    (await fetch(`${first.base}/admin/onboarding/api/status`, { headers }))
      .status,
    401,
  );
});

test("Host, Origin, CSRF, rebinding, and query guards cover management GET and every POST", async () => {
  const started = await pairedAdmin();
  const statusUrl = `${started.base}/admin/onboarding/api/status`;
  const cookie = cookieHeader(started.sessionCookies);

  assert.equal(
    (
      await rawRequest(statusUrl, {
        headers: { Cookie: cookie, Host: "attacker.invalid" },
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await fetch(statusUrl, {
        headers: { Cookie: cookie, Origin: "http://attacker.invalid" },
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await fetch(`${statusUrl}?credential=forbidden`, {
        headers: { Cookie: cookie },
      })
    ).status,
    400,
  );

  const endpoint = `${started.base}/admin/onboarding/api/providers/pubmed/verify`;
  const body = JSON.stringify({ key: "csrf-test-value" });
  const noOrigin = await fetch(endpoint, {
    method: "POST",
    headers: {
      Cookie: cookie,
      "Content-Type": "application/json",
      "X-CSRF-Token": started.sessionCookies.ai4s_onboarding_csrf,
    },
    body,
  });
  assert.equal(noOrigin.status, 403);
  const noCsrf = await fetch(endpoint, {
    method: "POST",
    headers: {
      Cookie: cookie,
      Origin: started.base,
      "Content-Type": "application/json",
    },
    body,
  });
  assert.equal(noCsrf.status, 403);
  const forgedHost = await rawRequest(endpoint, {
    method: "POST",
    headers: {
      ...sessionHeaders(started.base, started.sessionCookies),
      Host: "rebind.invalid",
      "Content-Type": "application/json",
    },
    body,
  });
  assert.equal(forgedHost.status, 403);
  const forgedOrigin = await fetch(endpoint, {
    method: "POST",
    headers: {
      ...sessionHeaders(started.base, started.sessionCookies),
      Origin: "http://localhost.invalid",
      "Content-Type": "application/json",
    },
    body,
  });
  assert.equal(forgedOrigin.status, 403);

  const pairWithoutOrigin = await fetch(
    `${started.base}/admin/onboarding/api/pair`,
    {
      method: "POST",
      headers: {
        Cookie: cookieHeader(started.page.cookies),
        "Content-Type": "application/json",
        "X-CSRF-Token": started.page.cookies.ai4s_onboarding_pair_csrf,
      },
      body: JSON.stringify({ code: "anything" }),
    },
  );
  assert.equal(pairWithoutOrigin.status, 403);
  const pairWithoutCsrf = await fetch(
    `${started.base}/admin/onboarding/api/pair`,
    {
      method: "POST",
      headers: {
        Cookie: cookieHeader(started.page.cookies),
        Origin: started.base,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ code: "anything" }),
    },
  );
  assert.equal(pairWithoutCsrf.status, 403);
});

test("validate/save uses only approved official endpoints, persists after validation, and never returns or logs keys", async () => {
  const requests = [];
  const secrets = {
    zotero: "zotero-admin-secret-value",
    pubmed: "pubmed-admin-secret-value",
    easyscholar: "easy-admin-secret-value",
  };
  const mockFetch = async (url, options = {}) => {
    requests.push({ url: new URL(String(url)), options });
    if (String(url).includes("api.zotero.org")) {
      return new Response(
        JSON.stringify({
          userID: 42,
          username: "researcher",
          access: { user: { library: true, write: true }, groups: {} },
        }),
        { status: 200 },
      );
    }
    if (String(url).includes("einfo.fcgi"))
      return new Response(JSON.stringify({ einforesult: {} }), { status: 200 });
    return new Response(JSON.stringify({ code: 200, data: {} }), {
      status: 200,
    });
  };
  const started = await pairedAdmin({
    adminOnboarding: { fetchImpl: mockFetch },
  });
  const responses = [];
  for (const [provider, key] of Object.entries(secrets)) {
    for (const action of ["verify", "save"]) {
      const response = await fetch(
        `${started.base}/admin/onboarding/api/providers/${provider}/${action}`,
        {
          method: "POST",
          headers: {
            ...sessionHeaders(started.base, started.sessionCookies),
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ key }),
        },
      );
      assert.equal(response.status, 200);
      responses.push(await response.text());
    }
  }

  const statusResponse = await fetch(
    `${started.base}/admin/onboarding/api/status`,
    {
      headers: { Cookie: cookieHeader(started.sessionCookies) },
    },
  );
  const statusText = await statusResponse.text();
  const status = JSON.parse(statusText);
  assert.equal(status.providers.zotero.source, "private_config");
  assert.equal(status.providers.pubmed.source, "private_config");
  assert.equal(status.providers.easyscholar.source, "private_config");
  assert.ok(
    readFileSync(started.paths.zoteroEnv, "utf8").includes(secrets.zotero),
  );
  const academic = JSON.parse(
    readFileSync(started.paths.academicConfig, "utf8"),
  );
  assert.equal(academic.pubmed_api_key, secrets.pubmed);
  assert.equal(academic.easyscholar_secret_key, secrets.easyscholar);

  assert.ok(
    requests.every(({ url }) =>
      [
        "https://api.zotero.org",
        "https://eutils.ncbi.nlm.nih.gov",
        "https://www.easyscholar.cc",
      ].includes(url.origin),
    ),
  );
  const zotero = requests.find(
    ({ url }) => url.origin === "https://api.zotero.org",
  );
  const pubmed = requests.find(
    ({ url }) => url.origin === "https://eutils.ncbi.nlm.nih.gov",
  );
  const easy = requests.find(
    ({ url }) => url.origin === "https://www.easyscholar.cc",
  );
  assert.equal(zotero.url.search, "");
  assert.equal(zotero.options.headers["Zotero-API-Key"], secrets.zotero);
  assert.equal(pubmed.url.searchParams.get("api_key"), secrets.pubmed);
  assert.equal(easy.url.searchParams.get("secretKey"), secrets.easyscholar);

  const exposedSurfaces = JSON.stringify({
    responses,
    statusText,
    logs: started.logs,
  });
  for (const key of Object.values(secrets))
    assert.equal(exposedSurfaces.includes(key), false);
});

test("invalid, HTTP, and network failures do not overwrite files or expose key-bearing URLs", async () => {
  const existing = "existing-private-value";
  const invalid = "invalid-admin-secret-value";
  const network = "network-admin-secret-value";
  let mode = "valid";
  const mockFetch = async (url) => {
    if (mode === "network") throw new Error(`upstream failed at ${url}`);
    if (mode === "invalid") return new Response("rejected", { status: 401 });
    return new Response(JSON.stringify({ einforesult: {} }), { status: 200 });
  };
  const started = await pairedAdmin({
    adminOnboarding: { fetchImpl: mockFetch },
  });
  const request = async (key) => {
    const response = await fetch(
      `${started.base}/admin/onboarding/api/providers/pubmed/save`,
      {
        method: "POST",
        headers: {
          ...sessionHeaders(started.base, started.sessionCookies),
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ key }),
      },
    );
    return { response, text: await response.text() };
  };

  const initial = await request(existing);
  assert.equal(initial.response.status, 200);
  mode = "invalid";
  const rejected = await request(invalid);
  assert.equal(rejected.response.status, 400);
  assert.equal(
    JSON.parse(readFileSync(started.paths.academicConfig, "utf8"))
      .pubmed_api_key,
    existing,
  );
  mode = "network";
  const failed = await request(network);
  assert.equal(failed.response.status, 400);
  assert.equal(
    JSON.parse(readFileSync(started.paths.academicConfig, "utf8"))
      .pubmed_api_key,
    existing,
  );

  const surfaces = JSON.stringify({
    rejected: rejected.text,
    failed: failed.text,
    logs: started.logs,
  });
  for (const key of [invalid, network]) {
    assert.equal(surfaces.includes(key), false);
    assert.equal(surfaces.includes(encodeURIComponent(key)), false);
  }
  assert.equal(surfaces.includes("einfo.fcgi?"), false);
});

test("admin JSON body limit remains 8mb and oversized errors are redacted", async () => {
  const started = await pairedAdmin();
  const secret = `oversized-private-${"x".repeat(8 * 1024 * 1024)}`;
  const response = await fetch(
    `${started.base}/admin/onboarding/api/providers/zotero/verify`,
    {
      method: "POST",
      headers: {
        ...sessionHeaders(started.base, started.sessionCookies),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ key: secret }),
    },
  );
  const text = await response.text();
  assert.equal(response.status, 413);
  assert.equal(text.includes("oversized-private"), false);
  assert.equal(
    JSON.stringify(started.logs).includes("oversized-private"),
    false,
  );
});

test("pairing page assets expose forms and privacy boundaries without constructing credential URLs", async () => {
  const started = await startAdmin();
  const page = await pairingPage(started.base);
  const script = await (
    await fetch(`${started.base}/admin/onboarding/app.js`)
  ).text();
  const css = await fetch(`${started.base}/admin/onboarding/styles.css`);
  assert.equal(css.status, 200);
  assert.match(script, /Zotero Web API/);
  assert.match(page.text, /PubMed \/ EasyScholar/);
  assert.match(page.text, /DevTools/);
  assert.match(page.text, /状态看板（M5）/);
  assert.match(script, /JSON\.stringify\(\{ key \}\)/);
  assert.doesNotMatch(script, /searchParams|location\.(?:search|hash)|\?key=/);
});
