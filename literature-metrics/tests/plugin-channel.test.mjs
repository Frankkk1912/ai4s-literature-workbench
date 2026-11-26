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
  vm.runInContext(source("src/native-merge.js"), scope);
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
    if (uri.endsWith("native-merge.js")) {
      // bootstrap.js must load the merge executor into the same scope before
      // plugin-channel.js, whose createDesktop binds the same-scope var.
      if (options.nativeMergeLoadError) throw new Error(options.nativeMergeLoadError);
      target.LiteratureNativeMerge = { createDesktop: () => ({
        validatePlan: () => {},
        execute: async () => ({ status: "rejected", error: "not wired in harness", clusters: [] }),
      }) };
    }
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
      if (options.menuLoadError) throw new Error(options.menuLoadError);
      target.LiteratureMetricsBackfillMenu = {
        start: (settings) => { calls.push("menu start"); menuSettings = settings; if (options.menuStartError) throw new Error(options.menuStartError); },
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

test("onMainWindowLoad re-runs metrics start so columns can recover after the item tree exists", async () => {
  const { scope, calls, errors } = bootstrapHarness({ globals: { IOUtils: {}, PathUtils: {} } });
  await scope.startup({ rootURI: "fake/", id: "literature-metrics@frank-ai4s.local", version: "0.2.1" });
  assert.equal(typeof scope.onMainWindowLoad, "function");
  await scope.onMainWindowLoad({ rootURI: "fake/", id: "literature-metrics@frank-ai4s.local", version: "0.2.1" });
  assert.deepEqual(calls, ["metrics start", "channel start", "menu start", "metrics start"]);
  assert.deepEqual(errors, []);
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

test("a native-merge load failure is isolated and does not take down columns, the channel, or the menu", async () => {
  const { scope, calls, errors, debugs } = bootstrapHarness({ nativeMergeLoadError: "nativeMergeLoadError simulated", globals: { IOUtils: {}, PathUtils: {} } });
  await scope.startup({ rootURI: "fake/" });
  assert.deepEqual(calls, ["metrics start", "channel start", "menu start"]);
  assertLogged(errors, /Workbench native-merge: nativeMergeLoadError simulated/);
  assertLogged(debugs, /Workbench native-merge: nativeMergeLoadError simulated/);
  await scope.shutdown();
  assert.deepEqual(calls, ["metrics start", "channel start", "menu start", "menu stop", "channel stop", "metrics stop"]);
});

test("a menu load or start failure is isolated and does not take down columns or the channel", async () => {
  for (const failure of ["menuLoadError", "menuStartError"]) {
    const { scope, calls, errors, debugs } = bootstrapHarness({ [failure]: `${failure} simulated`, globals: { IOUtils: {}, PathUtils: {} } });
    await scope.startup({ rootURI: "fake/" });
    assert.deepEqual(calls, failure === "menuStartError" ? ["metrics start", "channel start", "menu start"] : ["metrics start", "channel start"]);
    assertLogged(errors, new RegExp(`Workbench metrics backfill menu: ${failure} simulated`));
    assertLogged(debugs, new RegExp(`Workbench metrics backfill menu: ${failure} simulated`));
    await scope.shutdown();
    assert.ok(calls.includes("channel stop"), "the channel is still torn down");
    assert.equal(calls.at(-1), "metrics stop", "metrics are still torn down");
  }
});

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
  loadSubScriptLike(source("src/native-merge.js"), scope);
  loadSubScriptLike(source("src/plugin-channel.js"), scope);
  assert.ok(scope.LiteraturePluginChannel, "the export must land on the loadSubScript scope");
  assert.equal(otherGlobal.LiteraturePluginChannel, undefined, "switching back to a globalThis export must fail this test");
  assert.equal(otherGlobal.LiteratureAiSummaries, undefined, "ai-summaries must also be a scope binding");
  assert.equal(otherGlobal.LiteratureNativeMerge, undefined, "native-merge must also be a scope binding");
  assert.ok(scope.LiteratureNativeMerge, "the native-merge export must land on the loadSubScript scope");
  const { create, createDesktop, planHash } = scope.LiteraturePluginChannel;
  assert.equal(typeof create, "function");
  assert.equal(typeof createDesktop, "function");
  assert.equal(typeof planHash, "function");
  const job = ping();
  assert.equal(planHash(job), job.plan_hash, "planHash keeps the SHA-256 contract via the same-scope LiteratureAiSummaries");
});

test("plugin-channel still loads and hashes jobs when native-merge is absent", () => {
  const scope = { crypto: { randomUUID, getRandomValues: (arr) => arr.fill(7) } };
  loadSubScriptLike(source("src/ai-summaries.js"), scope);
  loadSubScriptLike(source("src/plugin-channel.js"), scope);
  assert.ok(scope.LiteraturePluginChannel, "the channel export must still land on the scope");
  assert.equal(scope.LiteratureNativeMerge, undefined);
  const created = [];
  const channel = scope.LiteraturePluginChannel.create({
    files: {
      async ensureDir() {},
      async writePresence() { created.push("presence"); },
      async list() { return []; },
      async read() { return null; },
      async write() {},
      async remove() {},
      async exists() { return false; },
    },
    confirm: async () => true,
    merge: null,
    schedule: () => 1,
    cancel() {},
    log() {},
    now: () => "2026-11-26T12:00:00.000Z",
    uuid: () => "11111111-1111-4111-8111-111111111111",
  });
  // planHash is used internally when creating/validating; just starting is enough
  // to prove create() does not throw without LiteratureNativeMerge.
  assert.equal(typeof channel.start, "function");
  assert.equal(typeof channel.submitMetricsBackfillJob, "function");
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

// Real Gecko nsIUUIDGenerator.toString() wraps a possibly-uppercase UUID in braces.
function geckoGenerateUUID() {
  return { toString: () => `{${randomUUID().toUpperCase()}}` };
}

// Exercise createDesktop's real path() allowlist, not the in-memory fixture writer.
function desktopBackfillHarness(generateUUID = geckoGenerateUUID) {
  const paths = posix;
  const home = "/test-home";
  let root;
  const records = new Map();
  const Components = {
    interfaces: { nsIFile: {} },
    classes: { "@mozilla.org/file/local;1": { createInstance: () => ({ initWithPath() {}, isSymlink: () => false }) } },
  };
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
    Zotero: { isWin: false, isMac: true, getMainWindow: () => ({}), logError() {} },
    Services: { env: { get: () => "" }, dirsvc: { get: () => ({ path: home }) },
      uuid: { generateUUID }, prompt: { confirm: () => true } },
    Components, IOUtils, PathUtils: { join: paths.join, filename: paths.basename }, schedule: () => 1, cancel() {},
  });
  return { channel, records, paths, root: () => root };
}

test("submitMetricsBackfillJob writes allowlisted filenames for item_keys and collection_key even when Gecko UUIDs have braces and uppercase", async () => {
  const SAFE_NAME = /^[a-f0-9-]{36}\.(job|ack|claim|result)\.json$/;
  const JOB_ID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
  const { channel, records, paths, root } = desktopBackfillHarness();
  await channel.start();
  const payloads = [
    { collection_key: "334VW86H" },
    { item_keys: ["3DI5B43M", "C5XDZY48"] },
  ];
  for (const payload of payloads) {
    const job = await channel.submitMetricsBackfillJob(payload);
    assert.match(job.job_id, JOB_ID, `job_id must be a lowercase UUID v4, got ${job.job_id}`);
    assert.equal(job.job_id.includes("{") || job.job_id.includes("}") || /[A-F]/.test(job.job_id), false);
    assert.deepEqual(job.payload, payload);
    const jobName = `${job.job_id}.job.json`;
    const resultName = `${job.job_id}.result.json`;
    assert.match(jobName, SAFE_NAME);
    assert.match(resultName, SAFE_NAME);
    assert.equal(jobName.includes("/") || jobName.includes("\\"), false);
    assert.deepEqual(records.get(paths.join(root(), jobName)), job, "submit must write through the real filename allowlist");
    records.set(paths.join(root(), resultName), { job_id: job.job_id, status: "completed" });
    const result = await channel.readMetricsBackfillResult(job.job_id);
    assert.equal(result.job_id, job.job_id);
    await channel.discardMetricsBackfillJob(job.job_id);
    assert.equal(records.has(paths.join(root(), jobName)), false);
    assert.equal(records.has(paths.join(root(), resultName)), false);
  }
  await channel.stop();
});

test("createDesktop still rejects job ids that cannot be normalized to a UUID v4 filename", async () => {
  for (const raw of ["{not-a-uuid}", "../evil", "a/b", "presence.json", ""]) {
    const { channel } = desktopBackfillHarness(() => ({ toString: () => raw }));
    await channel.start();
    await assert.rejects(channel.submitMetricsBackfillJob({ collection_key: "334VW86H" }), /Unsafe channel job id/);
    await channel.stop();
  }
});


// ---- native-merge jobs: the channel drives the real merge executor ----

function moduleScope() {
  const scope = vm.createContext({});
  vm.runInContext(source("src/ai-summaries.js"), scope);
  vm.runInContext(source("src/native-merge.js"), scope);
  vm.runInContext(source("src/plugin-channel.js"), scope);
  return scope;
}

function nativeMergeJob(payload, fields = {}) {
  const job = { schema_version: 1, job_id: randomUUID(), job_type: "native-merge", created_at: new Date().toISOString(), payload };
  job.plan_hash = createHash("sha256").update(JSON.stringify([job.schema_version, job.job_id, job.job_type, job.created_at, job.payload])).digest("hex");
  // Tampering fields are applied after the computed hash so they really take effect.
  return { ...job, ...fields };
}

function guardPlan(scope, { collectionKey = "334VW86H" } = {}) {
  const cluster = (id, masterKey, mergeKeys, preSteps) => ({
    cluster_id: id, confidence: "high", reasons: ["same-doi"],
    master_key: masterKey, master_title: "Smoke " + id, master_version: 3,
    merge_keys: mergeKeys, master_outside_scope: preSteps.length > 0, pre_steps: preSteps,
    item_versions: [masterKey, ...mergeKeys].map((key) => ({ key, version: 3 })),
    keep: {
      attachments: { keys: [], policy: "kept" }, notes: { keys: [], policy: "kept" },
      tags: { union: [], policy: "unioned" }, collections: { union: [collectionKey], policy: "unioned" },
      relations: { existing: [], dc_replaces_after_merge: mergeKeys, policy: "recorded" },
    },
    trash: { keys: mergeKeys, destination: "trash", recoverable: true, permanent_delete: false, policy: "trash only" },
    verification: { keys_checked: 1 + mergeKeys.length, version_changes: [], scope_membership: [] },
  });
  const plan = {
    schema_version: "1.0.0", plan_type: "zotero-dedupe-plan",
    plan_id: "dedupe-plan-smoke", created_at: "2026-11-26T00:00:00.000Z", plan_hash: "",
    source: { kind: "collection_scan", collection_key: collectionKey },
    library: { type: "user", id: 12345 },
    batch_selector: { collection_key: collectionKey },
    policy: {
      zotero_writes: false, needs_plugin: true, native_merge_required: true,
      merged_items_destination: "trash", recoverable: true, permanent_delete: false,
    },
    cluster_count: 2,
    clusters: [
      cluster("duplicate-0001", "SMOKE001", ["SMOKE002"], []),
      cluster("duplicate-0002", "OUTSIDE1", ["SMOKE003"], [{
        step: "add_master_to_collection", item_key: "OUTSIDE1", collection_key: collectionKey,
        already_satisfied: false, reason: "The recommended master is outside the batch collection.",
      }]),
    ],
  };
  plan.plan_hash = scope.LiteratureNativeMerge.canonicalPlanHash(plan);
  return plan;
}

function mergeFixture(scope, { agrees = true, plan = null } = {}) {
  const records = new Map();
  const writes = [];
  const prompts = [];
  const merges = [];
  const items = new Map();
  for (const key of ["SMOKE001", "SMOKE002", "SMOKE003", "OUTSIDE1"]) {
    items.set(key, {
      key, addedTo: [], saved: 0,
      addToCollection(collectionKey) { items.get(key).addedTo.push(collectionKey); },
      async saveTx() { items.get(key).saved += 1; },
    });
  }
  const usePlan = plan ?? guardPlan(scope);
  const Zotero = {
    Libraries: { userLibraryID: 1 },
    Groups: { get: () => null },
    Items: {
      getByLibraryAndKey: (libraryID, key) => (libraryID === 1 ? items.get(key) : null),
      merge: async (master, others) => { merges.push([master.key, others.map((other) => other.key)]); },
    },
  };
  const files = {
    initialize: async () => {},
    list: async () => [...records.keys()],
    read: async (name) => records.get(name) || null,
    write: async (name, value) => { records.set(name, value); writes.push({ name, value }); },
    remove: async (name) => { records.delete(name); },
    readPlan: async () => usePlan,
  };
  const channel = scope.LiteraturePluginChannel.create({ files,
    confirm: async (title, text) => { prompts.push({ title, text }); return agrees; },
    merge: scope.LiteratureNativeMerge.createDesktop({ Zotero, log: () => {} }),
    schedule: () => 1, cancel() {}, log: () => {},
  });
  return { channel, records, writes, prompts, merges, items, plan: usePlan,
    add: (job) => records.set(`${job.job_id}.job.json`, job) };
}

test("a native-merge job runs the real executor and writes a per-cluster completed receipt", async () => {
  const scope = moduleScope();
  const f = mergeFixture(scope);
  const job = nativeMergeJob({ plan_path: "/data/dedupe-plans/dedupe-plan-smoke.json", plan_hash: f.plan.plan_hash, collection_key: "334VW86H" });
  f.add(job);
  await f.channel.start();
  const receipt = f.records.get(`${job.job_id}.ack.json`);
  assert.equal(receipt.status, "completed");
  assert.equal(receipt.plan_hash, job.plan_hash);
  assert.equal(f.prompts.length, 1);
  assert.match(f.prompts[0].title, /native merge/);
  assert.match(f.prompts[0].text, /keep master SMOKE001.*merge in SMOKE002/s);
  assert.match(f.prompts[0].text, /add the master to the collection first/);
  assert.equal(JSON.stringify(f.merges), JSON.stringify([["SMOKE001", ["SMOKE002"]], ["OUTSIDE1", ["SMOKE003"]]]));
  assert.equal(f.items.get("OUTSIDE1").addedTo.join(","), "334VW86H", "only the guard collection is added");
  assert.equal(f.items.get("SMOKE001").addedTo.length, 0);
  assert.equal(JSON.stringify(receipt.clusters.map((entry) => entry.status)), JSON.stringify(["success", "success"]));
  assert.equal(receipt.clusters[1].added_to_collection, true);
  assert.equal(receipt.clusters[0].added_to_collection, false);
  // Crash-safe progress: an accepted receipt was written after the first cluster.
  const accepted = f.writes.filter((write) => write.name.endsWith(".ack.json") && write.value.status === "accepted");
  assert.equal(accepted.length, 2);
  assert.equal(accepted[0].value.clusters.length, 1);
  assert.equal(f.records.has(`${job.job_id}.claim.json`), false, "the claim is cleared with the receipt");
  await f.channel.stop();
});

test("declining the native-merge dialog writes rejected and makes zero Zotero writes", async () => {
  const scope = moduleScope();
  const f = mergeFixture(scope, { agrees: false });
  const job = nativeMergeJob({ plan_path: "/data/dedupe-plans/dedupe-plan-smoke.json", plan_hash: f.plan.plan_hash, collection_key: "334VW86H" });
  f.add(job);
  await f.channel.start();
  const receipt = f.records.get(`${job.job_id}.ack.json`);
  assert.equal(receipt.status, "rejected");
  assert.match(receipt.error, /declined/);
  assert.equal(f.merges.length, 0, "Zotero.Items.merge is never called");
  for (const item of f.items.values()) {
    assert.equal(item.addedTo.length, 0, "no master is added to any collection");
    assert.equal(item.saved, 0, "no item is saved");
  }
  await f.channel.stop();
});

test("a tampered native-merge job hash is rejected without reading the plan or showing a dialog", async () => {
  const scope = moduleScope();
  const f = mergeFixture(scope);
  const job = nativeMergeJob({ plan_path: "/data/dedupe-plans/dedupe-plan-smoke.json", plan_hash: f.plan.plan_hash, collection_key: "334VW86H" },
    { plan_hash: "0".repeat(64) });
  f.add(job);
  await f.channel.start();
  const receipt = f.records.get(`${job.job_id}.ack.json`);
  assert.equal(receipt.status, "rejected");
  assert.match(receipt.error, /plan_hash mismatch/);
  assert.equal(f.prompts.length, 0);
  assert.equal(f.merges.length, 0);
  assert.equal(f.records.has(`${job.job_id}.claim.json`), false, "invalid jobs are never claimed");
  await f.channel.stop();
});

test("a plan for any collection other than the smoke-test collection is refused", async () => {
  const scope = moduleScope();
  const otherPlan = guardPlan(scope, { collectionKey: "PLANCOL1" });
  const f = mergeFixture(scope, { plan: otherPlan });
  const job = nativeMergeJob({ plan_path: "/data/dedupe-plans/dedupe-plan-other.json", plan_hash: otherPlan.plan_hash, collection_key: "PLANCOL1" });
  f.add(job);
  await f.channel.start();
  const receipt = f.records.get(`${job.job_id}.ack.json`);
  assert.equal(receipt.status, "rejected");
  assert.match(receipt.error, /only allowed for the test collection AI4S-smoke-sync-20261126 \(334VW86H\)/);
  assert.equal(f.prompts.length, 0, "no dialog for a refused plan");
  assert.equal(f.merges.length, 0);
  await f.channel.stop();
});

test("a job whose payload hash differs from the plan file is refused before the dialog", async () => {
  const scope = moduleScope();
  const f = mergeFixture(scope);
  const job = nativeMergeJob({ plan_path: "/data/dedupe-plans/dedupe-plan-smoke.json", plan_hash: "sha256:" + "0".repeat(64), collection_key: "334VW86H" });
  f.add(job);
  await f.channel.start();
  const receipt = f.records.get(`${job.job_id}.ack.json`);
  assert.equal(receipt.status, "rejected");
  assert.match(receipt.error, /does not match the plan file/);
  assert.equal(f.prompts.length, 0);
  assert.equal(f.merges.length, 0);
  await f.channel.stop();
});

test("an interrupted job resumes from its accepted receipt and never re-merges a finished cluster", async () => {
  const scope = moduleScope();
  const f = mergeFixture(scope);
  const job = nativeMergeJob({ plan_path: "/data/dedupe-plans/dedupe-plan-smoke.json", plan_hash: f.plan.plan_hash, collection_key: "334VW86H" });
  // Simulate a crash after the first cluster: the accepted receipt survives.
  f.records.set(`${job.job_id}.ack.json`, {
    job_id: job.job_id, plan_hash: job.plan_hash, status: "accepted", finished_at: new Date().toISOString(),
    clusters: [{ cluster_id: "duplicate-0001", status: "success", master_key: "SMOKE001", merged_keys: ["SMOKE002"], added_to_collection: false }],
  });
  f.add(job);
  await f.channel.start();
  const receipt = f.records.get(`${job.job_id}.ack.json`);
  assert.equal(receipt.status, "completed");
  assert.equal(JSON.stringify(f.merges), JSON.stringify([["OUTSIDE1", ["SMOKE003"]]]), "only the unfinished cluster is merged");
  assert.equal(JSON.stringify(receipt.clusters.map((entry) => entry.status)), JSON.stringify(["skipped", "success"]));
  assert.match(f.prompts[0].text, /already merged in an earlier run: skipped/);
  await f.channel.stop();
});

test("the desktop adapter refuses plan paths outside dedupe-plans, symlinks, and oversized plan files", async () => {
  const paths = posix;
  const home = "/test-home";
  const root = paths.join(home, "Library", "Application Support", "literature-zotero-mcp", "plugin-jobs");
  const records = new Map();
  let symlink = false;
  let symlinkTarget = null;
  let planSize = 200;
  const Components = { interfaces: { nsIFile: {} }, classes: { "@mozilla.org/file/local;1": { createInstance: () => ({
    path: "",
    initWithPath(target) { this.path = target; },
    isSymlink() { return symlink && this.path === symlinkTarget; },
  }) } } };
  const IOUtils = {
    async makeDirectory() {},
    async stat(path) { return { type: path === root ? "directory" : "regular", size: path.includes(".job.json") ? 200 : planSize }; },
    async exists(path) { return records.has(path); },
    async getChildren() { return [...records.keys()]; },
    async readJSON(path) { return records.get(path); },
    async writeJSON(path, value, options) { assert.equal(options.mode, "create"); records.set(path, value); },
    async setPermissions() {},
    async move(from, to) { records.set(to, records.get(from)); records.delete(from); },
    async remove(path) { records.delete(path); },
  };
  const scope = moduleScope();
  const plan = guardPlan(scope);
  const zoteroItems = new Map();
  for (const key of ["SMOKE001", "SMOKE002", "SMOKE003", "OUTSIDE1"]) {
    zoteroItems.set(key, {
      key,
      addToCollection() {},
      async saveTx() {},
    });
  }
  const channel = scope.LiteraturePluginChannel.createDesktop({
    Zotero: {
      isMac: true, getMainWindow: () => ({}), logError() {},
      Libraries: { userLibraryID: 1 },
      Groups: { get: () => null },
      Items: {
        getByLibraryAndKey: (libraryID, key) => (libraryID === 1 ? zoteroItems.get(key) : null),
        merge: async () => {},
      },
    },
    Services: { env: { get: () => "" }, dirsvc: { get: () => ({ path: home }) },
      uuid: { generateUUID: randomUUID }, prompt: { confirm: () => true } },
    Components, IOUtils, PathUtils: { join: paths.join, filename: paths.basename, parent: paths.dirname, normalize: paths.normalize },
    schedule: () => 1, cancel() {},
  });
  await channel.start();
  const planDir = paths.join(home, "Library", "Application Support", "literature-zotero-mcp", "dedupe-plans");
  const planPath = paths.join(planDir, "dedupe-plan-smoke.json");
  records.set(planPath, plan);

  const outside = nativeMergeJob({ plan_path: paths.join(home, "elsewhere", "plan.json"), plan_hash: plan.plan_hash, collection_key: "334VW86H" });
  records.set(paths.join(root, `${outside.job_id}.job.json`), outside);
  await channel.scan();
  assert.match(String(records.get(paths.join(root, `${outside.job_id}.ack.json`)).error), /Unsafe dedupe plan path/);

  const inside = nativeMergeJob({ plan_path: planPath, plan_hash: plan.plan_hash, collection_key: "334VW86H" });
  records.set(paths.join(root, `${inside.job_id}.job.json`), inside);
  records.delete(paths.join(root, `${outside.job_id}.job.json`));
  await channel.scan();
  assert.equal(records.get(paths.join(root, `${inside.job_id}.ack.json`)).status, "completed", "a plan inside dedupe-plans with a plain filename is accepted");

  const symlinked = nativeMergeJob({ plan_path: planPath, plan_hash: plan.plan_hash, collection_key: "334VW86H" });
  records.set(paths.join(root, `${symlinked.job_id}.job.json`), symlinked);
  records.delete(paths.join(root, `${inside.job_id}.job.json`));
  records.delete(paths.join(root, `${inside.job_id}.ack.json`));
  symlink = true;
  symlinkTarget = planPath;
  await channel.scan();
  assert.match(String(records.get(paths.join(root, `${symlinked.job_id}.ack.json`)).error), /symlink/);

  const huge = nativeMergeJob({ plan_path: planPath, plan_hash: plan.plan_hash, collection_key: "334VW86H" });
  records.set(paths.join(root, `${huge.job_id}.job.json`), huge);
  records.delete(paths.join(root, `${symlinked.job_id}.job.json`));
  records.delete(paths.join(root, `${symlinked.job_id}.ack.json`));
  symlink = false;
  planSize = 1048577;
  await channel.scan();
  assert.match(String(records.get(paths.join(root, `${huge.job_id}.ack.json`)).error), /Unsafe dedupe plan file/);

  await channel.stop();
});
