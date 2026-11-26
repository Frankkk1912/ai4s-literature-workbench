import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { posix, win32 } from "node:path";
import test from "node:test";
import vm from "node:vm";

const source = (name) => readFileSync(new URL(`../${name}`, import.meta.url), "utf8");
function moduleContext() {
  const scope = vm.createContext({});
  vm.runInContext(source("src/ai-summaries.js"), scope);
  vm.runInContext(source("src/plugin-channel.js"), scope);
  return scope.LiteraturePluginChannel;
}
function ping(fields = {}) {
  const job = { schema_version: 1, job_id: randomUUID(), job_type: "ping", created_at: new Date().toISOString(), payload: {}, ...fields };
  job.plan_hash = createHash("sha256").update(JSON.stringify([job.schema_version, job.job_id, job.job_type, job.created_at, job.payload])).digest("hex");
  return job;
}
function fixture(agrees = true) {
  const records = new Map();
  const prompts = [];
  let tick;
  let cancels = 0;
  let beforeRead = async () => {};
  const files = {
    initialize: async () => {},
    list: async () => [...records.keys()],
    read: async (name) => { await beforeRead(name); return records.get(name) || null; },
    write: async (name, value) => { records.set(name, value); },
    remove: async (name) => { records.delete(name); },
  };
  const channel = moduleContext().create({ files,
    confirm: async (title, text) => { prompts.push({ title, text }); return agrees; },
    schedule: (fn, ms) => { assert.equal(ms, 2000); tick = fn; return 17; },
    cancel: (id) => { assert.equal(id, 17); cancels += 1; },
    log: () => {},
  });
  return { channel, records, prompts, tick: () => tick(), cancels: () => cancels,
    beforeRead: (fn) => { beforeRead = fn; },
    add: (job) => records.set(`${job.job_id}.job.json`, job),
  };
}

for (const agrees of [true, false]) {
  test(`discovers ping, asks confirmation, writes ${agrees ? "completed" : "rejected"} with matching hash`, async () => {
    const f = fixture(agrees);
    const job = ping();
    assert.equal(moduleContext().planHash(job), job.plan_hash, "same SHA-256 contract as Node runtime");
    f.add(job);
    await f.channel.start();
    const receipt = f.records.get(`${job.job_id}.ack.json`);
    assert.equal(receipt.status, agrees ? "completed" : "rejected");
    assert.equal(receipt.plan_hash, job.plan_hash);
    assert.ok(receipt.finished_at);
    assert.equal(f.prompts.length, 1);
    assert.match(f.prompts[0].text, /connectivity test.*will not change items/);
    if (!agrees) assert.match(receipt.error, /declined/);
    await f.tick();
    assert.equal(f.prompts.length, 1, "terminal receipts are not replayed");
    await f.channel.stop();
    assert.equal(f.cancels(), 1);
    assert.equal(f.records.has("presence.json"), false);
    f.add(ping());
    await f.tick();
    assert.equal(f.prompts.length, 1, "stale timer callbacks cannot process after stop");
    assert.equal(f.records.has("presence.json"), false);
  });
}

test("rejects tampering and secret-bearing/non-ping payloads without showing a dialog", async () => {
  const f = fixture();
  const badHash = { ...ping(), plan_hash: "0".repeat(64) };
  const secrets = ping({ payload: { api_key: "must-not-be-copied" } });
  const unsupported = ping({ job_type: "merge" });
  const extra = { ...ping(), api_key: "must-not-be-copied" };
  for (const job of [badHash, secrets, unsupported, extra]) f.add(job);
  await f.channel.start();
  assert.equal(f.prompts.length, 0);
  for (const job of [badHash, secrets, unsupported, extra]) {
    const receipt = f.records.get(`${job.job_id}.ack.json`);
    assert.equal(receipt.status, "rejected");
    assert.match(receipt.error, /plan_hash mismatch/);
    assert.equal(JSON.stringify(receipt).includes("must-not-be-copied"), false);
  }
  await f.channel.stop();
});

