import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { request as httpRequest } from "node:http";
import { afterEach, test } from "node:test";

import {
  mapDashboard,
  redactSensitive,
  renderDashboard,
  serializeRendered,
} from "../runtime/src/public/onboarding/dashboard.js";

const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
execFileSync(npmCommand, ["run", "build"], {
  cwd: new URL("../runtime/", import.meta.url),
  stdio: "pipe",
  shell: process.platform === "win32",
});

const { McpServer } = await import(
  "../runtime/node_modules/@modelcontextprotocol/sdk/dist/esm/server/mcp.js"
);
const { startHttp } = await import("../runtime/dist/transports/http.js");

const openServers = new Set();
afterEach(async () => {
  await Promise.all(
    [...openServers].map(
      (server) => new Promise((resolve) => server.close(resolve)),
    ),
  );
  openServers.clear();
});

function createMemoryDocument() {
  const createNode = (tag) => {
    const node = {
      nodeType: 1,
      tagName: tag.toUpperCase(),
      childNodes: [],
      attributes: {},
      className: "",
      href: "",
      type: "",
      hidden: false,
      open: false,
      dataset: {},
      _text: "",
      addEventListener() {},
      setAttribute(name, value) {
        this.attributes[name] = String(value);
        if (name === "class") this.className = String(value);
        if (name === "href") this.href = String(value);
      },
      append(...nodes) {
        for (const child of nodes) this.childNodes.push(child);
      },
      replaceChildren(...nodes) {
        this.childNodes = [...nodes];
        this._text = "";
      },
    };
    Object.defineProperty(node, "textContent", {
      get() {
        if (this.childNodes.length) {
          return this.childNodes.map((child) => child.textContent).join("");
        }
        return this._text;
      },
      set(value) {
        this._text = String(value);
        this.childNodes = [];
      },
    });
    return node;
  };
  return { createElement: createNode };
}

function render(view) {
  const documentRef = createMemoryDocument();
  const root = documentRef.createElement("div");
  renderDashboard(root, view, documentRef);
  return { root, html: serializeRendered(root), text: root.textContent };
}

function fixtureStatus(overrides = {}) {
  return {
    providers: {
      zotero: { configured: true, source: "environment", optional: true },
      pubmed: { configured: true, source: "private_config", optional: true },
      easyscholar: { configured: false, source: "none", optional: true },
    },
    build_artifacts: {
      runtime: {
        path: "runtime/dist/index.js",
        exists: true,
        evidence:
          "Build artifact exists; existence is not proof of connectivity.",
      },
      fulltext_runtime: {
        path: "fulltext-runtime/dist/index.js",
        exists: false,
        evidence:
          "Build artifact is absent; artifact existence would not be proof of connectivity.",
      },
    },
    zotero_desktop_xpi: {
      status: "manual_install_required",
      artifact: "literature-metrics/dist/literature-metrics-<version>.xpi",
      install:
        "In Zotero Desktop, open Tools → Add-ons, choose the gear menu, then Install Add-on From File… and select the built XPI.",
      note: "The credential wizard and MCP never install or modify Zotero Desktop add-ons automatically.",
      verification: {
        level: "pending_manual",
        evidence: "Installation status was not verified in this milestone.",
      },
    },
    hosts: [
      {
        id: "claude_code",
        name: "Claude Code",
        level: "pending_manual",
        evidence:
          ".claude-plugin/plugin.json exists as an observable compatibility clue; host installation and connectivity await manual verification.",
      },
      {
        id: "codex",
        name: "Codex",
        level: "unknown",
        evidence: "No Codex compatibility clue was observed.",
      },
      {
        id: "workbuddy",
        name: "WorkBuddy",
        level: "verified",
        evidence: "Host availability was verified by a measured check.",
      },
    ],
    connections: [
      {
        id: "zotero_mcp",
        name: "Zotero MCP",
        level: "unknown",
        evidence: "No measured connection evidence was provided.",
      },
      {
        id: "fulltext_mcp",
        name: "Full-text MCP",
        level: "unknown",
        evidence: "No measured connection evidence was provided.",
      },
    ],
    ...overrides,
  };
}

function section(view, id) {
  return view.sections.find((item) => item.id === id);
}

function rowNamed(view, sectionId, name) {
  return section(view, sectionId).rows.find((row) => row.name === name);
}

