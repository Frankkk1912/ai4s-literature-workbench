import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const source = (name) => readFileSync(new URL(`../${name}`, import.meta.url), "utf8");

// Services.scriptloader.loadSubScript evaluates a file with the caller's scope
// object as the variable target while its globalThis is a DIFFERENT object.
function loadSubScriptLike(code, scope) {
  const otherGlobal = {};
  const context = vm.createContext(scope);
  Object.defineProperty(context, "globalThis", { value: otherGlobal, writable: true, configurable: true });
  vm.runInContext(code, context);
  return otherGlobal;
}

function module() {
  const scope = {};
  loadSubScriptLike(source("src/native-merge.js"), scope);
  return scope.LiteratureNativeMerge;
}

// Receipts and merge-call logs come from the vm realm, so deepStrictEqual sees a
// prototype mismatch; compare the JSON view instead, which is the data contract.
function jsonEqual(actual, expected, message) {
  assert.equal(JSON.stringify(actual), JSON.stringify(expected), message);
}

// The runtime's canonical hash, reimplemented independently with node:crypto so
// the plugin's pure-JavaScript version is cross-checked byte for byte.
function deepSortNode(value) {
  if (Array.isArray(value)) return value.map(deepSortNode);
  if (value && typeof value === "object") {
    const sorted = {};
    for (const key of Object.keys(value).sort()) sorted[key] = deepSortNode(value[key]);
    return sorted;
  }
  return value;
}
function nodeCanonicalHash(plan) {
  const payload = {
    schema_version: plan.schema_version,
    plan_type: plan.plan_type,
    library: plan.library,
    batch_selector: plan.batch_selector,
    policy: plan.policy,
    clusters: [...plan.clusters].sort((a, b) => a.cluster_id.localeCompare(b.cluster_id)),
  };
  return "sha256:" + createHash("sha256").update(JSON.stringify(deepSortNode(payload))).digest("hex");
}

function planFixture() {
  const plan = {
    schema_version: "1.0.0",
    plan_type: "zotero-dedupe-plan",
    plan_id: "dedupe-plan-2026-11-26T00-00-00-000Z-fixture01",
    created_at: "2026-11-26T00:00:00.000Z",
    plan_hash: "",
    source: { kind: "collection_scan", collection_key: "334VW86H" },
    library: { type: "user", id: 12345 },
    batch_selector: { collection_key: "334VW86H" },
    policy: {
      zotero_writes: false, needs_plugin: true, native_merge_required: true,
      merged_items_destination: "trash", recoverable: true, permanent_delete: false,
    },
    cluster_count: 2,
    clusters: [
      {
        cluster_id: "duplicate-0001",
        confidence: "high",
        reasons: ["same-doi"],
        master_key: "SMOKE001",
        master_title: "Smoke  paper: a  duplicate  pair  with  awkward   whitespace",
        master_version: 3,
        merge_keys: ["SMOKE002"],
        master_outside_scope: false,
        pre_steps: [],
        item_versions: [{ key: "SMOKE001", version: 3 }, { key: "SMOKE002", version: 2 }],
        keep: {
          attachments: { keys: ["ATCH0001"], policy: "kept" },
          notes: { keys: ["NOTE0001"], policy: "kept" },
          tags: { union: ["AI4S:Import"], policy: "unioned" },
          collections: { union: ["334VW86H"], policy: "unioned" },
          relations: { existing: [], dc_replaces_after_merge: ["SMOKE002"], policy: "recorded" },
        },
        trash: { keys: ["SMOKE002"], destination: "trash", recoverable: true, permanent_delete: false, policy: "trash only" },
        verification: { keys_checked: 2, version_changes: [], scope_membership: [] },
      },
      {
        cluster_id: "duplicate-0002",
        confidence: "high",
        reasons: ["same-doi"],
        master_key: "OUTSIDE1",
        master_title: "Outside master (中文标题 with unicode)",
        master_version: 5,
        merge_keys: ["SMOKE003"],
        master_outside_scope: true,
        pre_steps: [{
          step: "add_master_to_collection", item_key: "OUTSIDE1", collection_key: "334VW86H",
          already_satisfied: false, reason: "The master is outside the batch collection.",
        }],
        item_versions: [{ key: "OUTSIDE1", version: 5 }, { key: "SMOKE003", version: 2 }],
        keep: {
          attachments: { keys: [], policy: "kept" }, notes: { keys: [], policy: "kept" },
          tags: { union: [], policy: "unioned" }, collections: { union: ["334VW86H"], policy: "unioned" },
          relations: { existing: [], dc_replaces_after_merge: ["SMOKE003"], policy: "recorded" },
        },
        trash: { keys: ["SMOKE003"], destination: "trash", recoverable: true, permanent_delete: false, policy: "trash only" },
        verification: { keys_checked: 2, version_changes: [], scope_membership: [] },
      },
    ],
  };
  plan.plan_hash = module().canonicalPlanHash(plan);
  return plan;
}

