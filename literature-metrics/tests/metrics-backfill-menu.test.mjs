import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const source = (name) => readFileSync(new URL(`../${name}`, import.meta.url), "utf8");
const JOB_ID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;

function node(name) {
  return {
    name,
    style: {},
    attributes: {},
    children: [],
    listeners: {},
    hidden: false,
    parentNode: null,
    appendChild(child) { child.parentNode = this; this.children.push(child); },
    setAttribute(key, value) { this.attributes[key] = String(value); },
    addEventListener(type, listener) { this.listeners[type] = listener; },
    removeEventListener(type, listener) { if (this.listeners[type] === listener) delete this.listeners[type]; },
    remove() { if (this.parentNode) this.parentNode.children = this.parentNode.children.filter((child) => child !== this); },
    async dispatch(type) { await this.listeners[type]?.({}); },
  };
}

function makeItem(key, { regular = true } = {}) {
  return { id: key, key, isRegularItem: () => regular };
}

function harness({ agrees = true } = {}) {
  const records = new Map();
  const prompts = [];
  const progress = [];
  const watchFns = [];
  const scanFns = [];
  const itemMenu = node("menupopup#zotero-itemmenu");
  const collectionMenu = node("menupopup#zotero-collectionmenu");
  let selected = [];
  let collection = null;
  const document = {
    getElementById(id) {
      if (id === "zotero-itemmenu") return itemMenu;
      if (id === "zotero-collectionmenu") return collectionMenu;
      return null;
    },
    createElementNS(_namespace, name) { return node(name); },
  };
  const mainWindow = {
    document,
    ZoteroPane: {
      getSelectedItems: () => selected,
      getSelectedCollection: () => collection,
    },
  };
  const Zotero = {
    getMainWindow: () => mainWindow,
    ProgressWindow: function ProgressWindow() {
      const record = {};
      progress.push(record);
      this.changeHeadline = (value) => { record.headline = value; };
      this.addDescription = (value) => { record.description = value; };
      this.show = () => { record.shown = true; };
      this.startCloseTimer = () => { record.closeTimer = true; };
    },
    debug() {},
    logError() {},
  };
  const files = {
    initialize: async () => {},
    list: async () => [...records.keys()],
    read: async (name) => records.get(name) || null,
    write: async (name, value) => { records.set(name, JSON.parse(JSON.stringify(value))); },
    remove: async (name) => { records.delete(name); },
  };
  const scope = vm.createContext({ Zotero });
  vm.runInContext(source("src/ai-summaries.js"), scope);
  vm.runInContext(source("src/plugin-channel.js"), scope);
  vm.runInContext(source("src/metrics-backfill-menu.js"), scope);
  const confirm = async (title, text) => { prompts.push({ title, text }); return agrees; };
  const channel = scope.LiteraturePluginChannel.create({
    files,
    confirm,
    schedule: (fn, ms) => { assert.equal(ms, 2000); scanFns.push(fn); return 1; },
    cancel: () => {},
    log: () => {},
    uuid: () => randomUUID(),
  });
  scope.LiteratureMetricsBackfillMenu.start({ channel, schedule: (fn, ms) => { assert.equal(ms, 2000); watchFns.push(fn); return watchFns.length; }, cancel: () => {}, confirm });
  return {
    scope, records, channel, prompts, progress, watchFns, scanFns, itemMenu, collectionMenu,
    select: (items) => { selected = items; },
    setCollection: (value) => { collection = value; },
    tick: async () => { for (const fn of [...watchFns]) await fn(); },
    jobFiles: () => [...records.keys()].filter((name) => name.endsWith(".job.json") && !name.includes(".tmp")),
    lastProgress: () => progress.at(-1) || null,
  };
}

// loadSubScript runs the module in a scope object that is NOT globalThis, so a
// `var` export lands on the scope while a globalThis assignment would be lost.
// This harness reproduces the loadSubScript separation in Node.
function loadSubScriptLike(code, scope) {
  const otherGlobal = {};
  const context = vm.createContext(scope);
  Object.defineProperty(context, "globalThis", { value: otherGlobal, writable: true, configurable: true });
  vm.runInContext(code, context);
  return otherGlobal;
}

test("exports via var onto the loadSubScript scope, not globalThis", () => {
  const scope = { Zotero: { debug() {}, logError() {} } };
  const otherGlobal = loadSubScriptLike(source("src/metrics-backfill-menu.js"), scope);
  assert.ok(scope.LiteratureMetricsBackfillMenu, "the export must land on the loadSubScript scope");
  assert.equal(typeof scope.LiteratureMetricsBackfillMenu.start, "function");
  assert.equal(otherGlobal.LiteratureMetricsBackfillMenu, undefined, "a globalThis export would be invisible to bootstrap");
  assert.equal(globalThis.LiteratureMetricsBackfillMenu, undefined);
});