test("configured credentials show existence and source, never verified or connected", () => {
  const view = mapDashboard(fixtureStatus());
  const zotero = rowNamed(view, "credentials", "Zotero");
  const pubmed = rowNamed(view, "credentials", "PubMed");
  assert.equal(zotero.statusLabel, "凭证存在");
  assert.equal(zotero.statusTone, "neutral");
  assert.match(zotero.evidence, /环境变量/);
  assert.match(zotero.evidence, /来源/);
  assert.equal(pubmed.statusLabel, "凭证存在");
  assert.match(pubmed.evidence, /私有配置/);
  for (const row of [zotero, pubmed]) {
    assert.doesNotMatch(row.statusLabel, /已校验|已连接/);
    assert.doesNotMatch(row.evidence, /已校验|已连接/);
  }
});

test("optional unconfigured credentials are optional, not faults", () => {
  const view = mapDashboard(fixtureStatus());
  const easy = rowNamed(view, "credentials", "EasyScholar");
  assert.equal(easy.statusLabel, "未配置 · 可选");
  assert.equal(easy.statusTone, "neutral");
  assert.notEqual(easy.statusTone, "error");
  assert.match(easy.evidence, /未检测/);
  assert.match(easy.evidence, /可选/);
  assert.doesNotMatch(easy.statusLabel, /失败|故障/);
});

test("build artifacts distinguish file existence from connectivity", () => {
  const view = mapDashboard(fixtureStatus());
  const runtime = rowNamed(view, "artifacts", "Runtime（Zotero MCP）");
  const fulltext = rowNamed(view, "artifacts", "Fulltext Runtime");
  assert.equal(runtime.statusLabel, "构建文件存在");
  assert.match(runtime.evidence, /已找到/);
  assert.match(runtime.evidence, /runtime\/dist\/index\.js/);
  assert.doesNotMatch(runtime.statusLabel, /已连接/);
  assert.doesNotMatch(runtime.evidence, /已连接/);
  assert.equal(fulltext.statusLabel, "未找到构建文件");
  assert.match(fulltext.evidence, /未找到/);
  assert.match(fulltext.evidence, /fulltext-runtime\/dist\/index\.js/);
});

test("XPI is unverified this round and includes build and install details", () => {
  const view = mapDashboard(fixtureStatus());
  const xpi = section(view, "xpi").rows[0];
  assert.equal(xpi.statusLabel, "本轮未核验");
  assert.match(xpi.evidence, /verification\.level/);
  assert.match(xpi.evidence, /本轮未检查/);
  const detailText = xpi.details.map((item) => item.value).join("\n");
  assert.match(detailText, /npm run package/);
  assert.match(detailText, /Install Add-on From File/);
  assert.doesNotMatch(xpi.statusLabel, /已安装|已连接/);
});

test("host verified is host availability only; pending_manual and unknown stay explicit", () => {
  const view = mapDashboard(fixtureStatus());
  const claude = rowNamed(view, "hosts", "Claude Code");
  const codex = rowNamed(view, "hosts", "Codex");
  const workbuddy = rowNamed(view, "hosts", "WorkBuddy");
  assert.equal(claude.statusLabel, "待人工核验");
  assert.match(claude.evidence, /兼容/);
  assert.equal(codex.statusLabel, "未知");
  assert.notEqual(codex.statusLabel, "");
  assert.doesNotMatch(codex.statusLabel, /成功|已连接/);
  assert.equal(workbuddy.statusLabel, "宿主可用性已实测");
  assert.match(workbuddy.evidence, /宿主/);
  assert.match(workbuddy.evidence, /不表示 MCP 已连接/);
  assert.doesNotMatch(workbuddy.statusLabel, /MCP 已连接|已连接（实测）/);
});

test("connection unknown is unknown, not connected or failed", () => {
  const view = mapDashboard(fixtureStatus());
  for (const row of section(view, "connections").rows) {
    assert.equal(row.statusLabel, "未知");
    assert.match(row.evidence, /尚无连接实测证据/);
    assert.match(row.evidence, /No measured connection evidence/);
    assert.doesNotMatch(row.statusLabel, /已连接|失败/);
  }
});