/** Fake Zotero item with merge-relevant spies. */
function fakeItem(key) {
  const item = {
    key,
    addedTo: [],
    saved: 0,
    addToCollection(collectionKey) { item.addedTo.push(collectionKey); },
    async saveTx() { item.saved += 1; },
  };
  return item;
}

/** deps for execute(): mocked item lookup, native merge, and confirmation. */
function fakeDeps(plan, { agrees = true } = {}) {
  const items = new Map();
  for (const key of ["SMOKE001", "SMOKE002", "SMOKE003", "OUTSIDE1"]) items.set(key, fakeItem(key));
  const merges = [];
  const confirms = [];
  const progress = [];
  return {
    items,
    merges,
    confirms,
    progress,
    deps: {
      items: (library, key) => {
        assert.deepEqual(library, { type: "user", id: 12345 });
        const item = items.get(key);
        if (!item) throw new Error("Item " + key + " is not present in this Zotero library.");
        return item;
      },
      mergeItems: async (master, others) => { merges.push([master.key, others.map((other) => other.key)]); },
      confirm: async (title, text) => { confirms.push({ title, text }); return agrees; },
      expectedPlanHash: plan.plan_hash,
      existing: null,
      onProgress: async (clusters) => { progress.push(clusters.map((entry) => ({ ...entry }))); },
    },
  };
}

test("loadSubScript-style loading keeps the native-merge export on the scope, not globalThis", () => {
  const scope = {};
  const otherGlobal = loadSubScriptLike(source("src/native-merge.js"), scope);
  assert.ok(scope.LiteratureNativeMerge, "the export must land on the loadSubScript scope");
  assert.equal(otherGlobal.LiteratureNativeMerge, undefined, "an accidental globalThis export must fail this test");
  assert.equal(typeof scope.LiteratureNativeMerge.execute, "function");
});

test("the plugin sha256 hashes raw text exactly like node:crypto, including unicode and repeated spaces", () => {
  const native = module();
  for (const text of ["", "ping", "a  b   c", "标题 with 中文", JSON.stringify({ a: 1, b: [2, 3] })]) {
    assert.equal(native.sha256Hex(text), createHash("sha256").update(text, "utf8").digest("hex"));
  }
});

test("canonicalPlanHash byte-matches the runtime algorithm on a full plan", () => {
  const plan = planFixture();
  assert.equal(module().canonicalPlanHash(plan), nodeCanonicalHash(plan));
  assert.match(plan.plan_hash, /^sha256:[a-f0-9]{64}$/);
});

test("validatePlan accepts the fixture and refuses every unsafe variant", () => {
  const native = module();
  native.validatePlan(planFixture());

  const wrongCollection = planFixture();
  wrongCollection.batch_selector = { collection_key: "PLANCOL1" };
  wrongCollection.plan_hash = native.canonicalPlanHash(wrongCollection);
  assert.throws(() => native.validatePlan(wrongCollection), /only allowed for the test collection/);

  const tagBatch = planFixture();
  tagBatch.batch_selector = { tag: "AI4S:Import" };
  tagBatch.plan_hash = native.canonicalPlanHash(tagBatch);
  assert.throws(() => native.validatePlan(tagBatch), /only allowed for the test collection/);

  const tampered = planFixture();
  tampered.clusters[0].merge_keys = ["SOMEONE1"];
  assert.throws(() => native.validatePlan(tampered), /hash mismatch/);

  const permanent = planFixture();
  permanent.policy.permanent_delete = true;
  permanent.plan_hash = native.canonicalPlanHash(permanent);
  assert.throws(() => native.validatePlan(permanent), /trash-only, recoverable, non-permanent/);

  const otherCollectionPreStep = planFixture();
  otherCollectionPreStep.clusters[1].pre_steps[0].collection_key = "PLANCOL1";
  otherCollectionPreStep.plan_hash = native.canonicalPlanHash(otherCollectionPreStep);
  assert.throws(() => native.validatePlan(otherCollectionPreStep), /unsupported pre-step/);

  const badMaster = planFixture();
  badMaster.clusters[0].master_key = "not-a-key";
  badMaster.plan_hash = native.canonicalPlanHash(badMaster);
  assert.throws(() => native.validatePlan(badMaster), /invalid master_key/i);

  const masterInMergeKeys = planFixture();
  masterInMergeKeys.clusters[0].merge_keys = ["SMOKE001", "SMOKE002"];
  masterInMergeKeys.plan_hash = native.canonicalPlanHash(masterInMergeKeys);
  assert.throws(() => native.validatePlan(masterInMergeKeys), /invalid merge_keys/i);

  const foreignPlanType = planFixture();
  foreignPlanType.plan_type = "something-else";
  assert.throws(() => native.validatePlan(foreignPlanType), /not a zotero-dedupe-plan/);
});