test("registers item and collection menu entries with stable ids and labels", async () => {
  const h = harness();
  const itemEntry = h.itemMenu.children.at(-1);
  assert.equal(itemEntry.id, "literature-metrics-backfill-items-menuitem");
  assert.equal(itemEntry.attributes.label, "Backfill Metrics for Selected Items");
  const collectionEntry = h.collectionMenu.children.at(-1);
  assert.equal(collectionEntry.id, "literature-metrics-backfill-collection-menuitem");
  assert.equal(collectionEntry.attributes.label, "Backfill Metrics for Current Collection");

  h.select([]);
  h.setCollection({ objectType: "search", key: "SEARCHK1" });
  await h.itemMenu.dispatch("popupshowing");
  await h.collectionMenu.dispatch("popupshowing");
  assert.equal(itemEntry.hidden, true);
  assert.equal(collectionEntry.hidden, true);

  h.select([makeItem("AAAA0001")]);
  h.setCollection({ objectType: "collection", key: "334VW86H" });
  await h.itemMenu.dispatch("popupshowing");
  await h.collectionMenu.dispatch("popupshowing");
  assert.equal(itemEntry.hidden, false);
  assert.equal(collectionEntry.hidden, false);
  await h.channel.stop();
});

test("selected-items menu submits a preview job whose payload is exactly the item keys", async () => {
  const h = harness();
  await h.channel.start();
  h.select([makeItem("AAAA0001"), makeItem("BBBB0002"), makeItem("AAAA0001"), makeItem("attachment")]);
  await h.itemMenu.children.at(-1).dispatch("command");
  assert.equal(h.jobFiles().length, 1);
  const job = h.records.get(h.jobFiles()[0]);
  assert.equal(Object.keys(job).sort().join(","), "created_at,job_id,job_type,payload,plan_hash,schema_version");
  assert.equal(job.schema_version, 1);
  assert.ok(JOB_ID.test(job.job_id));
  assert.equal(job.job_type, "metrics-backfill");
  assert.ok(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(job.created_at));
  assert.deepEqual(job.payload, { item_keys: ["AAAA0001", "BBBB0002"] });
  const expected = createHash("sha256").update(JSON.stringify([
    job.schema_version, job.job_id, job.job_type, job.created_at, job.payload,
  ])).digest("hex");
  assert.equal(job.plan_hash, expected, "same SHA-256 contract as the Node runtime");
  assert.doesNotMatch(JSON.stringify(job), /api[_-]?key|secret|token|password|easyscholar/i, "no key or secret fields anywhere in the job");
  assert.match(h.prompts[0].text, /PREVIEW/i);
  assert.match(h.prompts[0].text, /dry run/i);
  assert.match(h.lastProgress().description, /Preview request queued.*zotero_backfill_metrics/);
  await h.channel.stop();
});

test("collection menu submits a preview job whose payload is exactly the collection key", async () => {
  const h = harness();
  await h.channel.start();
  h.setCollection({ objectType: "collection", key: "334VW86H" });
  await h.collectionMenu.children.at(-1).dispatch("command");
  assert.equal(h.jobFiles().length, 1);
  const job = h.records.get(h.jobFiles()[0]);
  assert.equal(job.job_type, "metrics-backfill");
  assert.deepEqual(job.payload, { collection_key: "334VW86H" });
  assert.doesNotMatch(JSON.stringify(job), /api[_-]?key|secret|token|password|easyscholar/i);
  await h.channel.stop();
});

test("declining the confirmation dialog submits no job at all, so nothing can be applied", async () => {
  const h = harness({ agrees: false });
  await h.channel.start();
  h.select([makeItem("AAAA0001")]);
  h.setCollection({ objectType: "collection", key: "334VW86H" });
  await h.itemMenu.children.at(-1).dispatch("command");
  await h.collectionMenu.children.at(-1).dispatch("command");
  assert.equal(h.prompts.length, 2);
  assert.equal(h.jobFiles().length, 0);
  assert.equal([...h.records.keys()].filter((name) => name.endsWith(".result.json")).length, 0);
  assert.equal(h.progress.length, 0, "no progress popups without agreement");
  await h.channel.stop();
});