test("missing or unrecognized states stay unknown and never succeed", () => {
  const view = mapDashboard({
    providers: { zotero: { optional: true } },
    build_artifacts: { runtime: { path: "runtime/dist/index.js" } },
    hosts: [{ id: "codex", name: "Codex", level: "installed" }],
    connections: [{ id: "zotero_mcp", name: "Zotero MCP", level: "up" }],
  });
  assert.equal(rowNamed(view, "credentials", "Zotero").statusLabel, "状态未知");
  assert.equal(rowNamed(view, "credentials", "PubMed").statusLabel, "状态未知");
  assert.equal(section(view, "artifacts").rows[0].statusLabel, "状态未知");
  assert.equal(section(view, "xpi").rows[0].statusLabel, "状态未知");
  assert.equal(section(view, "hosts").rows[0].statusLabel, "状态未知");
  assert.equal(section(view, "connections").rows[0].statusLabel, "状态未知");
  for (const row of view.sections.flatMap((item) => item.rows)) {
    assert.notEqual(row.statusLabel, "凭证存在");
    assert.notEqual(row.statusLabel, "已连接（实测）");
    assert.notEqual(row.statusTone, "verified");
  }
});

test("every visible evidence line includes a verifiable field source mark", () => {
  const view = mapDashboard(fixtureStatus());
  const mark =
    /环境变量|私有配置|未检测|已找到|未找到|verification\.level|兼容|实测|未知|No measured|source|exists|level|compatibility clue|返回依据/;
  for (const row of view.sections.flatMap((item) => item.rows)) {
    assert.match(row.evidence, mark, row.name);
  }
});

test("paths and evidence render as text and redact credential-bearing URLs", () => {
  const poisoned = fixtureStatus({
    build_artifacts: {
      runtime: {
        path: "<script>alert(1)</script>",
        exists: false,
        evidence: "未找到 <script>alert(1)</script> example.com/key?api_key=xxx",
      },
    },
  });
  const view = mapDashboard(poisoned);
  const { html, text, root } = render(view);
  assert.match(text, /<script>alert\(1\)<\/script>/);
  assert.equal(html.includes("<script>"), false);
  assert.equal(html.includes("api_key=xxx"), false);
  assert.equal(text.includes("api_key=xxx"), false);
  assert.equal(html.includes("dashboard-fixture-not-a-real-key"), false);
  assert.equal(root._innerHTMLAssigned, undefined);
  assert.equal(
    redactSensitive("example.com/key?api_key=xxx"),
    "[redacted-credential-url]",
  );
});

test("dashboard renderer never assigns innerHTML", () => {
  const source = readFileSync(
    new URL("../runtime/src/public/onboarding/dashboard.js", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(source, /innerHTML\s*=/);
});

function bareServer() {
  return new McpServer(
    { name: "dashboard-semantics-test", version: "0.0.0" },
    { capabilities: { tools: {} } },
  );
}

function temporaryPaths() {
  const root = mkdtempSync(join(tmpdir(), "ai4s-dashboard-"));
  return {
    zoteroEnv: join(root, "native", "zotero.env"),
    legacyZoteroEnv: join(root, "legacy", "zotero.env"),
    academicConfig: join(root, "native", "academic.json"),
    legacyAcademicConfig: join(root, "legacy", "academic.json"),
    state: join(root, "native", "onboarding.json"),
  };
}

function baseUrl(server) {
  const address = server.address();
  assert.equal(typeof address, "object");
  return `http://127.0.0.1:${address.port}`;
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
    request.end();
  });
}

async function startAdmin(overrides = {}) {
  const capturedCodes = [];
  const server = await startHttp(() => bareServer(), {
    port: 0,
    host: "127.0.0.1",
    adminOnboarding: {
      paths: temporaryPaths(),
      env: {},
      pairingCodeSink: (code) => capturedCodes.push(code),
      ...overrides.adminOnboarding,
    },
    ...overrides.http,
  });
  openServers.add(server);
  return { server, base: baseUrl(server), capturedCodes };
}

async function pairSession(started) {
  const page = await fetch(`${started.base}/admin/onboarding`);
  const cookies = responseCookies(page);
  const paired = await fetch(`${started.base}/admin/onboarding/api/pair`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: started.base,
      Cookie: cookieHeader(cookies),
      "X-CSRF-Token": cookies.ai4s_onboarding_pair_csrf,
    },
    body: JSON.stringify({ code: started.capturedCodes[0] }),
  });
  assert.equal(paired.status, 200);
  return responseCookies(paired);
}