test("confirmText lists every cluster's master, merge-ins, and the add-to-collection step", () => {
  const native = module();
  const plan = planFixture();
  const text = native.confirmText(plan, new Map());
  assert.match(text, /2 duplicate cluster/);
  assert.match(text, /AI4S-smoke-sync-20261126 \(334VW86H\)/);
  assert.match(text, /keep master SMOKE001/);
  assert.match(text, /merge in SMOKE002/);
  assert.match(text, /add the master to the collection first/);
  assert.match(text, /OUTSIDE1/);
  assert.match(text, /move to the trash/);
  const resumed = native.confirmText(plan, new Map([["duplicate-0001", { status: "success" }]]));
  assert.match(resumed, /duplicate-0001 \(already merged in an earlier run: skipped\)/);
});

test("execute merges each cluster with Zotero.Items.merge args and reports per-cluster results", async () => {
  const native = module();
  const plan = planFixture();
  const fake = fakeDeps(plan);
  const receipt = await native.execute(plan, fake.deps);
  assert.equal(receipt.status, "completed");
  assert.equal(fake.confirms.length, 1);
  assert.equal(fake.confirms[0].title, native.CONFIRM_TITLE);
  jsonEqual(fake.merges, [["SMOKE001", ["SMOKE002"]], ["OUTSIDE1", ["SMOKE003"]]]);
  assert.equal(fake.items.get("OUTSIDE1").addedTo.join(","), "334VW86H", "only the guard collection is ever added");
  assert.equal(fake.items.get("OUTSIDE1").saved, 1);
  assert.equal(fake.items.get("SMOKE001").addedTo.length, 0, "in-scope masters are not re-added");
  jsonEqual(receipt.clusters, [
    { cluster_id: "duplicate-0001", status: "success", master_key: "SMOKE001", merged_keys: ["SMOKE002"], added_to_collection: false },
    { cluster_id: "duplicate-0002", status: "success", master_key: "OUTSIDE1", merged_keys: ["SMOKE003"], added_to_collection: true },
  ]);
  // Progress receipts grow one cluster at a time for crash-safe re-entry.
  assert.equal(fake.progress.length, 2);
  jsonEqual(fake.progress[0].map((entry) => entry.status), ["success"]);
  jsonEqual(fake.progress[1].map((entry) => entry.status), ["success", "success"]);
});

test("canceling the dialog makes zero Zotero writes and reports rejected", async () => {
  const native = module();
  const plan = planFixture();
  const fake = fakeDeps(plan, { agrees: false });
  const receipt = await native.execute(plan, fake.deps);
  assert.equal(receipt.status, "rejected");
  assert.match(receipt.error, /declined/);
  jsonEqual(receipt.clusters, []);
  assert.equal(fake.merges.length, 0, "cancel must not call Zotero.Items.merge");
  for (const item of fake.items.values()) {
    assert.equal(item.addedTo.length, 0, "cancel must not add any master to the collection");
    assert.equal(item.saved, 0, "cancel must not save any item");
  }
});

test("an already-completed cluster from a prior receipt is skipped, not re-merged", async () => {
  const native = module();
  const plan = planFixture();
  const fake = fakeDeps(plan);
  fake.deps.existing = {
    status: "accepted",
    clusters: [
      { cluster_id: "duplicate-0001", status: "success", master_key: "SMOKE001", merged_keys: ["SMOKE002"], added_to_collection: false },
    ],
  };
  const receipt = await native.execute(plan, fake.deps);
  assert.equal(receipt.status, "completed");
  jsonEqual(fake.merges, [["OUTSIDE1", ["SMOKE003"]]], "only the unfinished cluster runs");
  jsonEqual(receipt.clusters[0], {
    cluster_id: "duplicate-0001", status: "skipped", master_key: "SMOKE001",
    merged_keys: ["SMOKE002"], added_to_collection: false,
  });
  assert.equal(receipt.clusters[1].status, "success");
  // A skipped entry in a resumed receipt also counts as completed for the next resume.
  const resume = await native.execute(plan, { ...fake.deps, existing: { status: "accepted", clusters: receipt.clusters } });
  jsonEqual(fake.merges, [["OUTSIDE1", ["SMOKE003"]]], "nothing is merged a second time");
  assert.equal(resume.status, "completed");
});