test("does not confirm a job after stop while an asynchronous read is in flight", async () => {
  const f = fixture();
  await f.channel.start();
  const job = ping();
  f.add(job);
  let release;
  let began;
  const ready = new Promise((resolve) => { began = resolve; });
  f.beforeRead(async () => { began(); await new Promise((resolve) => { release = resolve; }); });
  const scan = f.tick();
  await ready;
  const stopped = f.channel.stop();
  release();
  await Promise.all([scan, stopped]);
  assert.equal(f.prompts.length, 0);
  assert.equal(f.records.has(`${job.job_id}.ack.json`), false);
});

test("concurrent scans are serialized and mismatched existing receipts are preserved", async () => {
  const f = fixture();
  await f.channel.start();
  const job = ping();
  f.add(job);
  const receipt = { job_id: job.job_id, plan_hash: "0".repeat(64), status: "completed" };
  f.records.set(`${job.job_id}.ack.json`, receipt);
  await Promise.all([f.tick(), f.tick()]);
  assert.equal(f.prompts.length, 0);
  assert.equal(f.records.get(`${job.job_id}.ack.json`), receipt);
  await f.channel.stop();
});

function memoryFiles() {
  const records = new Map();
  return { records, files: {
    initialize: async () => {},
    list: async () => [...records.keys()],
    read: async (name) => records.get(name) || null,
    write: async (name, value) => { records.set(name, value); },
    remove: async (name) => { records.delete(name); },
  } };
}
async function waitFor(predicate) {
  while (!predicate()) await new Promise((resolve) => setTimeout(resolve, 1));
}

test("claims the job before a slow confirmation and clears the claim with the ack", async () => {
  const { records, files } = memoryFiles();
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const channel = moduleContext().create({ files,
    confirm: async () => { await gate; return true; },
    schedule: () => 1, cancel() {}, log: (message) => assert.fail(message) });
  const job = ping();
  records.set(`${job.job_id}.job.json`, job);
  const started = channel.start();
  await waitFor(() => records.has(`${job.job_id}.claim.json`));
  const claimFile = records.get(`${job.job_id}.claim.json`);
  assert.equal(claimFile.schema_version, 1);
  assert.equal(claimFile.job_id, job.job_id);
  assert.equal(claimFile.plan_hash, job.plan_hash);
  assert.ok(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(claimFile.claimed_at));
  release();
  await started;
  assert.equal(records.get(`${job.job_id}.ack.json`).status, "completed");
  assert.equal(records.has(`${job.job_id}.claim.json`), false, "the claim is cleared with the ack");
  await channel.stop();
});

test("stop withdraws an outstanding claim so the helper fails clearly instead of hanging", async () => {
  const { records, files } = memoryFiles();
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const channel = moduleContext().create({ files,
    confirm: async () => { await gate; return true; },
    schedule: () => 1, cancel() {}, log: () => {} });
  const job = ping();
  records.set(`${job.job_id}.job.json`, job);
  const started = channel.start();
  await waitFor(() => records.has(`${job.job_id}.claim.json`));
  const stopped = channel.stop();
  release();
  await Promise.all([started, stopped]);
  assert.equal(records.has(`${job.job_id}.ack.json`), false, "no ack is written after stop");
  assert.equal(records.has(`${job.job_id}.claim.json`), false, "stop withdraws the outstanding claim");
  assert.equal(records.has("presence.json"), false);
});

