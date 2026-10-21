import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { request as httpRequest } from "node:http";
import { afterEach, test } from "node:test";

import {
  applyOnboardingLayout,
  mapDashboard,
  providersFullyConfigured,
  redactSensitive,
  renderDashboard,
  serializeRendered,
} from "../runtime/src/public/onboarding/app.js";
import { maskKey, redactedStatus } from "../runtime/src/lib/onboarding-core.mjs";

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
      zotero: {
        configured: true,
        source: "environment",
        optional: true,
        masked_key: "abcdef******",
      },
      pubmed: {
        configured: true,
        source: "private_config",
        optional: true,
        masked_key: "ab****",
      },
      easyscholar: {
        configured: false,
        source: "none",
        optional: true,
        masked_key: null,
      },
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

test("configured credentials show existence and masked key, never verified or connected", () => {
  const view = mapDashboard(fixtureStatus());
  const zotero = rowNamed(view, "credentials", "Zotero");
  const pubmed = rowNamed(view, "credentials", "PubMed");
  assert.equal(zotero.statusLabel, "凭证存在");
  assert.equal(zotero.statusTone, "verified");
  assert.equal(zotero.evidence, "abcdef******");
  assert.equal(zotero.action.label, "重新申请");
  assert.equal(zotero.action.href, "https://www.zotero.org/settings/keys");
  assert.equal(zotero.action.target, "_blank");
  assert.equal(zotero.action.rel, "noreferrer");
  assert.equal(zotero.action.variant, "action-pill");
  assert.equal(zotero.details, undefined);
  assert.equal(pubmed.statusLabel, "凭证存在");
  assert.equal(pubmed.evidence, "ab****");
  assert.equal(pubmed.action.label, "重新申请");
  assert.equal(
    pubmed.action.href,
    "https://www.ncbi.nlm.nih.gov/datasets/docs/v2/api/api-keys/",
  );
  assert.equal(pubmed.action.variant, "action-pill");
  for (const row of [zotero, pubmed]) {
    assert.doesNotMatch(row.statusLabel, /已校验|已连接/);
    assert.doesNotMatch(row.evidence, /已校验|已连接/);
    assert.doesNotMatch(row.evidence, /来源：环境变量|来源：私有配置/);
  }
});

test("optional unconfigured credentials are optional, not faults", () => {
  const view = mapDashboard(fixtureStatus());
  const easy = rowNamed(view, "credentials", "EasyScholar");
  assert.equal(easy.statusLabel, "未配置 · 可选");
  assert.equal(easy.statusTone, "neutral");
  assert.notEqual(easy.statusTone, "error");
  assert.equal(easy.evidence, "未设置，可选。");
  assert.equal(easy.action.label, "前往配置");
  assert.equal(easy.action.href, "./");
  assert.doesNotMatch(easy.statusLabel, /失败|故障/);
});

test("workbench core and host sections are omitted from the status view", () => {
  const view = mapDashboard(fixtureStatus());
  assert.equal(section(view, "artifacts"), undefined);
  assert.equal(section(view, "hosts"), undefined);
  assert.equal(section(view, "connections"), undefined);
  const { text } = render(view);
  assert.doesNotMatch(text, /工作台核心|客户端工具|agent 连接/);
});

