/*
 * Native Zotero merge executor for order-09 workbench jobs.
 *
 * Safety rules enforced here, independent of the MCP runtime (defense in depth):
 * - Only the smoke-test collection AI4S-smoke-sync-20261126 (334VW86H) may ever
 *   be touched by a merge; any other batch collection or tag is refused.
 * - Merging always goes through Zotero.Items.merge (native merge), which moves
 *   merged-away items to the trash (recoverable) and records dc:replaces. This
 *   module never trashes or deletes items itself and never calls erase()/delete().
 * - The plan file's canonical sha256 is re-verified before anything is shown or
 *   written; a tampered or stale plan is rejected without any dialog.
 *
 * "var" so Services.scriptloader.loadSubScript attaches the export to the
 * caller's scope; assigning to globalThis would miss the scope and crash startup.
 */
// eslint-disable-next-line no-unused-vars -- this var IS the module export
var LiteratureNativeMerge = (function () {
  "use strict";

  const COLLECTION_KEY = "334VW86H";
  const COLLECTION_NAME = "AI4S-smoke-sync-20261126";
  const ZOTERO_KEY = /^[A-Z0-9]{8}$/;
  const CONFIRM_TITLE = "Zotero native merge (workbench)";

  // Self-contained SHA-256 over the raw string: unlike LiteratureAiSummaries.sha256
  // (which normalizes whitespace for evidence text), the dedupe-plan hash must byte-match
  // the Node runtime's createHash("sha256") over the exact canonical JSON.
  const K = [
    0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
    0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
    0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
    0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
    0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
    0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
    0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,
    0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2,
  ];

  function utf8Bytes(value) {
    const bytes = [];
    for (const character of value) {
      const code = character.codePointAt(0);
      if (code < 0x80) bytes.push(code);
      else if (code < 0x800) bytes.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
      else if (code < 0x10000) bytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
      else bytes.push(0xf0 | (code >> 18), 0x80 | ((code >> 12) & 0x3f), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
    }
    return bytes;
  }

  function rotateRight(value, bits) { return (value >>> bits) | (value << (32 - bits)); }

  function sha256Hex(value) {
    const bytes = utf8Bytes(String(value));
    const bitLength = bytes.length * 8;
    bytes.push(0x80);
    while ((bytes.length % 64) !== 56) bytes.push(0);
    const high = Math.floor(bitLength / 0x100000000);
    const low = bitLength >>> 0;
    for (let shift = 24; shift >= 0; shift -= 8) bytes.push((high >>> shift) & 0xff);
    for (let shift = 24; shift >= 0; shift -= 8) bytes.push((low >>> shift) & 0xff);
    const hash = [0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19];
    const words = new Array(64);
    for (let offset = 0; offset < bytes.length; offset += 64) {
      for (let index = 0; index < 16; index += 1) {
        const cursor = offset + index * 4;
        words[index] = ((bytes[cursor] << 24) | (bytes[cursor + 1] << 16) | (bytes[cursor + 2] << 8) | bytes[cursor + 3]) >>> 0;
      }
      for (let index = 16; index < 64; index += 1) {
        const s0 = rotateRight(words[index - 15], 7) ^ rotateRight(words[index - 15], 18) ^ (words[index - 15] >>> 3);
        const s1 = rotateRight(words[index - 2], 17) ^ rotateRight(words[index - 2], 19) ^ (words[index - 2] >>> 10);
        words[index] = (words[index - 16] + s0 + words[index - 7] + s1) >>> 0;
      }
      let [a,b,c,d,e,f,g,h] = hash;
      for (let index = 0; index < 64; index += 1) {
        const s1 = rotateRight(e, 6) ^ rotateRight(e, 11) ^ rotateRight(e, 25);
        const choice = (e & f) ^ (~e & g);
        const temp1 = (h + s1 + choice + K[index] + words[index]) >>> 0;
        const s0 = rotateRight(a, 2) ^ rotateRight(a, 13) ^ rotateRight(a, 22);
        const majority = (a & b) ^ (a & c) ^ (b & c);
        const temp2 = (s0 + majority) >>> 0;
        h = g; g = f; f = e; e = (d + temp1) >>> 0;
        d = c; c = b; b = a; a = (temp1 + temp2) >>> 0;
      }
      const next = [a,b,c,d,e,f,g,h];
      for (let index = 0; index < 8; index += 1) hash[index] = (hash[index] + next[index]) >>> 0;
    }
    return hash.map((word) => word.toString(16).padStart(8, "0")).join("");
  }

  // Recursively sort object keys so the canonical hash is independent of field
  // order, matching runtime/src/features/duplicates/plan.ts deepSort exactly.
  function deepSort(value) {
    if (Array.isArray(value)) return value.map(deepSort);
    if (value && typeof value === "object") {
      const sorted = {};
      for (const key of Object.keys(value).sort()) sorted[key] = deepSort(value[key]);
      return sorted;
    }
    return value;
  }

  /**
   * The plan hash covers everything the merge would do and the library state it
   * was planned against, but not volatile bookkeeping fields (plan_id,
   * created_at, source paths) — the same canonical hash as the MCP runtime.
   */
  function canonicalPlanHash(plan) {
    const payload = {
      schema_version: plan.schema_version,
      plan_type: plan.plan_type,
      library: plan.library,
      batch_selector: plan.batch_selector,
      policy: plan.policy,
      clusters: [...plan.clusters].sort((a, b) => String(a.cluster_id).localeCompare(String(b.cluster_id))),
    };
    return "sha256:" + sha256Hex(JSON.stringify(deepSort(payload)));
  }

  function refuse(message) {
    throw new Error(message);
  }

  /**
   * Validate a dedupe plan before anything is shown or written. Throws on any
   * violation; the channel turns the message into a rejected receipt.
   */
  function validatePlan(plan) {
    if (!plan || typeof plan !== "object" || Array.isArray(plan))
      refuse("Refusing merge: the plan file is not a dedupe plan object.");
    if (plan.plan_type !== "zotero-dedupe-plan")
      refuse("Refusing merge: the plan file is not a zotero-dedupe-plan.");
    if (plan.schema_version !== "1.0.0")
      refuse("Refusing merge: unsupported dedupe plan schema_version " + JSON.stringify(plan.schema_version) + ".");
    const collectionKey = plan.batch_selector && plan.batch_selector.collection_key;
    if (String(collectionKey) !== COLLECTION_KEY)
      refuse("Refusing merge: this plan's batch collection is " + JSON.stringify(collectionKey === undefined ? null : collectionKey)
        + ". Native merge is only allowed for the test collection " + COLLECTION_NAME + " (" + COLLECTION_KEY + "), never the working library.");
    const policy = plan.policy || {};
    if (policy.merged_items_destination !== "trash" || policy.recoverable !== true || policy.permanent_delete !== false)
      refuse("Refusing merge: the plan policy does not guarantee trash-only, recoverable, non-permanent handling.");
    if (!Array.isArray(plan.clusters))
      refuse("Refusing merge: the plan has no clusters array.");
    for (const cluster of plan.clusters) {
      if (!cluster || typeof cluster !== "object") refuse("Refusing merge: invalid cluster entry.");
      if (typeof cluster.cluster_id !== "string" || !cluster.cluster_id)
        refuse("Refusing merge: invalid cluster_id in a cluster.");
      if (!ZOTERO_KEY.test(String(cluster.master_key)))
        refuse("Refusing merge: invalid master_key in cluster " + cluster.cluster_id + ".");
      if (!Array.isArray(cluster.merge_keys) || cluster.merge_keys.length === 0
        || cluster.merge_keys.some((key) => !ZOTERO_KEY.test(String(key)))
        || new Set(cluster.merge_keys.map(String)).size !== cluster.merge_keys.length
        || cluster.merge_keys.map(String).includes(String(cluster.master_key)))
        refuse("Refusing merge: invalid merge_keys in cluster " + cluster.cluster_id + ".");
      for (const step of Array.isArray(cluster.pre_steps) ? cluster.pre_steps : []) {
        if (!step || step.step !== "add_master_to_collection"
          || String(step.collection_key) !== COLLECTION_KEY
          || String(step.item_key) !== String(cluster.master_key))
          refuse("Refusing merge: cluster " + cluster.cluster_id + " has an unsupported pre-step. Only adding the master to the test collection "
            + COLLECTION_NAME + " (" + COLLECTION_KEY + ") is allowed.");
      }
    }
    if (canonicalPlanHash(plan) !== String(plan.plan_hash))
      refuse("Dedupe plan hash mismatch: the plan file was modified or is not the approved plan. Re-run the dry-run to regenerate the plan.");
  }

  function truncate(value, length) {
    const text = String(value ?? "");
    return text.length <= length ? text : text.slice(0, length - 1) + "…";
  }

  /** The confirmation-dialog text: every cluster's master, merge-ins, and pre-steps. */
  function confirmText(plan, completed) {
    const lines = [
      "Merge " + plan.clusters.length + " duplicate cluster(s) in the test collection "
        + COLLECTION_NAME + " (" + COLLECTION_KEY + ")?",
      "Each cluster keeps its master; the other items are merged into it by Zotero's native merge and move to the trash (recoverable). Attachments, notes, tags, collections, and relations are preserved.",
    ];
    plan.clusters.forEach((cluster, index) => {
      if (completed.has(cluster.cluster_id)) {
        lines.push((index + 1) + ". " + cluster.cluster_id + " (already merged in an earlier run: skipped)");
        return;
      }
      const addToCollection = (Array.isArray(cluster.pre_steps) ? cluster.pre_steps : [])
        .some((step) => step && step.step === "add_master_to_collection");
      lines.push((index + 1) + ". " + cluster.cluster_id + ": keep master " + cluster.master_key
        + " (\"" + truncate(cluster.master_title, 80) + "\")"
        + (addToCollection ? "; add the master to the collection first" : "")
        + "; merge in " + cluster.merge_keys.join(", ") + " (they move to the trash).");
    });
    lines.push("Cancel makes no changes. Allow these native merges?");
    return lines.join("\n");
  }

  // A previously completed entry (success or skipped-from-resume) that a later
  // run must not merge again. Entries without full keys are not trusted.
  function completedClusters(existing) {
    const completed = new Map();
    for (const entry of existing && Array.isArray(existing.clusters) ? existing.clusters : []) {
      if (!entry || typeof entry !== "object") continue;
      if (entry.status !== "success" && entry.status !== "skipped") continue;
      if (typeof entry.cluster_id !== "string" || !entry.cluster_id) continue;
      if (!ZOTERO_KEY.test(String(entry.master_key))) continue;
      if (!Array.isArray(entry.merged_keys)) continue;
      completed.set(entry.cluster_id, entry);
    }
    return completed;
  }

  /**
   * Execute an approved plan. deps:
   * - items(library, key): returns the live Zotero item for a key (throws if absent)
   * - mergeItems(master, others): performs the native Zotero merge
   * - confirm(title, text): the user confirmation; decline means zero Zotero writes
   * - existing: an earlier accepted receipt (re-entrancy) or null
   * - expectedPlanHash: the plan_hash the job's user actually approved
   * - onProgress(clustersSoFar): optional; the channel persists it as an
   *   accepted receipt so a crash never re-merges a completed cluster
   * Returns { status: "completed"|"rejected"|"failed", clusters, error? }.
   */
  async function execute(plan, deps) {
    // Validation refusals happen before the dialog and before any Zotero write,
    // so they are rejections, not failures: no cluster was ever attempted.
    try {
      validatePlan(plan);
      if (String(deps.expectedPlanHash) !== String(plan.plan_hash))
        refuse("Refusing merge: the job's approved plan_hash does not match the plan file's plan_hash.");
    }
    catch (error) {
      return { status: "rejected", error: (error && error.message) || String(error), clusters: [] };
    }
    const completed = completedClusters(deps.existing);
    const agreed = await deps.confirm(CONFIRM_TITLE, confirmText(plan, completed));
    if (!agreed) {
      return {
        status: "rejected",
        error: "User declined the native merge.",
        clusters: [...completed.values()].map((entry) => ({
          cluster_id: entry.cluster_id, status: "skipped", master_key: entry.master_key,
          merged_keys: entry.merged_keys, added_to_collection: Boolean(entry.added_to_collection),
        })),
      };
    }
    const clusters = [];
    for (const cluster of plan.clusters) {
      const prior = completed.get(cluster.cluster_id);
      if (prior) {
        clusters.push({
          cluster_id: cluster.cluster_id, status: "skipped", master_key: prior.master_key,
          merged_keys: prior.merged_keys, added_to_collection: Boolean(prior.added_to_collection),
        });
        continue;
      }
      try {
        const master = deps.items(plan.library, cluster.master_key);
        let addedToCollection = false;
        for (const step of Array.isArray(cluster.pre_steps) ? cluster.pre_steps : []) {
          if (step.already_satisfied === true) continue;
          // validatePlan already pinned step.collection_key to COLLECTION_KEY.
          master.addToCollection(COLLECTION_KEY);
          await master.saveTx();
          addedToCollection = true;
        }
        const others = [];
        for (const key of cluster.merge_keys) others.push(deps.items(plan.library, key));
        await deps.mergeItems(master, others);
        clusters.push({
          cluster_id: cluster.cluster_id, status: "success", master_key: cluster.master_key,
          merged_keys: cluster.merge_keys, added_to_collection: addedToCollection,
        });
      }
      catch (error) {
        clusters.push({
          cluster_id: cluster.cluster_id, status: "failed",
          error: String((error && error.message) || error),
        });
      }
      if (deps.onProgress) await deps.onProgress(clusters.map((entry) => ({ ...entry })));
    }
    const failed = clusters.filter((entry) => entry.status === "failed");
    if (failed.length) {
      return {
        status: "failed",
        error: failed.length + " of " + plan.clusters.length + " cluster(s) failed; see the per-cluster errors. Clusters recorded as success are not re-merged on retry.",
        clusters,
      };
    }
    return { status: "completed", clusters };
  }

  /** Bind the pure executor to a live Zotero: item lookup and native merge. */
  function createDesktop({ Zotero, log }) {
    function libraryID(library) {
      if (!library || (library.type !== "user" && library.type !== "group"))
        throw new Error("The plan library is not a user or group library.");
      if (library.type === "user") return Zotero.Libraries.userLibraryID;
      const group = Zotero.Groups.get(Number(library.id));
      if (!group || typeof group.libraryID !== "number")
        throw new Error("Group library " + library.id + " is not open in this Zotero.");
      return group.libraryID;
    }
    return Object.freeze({
      validatePlan,
      execute: (plan, deps) => execute(plan, {
        confirm: deps.confirm,
        existing: deps.existing,
        expectedPlanHash: deps.expectedPlanHash,
        onProgress: deps.onProgress,
        log,
        items: (library, key) => {
          const item = Zotero.Items.getByLibraryAndKey(libraryID(library), key);
          if (!item) throw new Error("Item " + key + " is not present in this Zotero library.");
          return item;
        },
        mergeItems: (master, others) => Zotero.Items.merge(master, others),
      }),
    });
  }

  return Object.freeze({
    COLLECTION_KEY, COLLECTION_NAME, CONFIRM_TITLE,
    canonicalPlanHash, validatePlan, confirmText, execute, createDesktop, sha256Hex,
  });
})();