// Fake Zotero/Gecko objects exercise the actual desktop file adapter, not a live profile.
for (const platform of ["darwin", "win32", "linux", "zoteus-only", "both-set"]) {
  test(`desktop adapter uses runtime-compatible ${platform} dataDir and owner-private files`, async () => {
    const paths = platform === "win32" ? win32 : posix;
    const home = platform === "win32" ? "C:\\test-home" : "/test-home";
    // Runtime defaultDataDir prefers LITERATURE_ZOTERO_MCP_DATA_DIR over the legacy ZOTEUS_DATA_DIR.
    const env = platform === "zoteus-only" ? { ZOTEUS_DATA_DIR: "/custom" }
      : platform === "both-set" ? { ZOTEUS_DATA_DIR: "/ignored", LITERATURE_ZOTERO_MCP_DATA_DIR: "/custom" } : {};
    let root;
    const records = new Map();
    let symlink = false;
    const Components = { interfaces: { nsIFile: {} }, classes: { "@mozilla.org/file/local;1": { createInstance: () => ({ initWithPath() {}, isSymlink: () => symlink }) } } };
    const IOUtils = {
      async makeDirectory(path, options) { root = path; assert.equal(options.permissions, 0o700); },
      async stat(path) { return { type: path === root ? "directory" : "regular", size: 200 }; },
      async exists(path) { return records.has(path); },
      async getChildren() { return [...records.keys()]; },
      async readJSON(path) { return records.get(path); },
      async writeJSON(path, value, options) { assert.equal(options.mode, "create"); assert.ok(path.endsWith(".tmp")); records.set(path, value); },
      async setPermissions(_path, mode) { assert.equal(mode, 0o600); },
      async move(from, to) { records.set(to, records.get(from)); records.delete(from); },
      async remove(path) { records.delete(path); },
    };
    const channel = moduleContext().createDesktop({
      Zotero: { isWin: platform === "win32", isMac: platform === "darwin", getMainWindow: () => ({}), logError() {} },
      Services: { env: { get: (key) => env[key] || "" }, dirsvc: { get: () => ({ path: home }) },
        uuid: { generateUUID: randomUUID }, prompt: { confirm: () => true } },
      Components, IOUtils, PathUtils: { join: paths.join, filename: paths.basename }, schedule: () => 1, cancel() {},
    });
    await channel.start();
    const subdirs = { darwin: ["Library", "Application Support"], win32: ["AppData", "Roaming"], linux: [".local", "share"] };
    const expected = platform === "zoteus-only" || platform === "both-set" ? "/custom/plugin-jobs" : paths.join(home,
      ...subdirs[platform], "literature-zotero-mcp", "plugin-jobs");
    assert.equal(root, expected);
    const job = ping();
    records.set(paths.join(root, `${job.job_id}.job.json`), job);
    await channel.scan();
    assert.equal(records.get(paths.join(root, `${job.job_id}.ack.json`)).status, "completed");
    await channel.stop();
    symlink = true;
    await assert.rejects(channel.start(), /symlink/);
  });
}

test("a path the nsIFile layer cannot see is treated as not a symlink instead of crashing", async () => {
  const paths = posix;
  const home = "/test-home";
  const records = new Map();
  // Simulates the real-Gecko pitfall: isSymlink() throws on a path the nsIFile
  // layer considers missing, even though IOUtils can still see and read it.
  const knownToNsIFile = new Set();
  const Components = { interfaces: { nsIFile: {} }, classes: { "@mozilla.org/file/local;1": { createInstance: () => {
    const file = {
      path: "",
      initWithPath(target) { this.path = target; },
      isSymlink() {
        if (!knownToNsIFile.has(this.path)) throw new Error("NS_ERROR_FILE_NOT_FOUND: isSymlink on a missing path");
        return false;
      },
    };
    return file;
  } } } };
  const root = paths.join(home, "Library", "Application Support", "literature-zotero-mcp", "plugin-jobs");
  const IOUtils = {
    async makeDirectory(path, options) { assert.equal(options.permissions, 0o700); knownToNsIFile.add(path); },
    async stat(path) { return { type: path === root ? "directory" : "regular", size: 200 }; },
    async exists(path) { return records.has(path); },
    async getChildren() { return [...records.keys()]; },
    async readJSON(path) { return records.get(path); },
    async writeJSON(path, value, options) { assert.equal(options.mode, "create"); assert.ok(path.endsWith(".tmp")); records.set(path, value); },
    async setPermissions(_path, mode) { assert.equal(mode, 0o600); },
    async move(from, to) { records.set(to, records.get(from)); records.delete(from); },
    async remove(path) { records.delete(path); },
  };
  const channel = moduleContext().createDesktop({
    Zotero: { isMac: true, getMainWindow: () => ({}), logError() {} },
    Services: { env: { get: () => "" }, dirsvc: { get: () => ({ path: home }) },
      uuid: { generateUUID: randomUUID }, prompt: { confirm: () => true } },
    Components, IOUtils, PathUtils: { join: paths.join, filename: paths.basename }, schedule: () => 1, cancel() {},
  });
  await channel.start();
  const job = ping();
  // The job file exists for IOUtils but was never registered with the nsIFile
  // layer, so its symlink check throws the missing-path error.
  records.set(paths.join(root, `${job.job_id}.job.json`), job);
  await channel.scan();
  assert.equal(records.get(paths.join(root, `${job.job_id}.ack.json`)).status, "completed",
    "a missing-path isSymlink throw must not block the ping");
  await channel.stop();
});