test("declining a resumed job still records the clusters completed earlier as skipped", async () => {
  const native = module();
  const plan = planFixture();
  const fake = fakeDeps(plan, { agrees: false });
  fake.deps.existing = {
    status: "accepted",
    clusters: [
      { cluster_id: "duplicate-0001", status: "success", master_key: "SMOKE001", merged_keys: ["SMOKE002"], added_to_collection: false },
    ],
  };
  const receipt = await native.execute(plan, fake.deps);
  assert.equal(receipt.status, "rejected");
  assert.equal(fake.merges.length, 0);
  assert.equal(receipt.clusters[0].status, "skipped");
});

test("a job whose approved plan hash differs from the plan file is refused before any dialog", async () => {
  const native = module();
  const plan = planFixture();
  const fake = fakeDeps(plan);
  fake.deps.expectedPlanHash = "sha256:" + "0".repeat(64);
  const receipt = await native.execute(plan, fake.deps);
  assert.equal(receipt.status, "rejected", "a hash mismatch is a refusal, not an attempted failure");
  assert.match(receipt.error, /does not match the plan file/);
  assert.equal(fake.confirms.length, 0);
  assert.equal(fake.merges.length, 0);
  jsonEqual(receipt.clusters, []);
});

test("one failing cluster does not stop the others and the receipt reports the failure", async () => {
  const native = module();
  const plan = planFixture();
  const fake = fakeDeps(plan);
  fake.deps.items = (library, key) => {
    if (key === "SMOKE003") throw new Error("Item SMOKE003 is not present in this Zotero library.");
    return fake.items.get(key);
  };
  const receipt = await native.execute(plan, fake.deps);
  assert.equal(receipt.status, "failed");
  assert.match(receipt.error, /1 of 2 cluster\(s\) failed/);
  jsonEqual(fake.merges, [["SMOKE001", ["SMOKE002"]]], "the healthy cluster still merged");
  assert.equal(receipt.clusters[0].status, "success");
  assert.equal(receipt.clusters[1].status, "failed");
  assert.match(receipt.clusters[1].error, /SMOKE003/);
});

test("createDesktop resolves items by library and calls the real Zotero merge API shape", async () => {
  const native = module();
  const items = new Map([
    ["SMOKE001", fakeItem("SMOKE001")],
    ["SMOKE002", fakeItem("SMOKE002")],
  ]);
  const planOneCluster = planFixture();
  planOneCluster.clusters = [planOneCluster.clusters[0]];
  planOneCluster.cluster_count = 1;
  planOneCluster.plan_hash = native.canonicalPlanHash(planOneCluster);
  const merges = [];
  const Zotero = {
    Libraries: { userLibraryID: 1 },
    Groups: { get: (id) => ({ libraryID: id + 1000 }) },
    Items: {
      getByLibraryAndKey: (libraryID, key) => (libraryID === 1 ? items.get(key) : null),
      merge: async (master, others) => { merges.push([master, others]); },
    },
  };
  const executor = native.createDesktop({ Zotero, log: () => {} });
  const confirmCalls = [];
  const receipt = await executor.execute(planOneCluster, {
    confirm: async (_title, text) => { confirmCalls.push(text); return true; },
    expectedPlanHash: planOneCluster.plan_hash,
    existing: null,
  });
  assert.equal(receipt.status, "completed");
  assert.equal(merges.length, 1);
  assert.equal(merges[0][0], items.get("SMOKE001"), "Zotero.Items.merge(master, others) gets the master item first");
  jsonEqual(merges[0][1].map((other) => other.key), ["SMOKE002"]);
  assert.equal(confirmCalls.length, 1);
  assert.match(confirmCalls[0], /keep master SMOKE001/);
});

test("createDesktop refuses a group library that is not open", async () => {
  const native = module();
  const plan = planFixture();
  plan.library = { type: "group", id: 99 };
  plan.plan_hash = native.canonicalPlanHash(plan);
  const Zotero = {
    Libraries: { userLibraryID: 1 },
    Groups: { get: () => null },
    Items: { getByLibraryAndKey: () => null, merge: async () => {} },
  };
  const executor = native.createDesktop({ Zotero, log: () => {} });
  const receipt = await executor.execute(plan, { confirm: async () => true, expectedPlanHash: plan.plan_hash, existing: null });
  assert.equal(receipt.status, "failed", "an unavailable library fails every cluster instead of crashing");
  assert.match(receipt.clusters[0].error, /Group library 99 is not open/);
});
