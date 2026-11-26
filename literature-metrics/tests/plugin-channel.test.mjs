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

// Fake Zotero/Gecko objects exercise the actual desktop file adapter, not a live profile.
for (const platform of ["darwin", "win32", "linux", "override"]) {
  test(`desktop adapter uses runtime-compatible ${platform} dataDir and owner-private files`, async () => {
    const paths = platform === "win32" ? win32 : posix;
    const home = platform === "win32" ? "C:\\test-home" : "/test-home";
    const env = platform === "override" ? { ZOTEUS_DATA_DIR: "/custom", LITERATURE_ZOTERO_MCP_DATA_DIR: "/ignored" } : {};
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
    const expected = platform === "override" ? "/custom/plugin-jobs" : paths.join(home,
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

test("bootstrap starts channel and tears it down before stopping metrics", async () => {
  const calls = [];
  const scope = { Zotero: { initializationPromise: Promise.resolve(), logError: (message) => assert.fail(message) },
    Components: { utils: { importGlobalProperties: (names) => assert.deepEqual(Array.from(names), ["IOUtils", "PathUtils"]) } },
    ChromeUtils: { importESModule: (uri) => uri.endsWith("Timer.sys.mjs") ? { setInterval() {}, clearInterval() {} } : { Services } }, IOUtils: {}, PathUtils: {},
  };
  const Services = { scriptloader: { loadSubScript(uri, target) {
    if (uri.endsWith("plugin-channel.js")) target.LiteraturePluginChannel = { createDesktop: () => ({ start: async () => calls.push("channel start"), stop: async () => calls.push("channel stop") }) };
    if (uri.endsWith("literature-metrics.js")) target.LiteratureMetrics = { start: async () => calls.push("metrics start"), stop: async () => calls.push("metrics stop") };
  } } };
  vm.createContext(scope);
  vm.runInContext(source("bootstrap.js"), scope);
  await scope.startup({ rootURI: "fake/" });
  await scope.shutdown();
  assert.deepEqual(calls, ["metrics start", "channel start", "channel stop", "metrics stop"]);
});