function bootstrapHarness(options = {}) {
  const calls = [];
  const errors = [];
  const debugs = [];
  let channelArgs = null;
  let menuSettings = null;
  const scope = {
    Zotero: {
      initializationPromise: Promise.resolve(),
      logError: (message) => errors.push(String(message)),
      debug: (message) => debugs.push(String(message)),
      ...(options.zotero || {}),
    },
    // bootstrap.js must never call importGlobalProperties again; it once
    // killed the whole startup in a real Zotero plugin sandbox.
    Components: { utils: { importGlobalProperties: () => { throw new Error("bootstrap must not call importGlobalProperties"); } } },
    ChromeUtils: { importESModule: (uri) => {
      if (uri.endsWith("Timer.sys.mjs")) {
        if (options.timerError) throw new Error(options.timerError);
        return { setInterval: () => 17, clearInterval: () => {} };
      }
      if (options.esModules && Object.hasOwn(options.esModules, uri)) return options.esModules[uri];
      return { Services };
    } },
    ...(options.globals || {}),
  };
  const Services = { scriptloader: { loadSubScript(uri, target) {
    if (uri.endsWith("plugin-channel.js")) {
      if (options.channelLoadError) throw new Error(options.channelLoadError);
      target.LiteraturePluginChannel = { createDesktop: (args) => {
        channelArgs = args;
        if (options.createDesktopError) throw new Error(options.createDesktopError);
        return {
          start: async () => { calls.push("channel start"); if (options.channelStartError) throw new Error(options.channelStartError); },
          stop: async () => calls.push("channel stop"),
        };
      } };
    }
    if (uri.endsWith("metrics-backfill-menu.js")) {
      target.LiteratureMetricsBackfillMenu = {
        start: (settings) => { calls.push("menu start"); menuSettings = settings; },
        stop: async () => calls.push("menu stop"),
      };
    }
    if (uri.endsWith("literature-metrics.js")) {
      if (options.metricsLoadError) throw new Error(options.metricsLoadError);
      target.LiteratureMetrics = {
        start: async () => { calls.push("metrics start"); if (options.metricsStartError) throw new Error(options.metricsStartError); },
        stop: async () => calls.push("metrics stop"),
      };
    }
  } } };
  vm.createContext(scope);
  vm.runInContext(source("bootstrap.js"), scope);
  return { scope, calls, errors, debugs, channelArgs: () => channelArgs, menuSettings: () => menuSettings };
}

function assertLogged(entries, marker) {
  assert.equal(entries.length, 1, `exactly one log entry, got: ${JSON.stringify(entries)}`);
  assert.match(entries[0], marker);
  assert.match(entries[0], /\n\s*at /, "the logged error must include a stack");
}