test("XPI is a download action with a one-line install hint", () => {
  const view = mapDashboard(fixtureStatus());
  const xpi = section(view, "xpi").rows[0];
  assert.equal(xpi.statusLabel, "安装步骤");
  assert.equal(xpi.statusTone, "verified");
  assert.equal(xpi.action.label, "点击下载");
  assert.equal(xpi.action.variant, "action-pill");
  assert.equal(
    xpi.action.href,
    "https://github.com/Frankkk1912/ai4s-literature-workbench/releases/latest/download/literature-metrics.xpi",
  );
  assert.equal(xpi.action.target, "_blank");
  assert.equal(xpi.action.rel, "noreferrer");
  assert.equal(
    xpi.evidence,
    "下载后，在 Zotero 中选择 工具 → 插件，点齿轮 → 从文件安装插件（Install Add-on From File…），选下载的 .xpi 文件，再重启 Zotero。",
  );
  assert.equal(xpi.details.length, 1);
  assert.equal(xpi.details[0].label, "完整步骤");
  assert.equal(xpi.details[0].mono, false);
  assert.match(xpi.details[0].value, /literature-metrics\.xpi/);
  assert.match(xpi.details[0].value, /releases/);
  assert.match(xpi.details[0].value, /Install Add-on From File/);
  assert.match(xpi.details[0].value, /重启 Zotero/);
  assert.doesNotMatch(xpi.statusLabel, /已安装|已连接|需要手动安装/);
  assert.doesNotMatch(xpi.evidence, /verification\.level|本轮未检查/);
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
  assert.equal(section(view, "xpi").rows[0].statusLabel, "状态未知");
  assert.equal(section(view, "artifacts"), undefined);
  assert.equal(section(view, "hosts"), undefined);
  assert.equal(section(view, "connections"), undefined);
  for (const row of view.sections.flatMap((item) => item.rows)) {
    assert.notEqual(row.statusLabel, "凭证存在");
    assert.notEqual(row.statusLabel, "已连接（实测）");
    assert.notEqual(row.statusTone, "verified");
  }
});

test("every visible evidence line includes a verifiable field source mark", () => {
  const view = mapDashboard(fixtureStatus());
  const mark = /abcdef\*{6}|ab\*{4}|未设置|Install Add-on From File/;
  for (const row of view.sections.flatMap((item) => item.rows)) {
    assert.match(row.evidence, mark, row.name);
  }
});

test("maskKey previews by length and never returns the full value", () => {
  assert.equal(maskKey("abcdefghijklmnop"), "abcdef******");
  assert.equal(maskKey("abcdefgh"), "ab****");
  assert.equal(maskKey("abcde"), "****");
  assert.equal(maskKey(""), null);
  assert.equal(maskKey(null), null);
  assert.equal(maskKey(undefined), null);
});

test("redactedStatus masks real env and config keys without returning them", () => {
  const longSecret = "abcdefghijklmnop";
  const shortSecret = "abcdefgh";
  const tinySecret = "xyz12";
  const root = mkdtempSync(join(tmpdir(), "ai4s-masked-key-"));
  mkdirSync(join(root, "native"), { recursive: true });
  const paths = {
    zoteroEnv: join(root, "native", "zotero.env"),
    legacyZoteroEnv: join(root, "legacy", "zotero.env"),
    academicConfig: join(root, "native", "academic.json"),
    legacyAcademicConfig: join(root, "legacy", "academic.json"),
    state: join(root, "native", "onboarding.json"),
  };
  writeFileSync(paths.zoteroEnv, `ZOTERO_API_KEY=${longSecret}\n`);
  writeFileSync(
    paths.academicConfig,
    JSON.stringify({
      pubmed_api_key: shortSecret,
      easyscholar_secret_key: tinySecret,
    }),
  );
  const fromFiles = redactedStatus(paths, {});
  assert.equal(fromFiles.providers.zotero.configured, true);
  assert.equal(fromFiles.providers.zotero.source, "private_config");
  assert.equal(fromFiles.providers.zotero.masked_key, "abcdef******");
  assert.equal(fromFiles.providers.pubmed.masked_key, "ab****");
  assert.equal(fromFiles.providers.easyscholar.masked_key, "****");
  const fromEnv = redactedStatus(paths, { ZOTERO_API_KEY: longSecret });
  assert.equal(fromEnv.providers.zotero.source, "environment");
  assert.equal(fromEnv.providers.zotero.masked_key, "abcdef******");
  const serialized = `${JSON.stringify(fromFiles)}${JSON.stringify(fromEnv)}`;
  for (const secret of [longSecret, shortSecret, tinySecret]) {
    assert.equal(serialized.includes(secret), false);
  }
  const empty = redactedStatus(temporaryPaths(), {});
  assert.equal(empty.providers.zotero.masked_key, null);
  assert.equal(empty.providers.pubmed.masked_key, null);
  assert.equal(empty.providers.easyscholar.masked_key, null);
});