test("unpaired dashboard GET is 401/403 and contains no status fields", async () => {
  const started = await startAdmin();
  for (const path of [
    "/admin/onboarding/api/dashboard",
    "/admin/onboarding/dashboard",
    "/admin/onboarding/dashboard/",
    "/admin/onboarding/dashboard.html",
  ]) {
    const response = await fetch(`${started.base}${path}`);
    assert.ok(
      response.status === 401 || response.status === 403,
      `${path} ${response.status}`,
    );
    const body = await response.text();
    for (const field of [
      "providers",
      "build_artifacts",
      "hosts",
      "connections",
      "zotero_desktop_xpi",
      "private_config",
      "environment",
    ]) {
      assert.equal(body.includes(field), false, `${path} leaked ${field}`);
    }
  }
});

test("paired dashboard API returns artifacts, hosts, and connections without secrets", async () => {
  const secret = "dashboard-fixture-not-a-real-key";
  const started = await startAdmin({
    adminOnboarding: { env: { ZOTERO_API_KEY: secret } },
  });
  const session = await pairSession(started);
  const response = await fetch(
    `${started.base}/admin/onboarding/api/dashboard`,
    { headers: { Cookie: cookieHeader(session) } },
  );
  assert.equal(response.status, 200);
  const text = await response.text();
  const body = JSON.parse(text);
  assert.equal(body.providers.zotero.configured, true);
  assert.equal(body.providers.zotero.source, "environment");
  assert.equal(typeof body.build_artifacts.runtime.path, "string");
  assert.equal(typeof body.build_artifacts.runtime.exists, "boolean");
  assert.match(body.build_artifacts.runtime.evidence, /connectivity/i);
  assert.equal(typeof body.build_artifacts.fulltext_runtime.exists, "boolean");
  assert.ok(Array.isArray(body.hosts));
  assert.deepEqual(
    body.hosts.map((item) => item.id),
    ["claude_code", "codex", "workbuddy"],
  );
  assert.ok(Array.isArray(body.connections));
  assert.ok(body.connections.every((item) => item.level === "unknown"));
  assert.ok(body.connections.every((item) => item.level !== "verified"));
  assert.equal(text.includes(secret), false);
  assert.equal(text.includes("api_key="), false);
});

test("paired dashboard HTML and trailing slash stay session-bound", async () => {
  const started = await startAdmin();
  const session = await pairSession(started);
  const headers = { Cookie: cookieHeader(session) };
  const page = await fetch(`${started.base}/admin/onboarding/dashboard`, {
    headers,
  });
  assert.equal(page.status, 200);
  const html = await page.text();
  assert.match(html, /配置状态/);
  assert.match(html, /正在读取状态/);
  assert.match(html, /读取状态不代表执行连接测试/);
  assert.doesNotMatch(html, /private_config|ZOTERO_API_KEY=/);

  const slash = await fetch(`${started.base}/admin/onboarding/dashboard/`, {
    headers,
    redirect: "manual",
  });
  assert.equal(slash.status, 302);
  assert.equal(slash.headers.get("location"), "/admin/onboarding/dashboard");

  const script = await fetch(`${started.base}/admin/onboarding/dashboard.js`, {
    headers,
  });
  assert.equal(script.status, 200);
});

test("Host and Origin guards cover GET /api/dashboard", async () => {
  const started = await startAdmin();
  const session = await pairSession(started);
  const url = `${started.base}/admin/onboarding/api/dashboard`;
  const cookie = cookieHeader(session);
  assert.equal(
    (await rawRequest(url, { headers: { Cookie: cookie, Host: "attacker.invalid" } }))
      .status,
    403,
  );
  assert.equal(
    (
      await fetch(url, {
        headers: { Cookie: cookie, Origin: "http://attacker.invalid" },
      })
    ).status,
    403,
  );
});

test("expired session cannot read dashboard status or leftover data", async () => {
  let now = 80_000;
  const started = await startAdmin({
    adminOnboarding: { now: () => now, sessionTtlMs: 100 },
  });
  const session = await pairSession(started);
  const headers = { Cookie: cookieHeader(session) };
  const fresh = await fetch(`${started.base}/admin/onboarding/api/dashboard`, {
    headers,
  });
  assert.equal(fresh.status, 200);
  now += 100;
  const expired = await fetch(`${started.base}/admin/onboarding/api/dashboard`, {
    headers,
  });
  const body = await expired.text();
  assert.equal(expired.status, 401);
  assert.equal(body.includes("providers"), false);
  assert.equal(body.includes("build_artifacts"), false);
  assert.equal(body.includes("connections"), false);
  assert.equal(JSON.parse(body).error, "Pairing required.");
});