test("bootstrap starts metrics first, then the channel, then the menu; shutdown reverses the order", async () => {
  const { scope, calls, errors, debugs, menuSettings } = bootstrapHarness({ globals: { IOUtils: {}, PathUtils: {} } });
  await scope.startup({ rootURI: "fake/" });
  assert.deepEqual(calls, ["metrics start", "channel start", "menu start"]);
  assert.ok(menuSettings().channel, "the menu receives the live jobs channel");
  assert.equal(typeof menuSettings().schedule, "function");
  assert.equal(typeof menuSettings().cancel, "function");
  assert.equal(typeof menuSettings().confirm, "function");
  assert.deepEqual(errors, []);
  assert.deepEqual(debugs, []);
  await scope.shutdown();
  assert.deepEqual(calls, ["metrics start", "channel start", "menu start", "menu stop", "channel stop", "metrics stop"]);
});

for (const failure of ["channelLoadError", "createDesktopError", "channelStartError"]) {
  test(`metrics columns still start when the channel fails at ${failure}`, async () => {
    const { scope, calls, errors, debugs } = bootstrapHarness({ [failure]: `${failure} simulated`, globals: { IOUtils: {}, PathUtils: {} } });
    await scope.startup({ rootURI: "fake/" });
    assert.equal(calls[0], "metrics start");
    assertLogged(errors, new RegExp(`Workbench jobs channel: ${failure} simulated`));
    assertLogged(debugs, new RegExp(`Workbench jobs channel: ${failure} simulated`));
    await scope.shutdown();
    assert.equal(calls.at(-1), "metrics stop", "metrics are still torn down");
    assert.ok(!calls.includes("menu start"), "the menu never registers when the channel failed to start");
    if (failure === "channelStartError") assert.ok(calls.includes("channel stop"), "a half-started channel is still stopped");
  });
}

test("an unexpected metrics-startup failure is logged with its stack and does not escape", async () => {
  for (const failure of ["metricsLoadError", "metricsStartError"]) {
    const { scope, calls, errors, debugs } = bootstrapHarness({ [failure]: `${failure} simulated` });
    await scope.startup({ rootURI: "fake/" });
    assert.deepEqual(calls, failure === "metricsStartError" ? ["metrics start"] : []);
    assertLogged(errors, new RegExp(`Workbench literature-metrics startup: ${failure} simulated`));
    assertLogged(debugs, new RegExp(`Workbench literature-metrics startup: ${failure} simulated`));
    await scope.shutdown();
  }
});

test("channel IOUtils/PathUtils fall back to guarded ES module imports without importGlobalProperties", async () => {
  const IOUtilsMarker = { marker: "IOUtils" };
  const PathUtilsMarker = { marker: "PathUtils" };
  const { scope, calls, errors, channelArgs } = bootstrapHarness({
    esModules: {
      "resource://gre/modules/IOUtils.sys.mjs": { IOUtils: IOUtilsMarker },
      "resource://gre/modules/PathUtils.sys.mjs": { PathUtils: PathUtilsMarker },
    },
  });
  await scope.startup({ rootURI: "fake/" });
  assert.deepEqual(calls, ["metrics start", "channel start", "menu start"]);
  assert.deepEqual(errors, []);
  assert.equal(channelArgs().IOUtils, IOUtilsMarker);
  assert.equal(channelArgs().PathUtils, PathUtilsMarker);
});

test("the channel falls back to the main-window interval timer when Timer.sys.mjs is unavailable", async () => {
  const intervals = [];
  const window = {
    setInterval: (_task, ms) => { intervals.push(ms); return 41; },
    clearInterval: (id) => assert.equal(id, 41),
  };
  const { scope, calls, errors, channelArgs } = bootstrapHarness({ timerError: "Timer.sys.mjs unavailable", zotero: { getMainWindow: () => window } });
  await scope.startup({ rootURI: "fake/" });
  assert.deepEqual(errors, []);
  assert.deepEqual(calls, ["metrics start", "channel start", "menu start"]);
  channelArgs().schedule(() => {}, 2000);
  assert.deepEqual(intervals, [2000]);
  channelArgs().cancel(41);
});