test("credential evidence renders masked_key length boundaries and omits unset keys", () => {
  const view = mapDashboard(
    fixtureStatus({
      providers: {
        zotero: {
          configured: true,
          source: "environment",
          optional: true,
          masked_key: "abcdef******",
        },
        pubmed: {
          configured: true,
          source: "private_config",
          optional: true,
          masked_key: "ab****",
        },
        easyscholar: {
          configured: true,
          source: "private_config",
          optional: true,
          masked_key: "****",
        },
      },
    }),
  );
  assert.equal(rowNamed(view, "credentials", "Zotero").evidence, "abcdef******");
  assert.equal(rowNamed(view, "credentials", "PubMed").evidence, "ab****");
  assert.equal(rowNamed(view, "credentials", "EasyScholar").evidence, "****");

  const missingKey = mapDashboard(
    fixtureStatus({
      providers: {
        zotero: {
          configured: true,
          source: "environment",
          optional: true,
          masked_key: null,
        },
        pubmed: {
          configured: false,
          source: "none",
          optional: true,
          masked_key: null,
        },
        easyscholar: {
          configured: false,
          source: "none",
          optional: true,
          masked_key: null,
        },
      },
    }),
  );
  assert.equal(rowNamed(missingKey, "credentials", "Zotero").evidence, "已设置");
  assert.doesNotMatch(
    rowNamed(missingKey, "credentials", "Zotero").evidence,
    /来源：/,
  );
  assert.equal(
    rowNamed(missingKey, "credentials", "PubMed").evidence,
    "未设置，可选。",
  );
});