test("shows the runtime preview counts and plan hash, then cleans up the job files", async () => {
  const h = harness();
  await h.channel.start();
  h.select([makeItem("AAAA0001")]);
  await h.itemMenu.children.at(-1).dispatch("command");
  const job = h.records.get(h.jobFiles()[0]);
  h.records.set(`${job.job_id}.result.json`, {
    schema_version: 1,
    job_id: job.job_id,
    job_plan_hash: job.plan_hash,
    status: "completed",
    mode: "dry_run",
    finished_at: new Date().toISOString(),
    preview: { update: 3, skip: 1, plan_hash: "a".repeat(64), easyscholar: { key_configured: true } },
  });
  await h.tick();
  assert.match(h.lastProgress().headline, /Backfill Preview/);
  assert.match(h.lastProgress().description, /3 would update/);
  assert.match(h.lastProgress().description, /1 skipped/);
  assert.match(h.lastProgress().description, new RegExp(`plan_hash ${"a".repeat(16)}…`));
  assert.match(h.lastProgress().description, /apply from your workbench assistant/);
  assert.equal(h.records.has(`${job.job_id}.job.json`), false);
  assert.equal(h.records.has(`${job.job_id}.result.json`), false);
  await h.channel.stop();
});

test("a failed runtime result shows the readable error and still cleans up", async () => {
  const h = harness();
  await h.channel.start();
  h.select([makeItem("AAAA0001")]);
  await h.itemMenu.children.at(-1).dispatch("command");
  const job = h.records.get(h.jobFiles()[0]);
  h.records.set(`${job.job_id}.result.json`, {
    schema_version: 1,
    job_id: job.job_id,
    job_plan_hash: job.plan_hash,
    status: "failed",
    mode: "dry_run",
    finished_at: new Date().toISOString(),
    error: "EasyScholar request failed after retries",
  });
  await h.tick();
  assert.match(h.lastProgress().description, /Preview failed: EasyScholar request failed after retries/);
  assert.equal(h.records.has(`${job.job_id}.job.json`), false);
  await h.channel.stop();
});

test("ignores a result file whose job plan hash does not match the submitted request", async () => {
  const h = harness();
  await h.channel.start();
  h.select([makeItem("AAAA0001")]);
  await h.itemMenu.children.at(-1).dispatch("command");
  const job = h.records.get(h.jobFiles()[0]);
  const before = h.progress.length;
  h.records.set(`${job.job_id}.result.json`, {
    schema_version: 1,
    job_id: job.job_id,
    job_plan_hash: "0".repeat(64),
    status: "completed",
    mode: "dry_run",
    finished_at: new Date().toISOString(),
    preview: { update: 99 },
  });
  await h.tick();
  assert.equal(h.progress.length, before, "a mismatched result is never displayed");
  assert.equal(h.records.has(`${job.job_id}.job.json`), true);
  await h.channel.stop();
});

test("stop removes the menu entries and cancels result watchers", async () => {
  const h = harness();
  await h.channel.start();
  h.select([makeItem("AAAA0001")]);
  await h.itemMenu.children.at(-1).dispatch("command");
  assert.equal(h.watchFns.length, 1);
  await h.scope.LiteratureMetricsBackfillMenu.stop();
  assert.equal(h.itemMenu.children.some((child) => child.id === "literature-metrics-backfill-items-menuitem"), false);
  assert.equal(h.collectionMenu.children.some((child) => child.id === "literature-metrics-backfill-collection-menuitem"), false);
  const before = h.progress.length;
  await h.tick();
  assert.equal(h.progress.length, before, "watchers no longer run after stop");
  await h.channel.stop();
});

test("menus stay unregistered when the jobs channel is unavailable", async () => {
  const itemMenu = node("menupopup#zotero-itemmenu");
  const collectionMenu = node("menupopup#zotero-collectionmenu");
  const document = {
    getElementById(id) {
      if (id === "zotero-itemmenu") return itemMenu;
      if (id === "zotero-collectionmenu") return collectionMenu;
      return null;
    },
    createElementNS(_namespace, name) { return node(name); },
  };
  const Zotero = {
    getMainWindow: () => ({ document }),
    debug(message) { messages.push(String(message)); },
    logError(message) { messages.push(String(message)); },
  };
  const messages = [];
  const scope = vm.createContext({ Zotero });
  vm.runInContext(source("src/metrics-backfill-menu.js"), scope);
  scope.LiteratureMetricsBackfillMenu.start({ channel: null, schedule: () => 1, cancel: () => {}, confirm: async () => true });
  assert.equal(itemMenu.children.length, 0, "no dead menu entry without the channel");
  assert.equal(collectionMenu.children.length, 0, "no dead menu entry without the channel");
  assert.ok(messages.some((message) => /jobs channel is unavailable/.test(message)));
});