test("the channel falls back to a re-arming setTimeout loop when no window timer exists", async () => {
  const { scope, calls, errors, channelArgs } = bootstrapHarness({ timerError: "Timer.sys.mjs unavailable", globals: { setTimeout, clearTimeout } });
  await scope.startup({ rootURI: "fake/" });
  assert.deepEqual(errors, []);
  assert.deepEqual(calls, ["metrics start", "channel start", "menu start"]);
  let fires = 0;
  const handle = channelArgs().schedule(() => { fires += 1; }, 5);
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.ok(fires >= 2, "the fallback timer re-arms itself");
  channelArgs().cancel(handle);
  const frozen = fires;
  await new Promise((resolve) => setTimeout(resolve, 15));
  assert.equal(fires, frozen, "cancel stops the re-arming loop");
  await scope.shutdown();
});

// Services.scriptloader.loadSubScript evaluates a file with the caller's scope
// object as the variable target while its globalThis is a DIFFERENT object. A
// plain vm.createContext({}) makes globalThis === context, so it would not
// have caught the real bug where the export landed on globalThis instead of
// the scope. This harness reproduces the loadSubScript separation in Node.
function loadSubScriptLike(code, scope) {
  const otherGlobal = {};
  const context = vm.createContext(scope);
  Object.defineProperty(context, "globalThis", { value: otherGlobal, writable: true, configurable: true });
  vm.runInContext(code, context);
  return otherGlobal;
}

test("loadSubScript-style loading keeps globalThis separate from the scope", () => {
  const probeScope = {};
  const probeOther = loadSubScriptLike("var seen = globalThis;", probeScope);
  assert.notEqual(probeScope.seen, probeScope, "the harness really separates globalThis from the loadSubScript scope");
  assert.equal(probeScope.seen, probeOther);
});

test("the channel export lives on the loadSubScript scope, not on globalThis", () => {
  const scope = {};
  const otherGlobal = loadSubScriptLike(source("src/ai-summaries.js"), scope);
  loadSubScriptLike(source("src/plugin-channel.js"), scope);
  assert.ok(scope.LiteraturePluginChannel, "the export must land on the loadSubScript scope");
  assert.equal(otherGlobal.LiteraturePluginChannel, undefined, "switching back to a globalThis export must fail this test");
  assert.equal(otherGlobal.LiteratureAiSummaries, undefined, "ai-summaries must also be a scope binding");
  const { create, createDesktop, planHash } = scope.LiteraturePluginChannel;
  assert.equal(typeof create, "function");
  assert.equal(typeof createDesktop, "function");
  assert.equal(typeof planHash, "function");
  const job = ping();
  assert.equal(planHash(job), job.plan_hash, "planHash keeps the SHA-256 contract via the same-scope LiteratureAiSummaries");
});

test("the ping loop never claims, confirms, or rejects a metrics-backfill request job", async () => {
  const f = fixture();
  await f.channel.start();
  const request = { schema_version: 1, job_id: randomUUID(), job_type: "metrics-backfill", created_at: new Date().toISOString(), payload: { collection_key: "334VW86H" } };
  request.plan_hash = createHash("sha256").update(JSON.stringify([
    request.schema_version, request.job_id, request.job_type, request.created_at, request.payload,
  ])).digest("hex");
  f.add(request);
  f.add(ping());
  await f.tick();
  assert.equal(f.prompts.length, 1, "only the ping asks for confirmation");
  for (const [name, job] of f.records) {
    if (!name.endsWith(".job.json")) continue;
    if (job.job_type === "metrics-backfill") {
      assert.equal(f.records.has(`${job.job_id}.ack.json`), false, "request jobs get no ack from the ping loop");
      assert.equal(f.records.has(`${job.job_id}.claim.json`), false, "request jobs are never claimed");
    }
  }
  const pingAcks = [...f.records.values()].filter((record) => record.status === "completed");
  assert.equal(pingAcks.length, 1, "the ping itself is still processed normally");
  await f.channel.stop();
});