test("paths and evidence render as text and redact credential-bearing URLs", () => {
  const poisoned = fixtureStatus({
    zotero_desktop_xpi: {
      status: "manual_install_required",
      artifact: "<script>alert(1)</script>",
      install: "<script>alert(1)</script> example.com/key?api_key=xxx",
    },
  });
  const view = mapDashboard(poisoned);
  const { html, text, root } = render(view);
  assert.match(text, /Install Add-on From File/);
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

test("status view renderer never assigns innerHTML", () => {
  const source = readFileSync(
    new URL("../runtime/src/public/onboarding/app.js", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(source, /innerHTML\s*=/);
});

test("status view uses credentials and XPI sections with XPI details", () => {
  const view = mapDashboard(fixtureStatus());
  assert.deepEqual(
    view.sections.map((item) => item.id),
    ["credentials", "xpi"],
  );
  assert.deepEqual(
    view.sections.map((item) => item.title),
    ["凭证", "Zotero 插件"],
  );
  const { html, root } = render(view);
  assert.match(html, /status status--verified/);
  assert.match(html, /status status--neutral/);
  assert.match(html, /action-pill/);
  assert.match(html, /重新申请/);
  assert.match(html, />点击下载</);
  assert.match(html, /target="_blank"/);
  assert.match(html, /rel="noreferrer"/);
  assert.match(html, /完整步骤/);
  assert.match(html, /<details/);
  assert.doesNotMatch(html, /完整路径、命令与技术说明/);
  const credentialRows = section(view, "credentials").rows;
  for (const row of credentialRows) {
    assert.equal(row.details, undefined);
  }
  const openDetails = [];
  const walk = (node) => {
    if (!node) return;
    if (String(node.tagName || "").toLowerCase() === "details") {
      openDetails.push(Boolean(node.open));
    }
    for (const child of node.childNodes ?? []) walk(child);
  };
  walk(root);
  assert.equal(openDetails.length, 1);
  assert.equal(openDetails[0], false);
});

test("wizard stays visible until every provider is configured", () => {
  assert.equal(providersFullyConfigured(fixtureStatus()), false);
  assert.equal(
    providersFullyConfigured(
      fixtureStatus({
        providers: {
          zotero: { configured: true, source: "environment", optional: true },
          pubmed: { configured: true, source: "private_config", optional: true },
          easyscholar: { configured: true, source: "private_config", optional: true },
        },
      }),
    ),
    true,
  );
  assert.equal(providersFullyConfigured({ providers: {} }), false);

  const pairing = { hidden: true };
  const wizard = { hidden: true };
  const statusView = { hidden: true };
  applyOnboardingLayout(
    { pairing, wizard, statusView },
    { paired: false, fullyConfigured: false },
  );
  assert.equal(pairing.hidden, false);
  assert.equal(wizard.hidden, true);
  assert.equal(statusView.hidden, true);

  applyOnboardingLayout(
    { pairing, wizard, statusView },
    { paired: true, fullyConfigured: false },
  );
  assert.equal(pairing.hidden, true);
  assert.equal(wizard.hidden, false);
  assert.equal(statusView.hidden, false);

  applyOnboardingLayout(
    { pairing, wizard, statusView },
    { paired: true, fullyConfigured: true },
  );
  assert.equal(pairing.hidden, true);
  assert.equal(wizard.hidden, true);
  assert.equal(statusView.hidden, false);
});

function bareServer() {
  return new McpServer(
    { name: "onboarding-status-test", version: "0.0.0" },
    { capabilities: { tools: {} } },
  );
}

function temporaryPaths() {
  const root = mkdtempSync(join(tmpdir(), "ai4s-onboarding-status-"));
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

test("unpaired status GET is 401/403 and contains no status fields", async () => {
  const started = await startAdmin();
  const response = await fetch(`${started.base}/admin/onboarding/api/dashboard`);
  assert.ok(
    response.status === 401 || response.status === 403,
    `/api/dashboard ${response.status}`,
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
    "masked_key",
  ]) {
    assert.equal(body.includes(field), false, `leaked ${field}`);
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
  assert.equal(body.providers.zotero.masked_key, "dashbo******");
  assert.equal(body.providers.pubmed.masked_key, null);
  assert.equal(body.providers.easyscholar.masked_key, null);
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

test("onboarding page embeds the status view and has no separate dashboard page", async () => {
  const started = await startAdmin();
  const page = await fetch(`${started.base}/admin/onboarding/`);
  assert.equal(page.status, 200);
  const html = await page.text();
  assert.match(html, /id="status-view"/);
  assert.match(html, /id="dashboard-root"/);
  assert.match(html, /配置状态/);
  assert.match(html, /读取状态不代表执行连接测试/);
  assert.doesNotMatch(html, /前往状态看板/);
  assert.doesNotMatch(html, /href="\.\/dashboard"/);
  assert.doesNotMatch(html, /1\.\s*配对本次会话/);
  assert.doesNotMatch(html, /private_config|ZOTERO_API_KEY=/);

  const session = await pairSession(started);
  const headers = { Cookie: cookieHeader(session) };
  for (const path of ["/dashboard", "/dashboard.html", "/dashboard.js"]) {
    const response = await fetch(`${started.base}/admin/onboarding${path}`, {
      headers,
    });
    assert.equal(response.status, 404, path);
  }
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

test("the add-on row says what this computer's Zotero profile shows, and never that it loaded", () => {
  const label = (profiles) => mapDashboard({ ...fixtureStatus(), zotero_desktop_xpi: { ...fixtureStatus().zotero_desktop_xpi, profiles } }).sections.find((s) => s.id === "xpi").rows[0];
  assert.match(label([{ state: "installed_active" }]).statusLabel, /已在你的 Zotero 里找到（无法确认已加载）/);
  assert.match(label([{ state: "installed_unconfirmed" }]).statusLabel, /无法确认/);
  assert.equal(label([{ state: "not_installed" }]).statusLabel, "尚未安装");
  assert.match(label([]).statusLabel, /没有找到 Zotero/);
  for (const state of ["installed_active", "installed_unconfirmed", "not_installed"]) {
    const row = label([{ state }]);
    assert.doesNotMatch(row.statusLabel, /已加载并|已启用并工作/);
    assert.notEqual(row.statusTone, "verified");
    assert.match(row.action.href, /releases\/latest\/download\/literature-metrics\.xpi$/);
  }
});
