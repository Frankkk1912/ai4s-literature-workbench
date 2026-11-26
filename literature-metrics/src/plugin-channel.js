// "var" so Services.scriptloader.loadSubScript attaches the export to the
// caller's scope; assigning to globalThis would miss the scope and crash startup.
// eslint-disable-next-line no-unused-vars -- this var IS the module export
var LiteraturePluginChannel = (function () {
  "use strict";
  const ID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
  // Channel job files are `<uuid>.(job|ack|claim|result).json` only. Gecko's
  // nsIUUIDGenerator.toString() returns "{XXXXXXXX-XXXX-...}" (braces, often
  // uppercase), which is not a safe filename — normalize before writing.
  function jobIdFromGenerator(raw) {
    const id = String(raw == null ? "" : raw).replace(/[{}]/g, "").toLowerCase();
    if (!ID.test(id)) throw new Error("Unsafe channel job id.");
    return id;
  }
  const HASH = /^[a-f0-9]{64}$/;
  const PLAN_HASH = /^sha256:[a-f0-9]{64}$/;
  const ZOTERO_KEY = /^[A-Z0-9]{8}$/;
  // Channel files stay small: a receipt may carry per-cluster merge results, nothing more.
  const MAX_CHANNEL_FILE_BYTES = 32768;
  const CREATED_AT = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/;
  // A dedupe plan must stay readable and small: it is the merge worklist, not a dump.
  const MAX_PLAN_FILE_BYTES = 1048576;

  // Pinned metrics-backfill request payload: exactly one of a collection key or
  // selected item keys. No secrets, no Extra blobs, no local API versions, no
  // mode: requests are preview-only; apply always goes through the MCP tool.
  function validBackfillPayload(payload) {
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) return false;
    const keys = Object.keys(payload);
    if (keys.length !== 1) return false;
    if (keys[0] === "collection_key") return ZOTERO_KEY.test(payload.collection_key);
    if (keys[0] === "item_keys") {
      return Array.isArray(payload.item_keys) && payload.item_keys.length > 0 && payload.item_keys.length <= 100
        && payload.item_keys.every((key) => ZOTERO_KEY.test(key));
    }
    return false;
  }

  function planHash(job) {
    // Prefer LiteratureNativeMerge.sha256Hex when native-merge.js loaded into this
    // loadSubScript scope; fall back to the same-scope LiteratureAiSummaries.sha256
    // (byte-identical) so ping and metrics-backfill still work if native-merge failed
    // to start. Never use globalThis.
    const digest = (typeof LiteratureNativeMerge !== "undefined" && LiteratureNativeMerge
      && typeof LiteratureNativeMerge.sha256Hex === "function")
      ? LiteratureNativeMerge.sha256Hex
      : LiteratureAiSummaries.sha256;
    return digest(JSON.stringify([
      job.schema_version, job.job_id, job.job_type, job.created_at, job.payload,
    ]));
  }

  // MCP-to-plugin jobs use a tight allowlist: ping stays empty, and native-merge
  // only names a plan file, its hash, and the batch collection key. Plugin-authored
  // metrics-backfill requests are not in this allowlist; the ping loop skips them.
  function valid(job, id) {
    if (!job || Object.keys(job).sort().join(",") !== "created_at,job_id,job_type,payload,plan_hash,schema_version"
      || job.schema_version !== 1 || job.job_id !== id
      || (job.job_type !== "ping" && job.job_type !== "native-merge")
      || typeof job.created_at !== "string" || !CREATED_AT.test(job.created_at)
      || !Number.isFinite(Date.parse(job.created_at)) || !job.payload || typeof job.payload !== "object"
      || Array.isArray(job.payload) || !HASH.test(job.plan_hash) || planHash(job) !== job.plan_hash) return false;
    if (job.job_type === "ping") return Object.keys(job.payload).length === 0;
    const payload = job.payload;
    return Object.keys(payload).sort().join(",") === "collection_key,plan_hash,plan_path"
      && typeof payload.plan_path === "string" && payload.plan_path.length > 0 && payload.plan_path.length <= 512
      && !payload.plan_path.includes("\0")
      && PLAN_HASH.test(payload.plan_hash) && ZOTERO_KEY.test(payload.collection_key);
  }

  // Real symlinks must always be refused, but the real-Gecko pitfall where
  // nsIFile.initWithPath/isSymlink throw on a path that does not exist must not:
  // a missing path is not a symlink, and IOUtils will create or report it safely.
  function refuseSymlink(Components, target) {
    try {
      const file = Components.classes["@mozilla.org/file/local;1"].createInstance(Components.interfaces.nsIFile);
      file.initWithPath(target);
      if (file.isSymlink()) throw new Error("Unsafe channel symlink.");
    }
    catch (error) {
      if (error instanceof Error && /symlink/i.test(error.message)) throw error;
    }
  }

  function create({ files, confirm, merge, schedule, cancel, log, now = () => new Date().toISOString(), uuid = () => crypto.randomUUID() }) {
    let running = false;
    let timer = null;
    let scanning = null;
    const claims = new Set();
    // Run one native-merge job through the executor. Any setup/validation throw
    // becomes a failed receipt that still records the clusters already merged
    // (the last accepted progress receipt), so a retry never re-merges them.
    async function runNativeMerge(job, id, ackName, existing) {
      if (!merge) return { status: "rejected", error: "Native merge is not available in this channel build.", clusters: [] };
      try {
        const plan = await files.readPlan(job.payload.plan_path);
        const result = await merge.execute(plan, {
          existing,
          expectedPlanHash: job.payload.plan_hash,
          confirm,
          log,
          onProgress: async (clusters) => {
            if (!running) return;
            await files.write(ackName, { job_id: id, plan_hash: job.plan_hash, status: "accepted", finished_at: now(), clusters });
          },
        });
        return { status: result.status, error: result.error, clusters: result.clusters && result.clusters.length ? result.clusters : [] };
      }
      catch (error) {
        const preserved = await files.read(ackName).catch(() => null);
        const clusters = preserved && preserved.status === "accepted" && Array.isArray(preserved.clusters)
          ? preserved.clusters : [];
        return { status: "failed", error: (error && error.message) || String(error), clusters };
      }
    }
    async function scanOnce() {
      await files.write("presence.json", { schema_version: 1, updated_at: now() });
      for (const name of await files.list()) {
        if (!running) break;
        if (!name.endsWith(".job.json")) continue;
        const id = name.slice(0, -9);
        if (!ID.test(id)) continue;
        try {
          const job = await files.read(name);
          if (!running) break;
          if (!job || job.job_id !== id || !HASH.test(job.plan_hash)) continue;
          // metrics-backfill requests are authored by the plugin itself and consumed
          // by the workbench runtime; this ping loop must never claim, confirm, or
          // reject them. A matching result file is their only reply channel.
          if (job.job_type === "metrics-backfill") continue;
          const ackName = `${id}.ack.json`;
          const existing = await files.read(ackName);
          if (!running) break;
          // Never overwrite an existing mismatched receipt or replay a terminal job.
          if (existing && (existing.job_id !== id || existing.plan_hash !== job.plan_hash
            || existing.status !== "accepted")) continue;
          let status = "rejected";
          let error = "Invalid channel job or plan_hash mismatch.";
          let clusters = null;
          const claimName = `${id}.claim.json`;
          const needsClaim = valid(job, id);
          if (needsClaim) {
            // Claim the job before the modal dialog blocks Zotero's event loop (which also
            // pauses this heartbeat); the runtime helper then treats it as alive while the
            // user decides, instead of failing on a stale presence file.
            claims.add(claimName);
            await files.write(claimName, { schema_version: 1, job_id: id, plan_hash: job.plan_hash, claimed_at: now() });
            if (job.job_type === "ping") {
              const agreed = await confirm("Workbench connectivity test", "This is a connectivity test and will not change items. Allow this ping?");
              if (!running) break;
              status = agreed ? "completed" : "rejected";
              error = agreed ? undefined : "User declined connectivity test.";
            }
            else {
              const result = await runNativeMerge(job, id, ackName, existing);
              if (!running) break;
              status = result.status;
              error = result.error;
              clusters = result.clusters && result.clusters.length ? result.clusters : null;
            }
          }
          if (!running) break;
          await files.write(ackName, { job_id: id, plan_hash: job.plan_hash, status, finished_at: now(),
            ...(error ? { error } : {}), ...(clusters ? { clusters } : {}) });
          if (needsClaim) {
            claims.delete(claimName);
            await files.remove(claimName);
          }
        }
        catch { log("Could not process a workbench job file."); }
      }
    }
    function scan() {
      if (!running) return Promise.resolve();
      if (scanning) return scanning;
      scanning = scanOnce().catch(() => log("Could not scan workbench jobs directory.")).finally(() => { scanning = null; });
      return scanning;
    }
    // Plugin-authored preview request: the workbench runtime consumes it with
    // zotero_backfill_metrics (always dry_run) and answers with a result file.
    async function submitMetricsBackfillJob(payload) {
      if (!running) throw new Error("Jobs channel is not running.");
      if (!validBackfillPayload(payload)) throw new Error("Invalid metrics-backfill request payload.");
      const job = {
        schema_version: 1,
        job_id: jobIdFromGenerator(uuid()),
        job_type: "metrics-backfill",
        created_at: now(),
        payload,
      };
      job.plan_hash = planHash(job);
      await files.write(`${job.job_id}.job.json`, job);
      return job;
    }
    async function readMetricsBackfillResult(jobId) {
      if (!ID.test(jobId)) throw new Error("Unsafe metrics-backfill job id.");
      const result = await files.read(`${jobId}.result.json`);
      return result && result.job_id === jobId ? result : null;
    }
    async function discardMetricsBackfillJob(jobId) {
      if (!ID.test(jobId)) throw new Error("Unsafe metrics-backfill job id.");
      await files.remove(`${jobId}.job.json`);
      await files.remove(`${jobId}.result.json`);
    }
    async function start() {
      if (running) return;
      await files.initialize();
      running = true;
      await scan();
      if (running) timer = schedule(scan, 2000);
    }
    async function stop() {
      running = false;
      if (timer !== null) cancel(timer);
      timer = null;
      if (scanning) await scanning;
      for (const name of claims) {
        try { await files.remove(name); }
        catch { log("Could not remove a workbench claim file."); }
      }
      claims.clear();
      await files.remove("presence.json");
    }
    return Object.freeze({ start, stop, scan, submitMetricsBackfillJob, readMetricsBackfillResult, discardMetricsBackfillJob });
  }

  function createDesktop({ Zotero, Services, Components, IOUtils, PathUtils, schedule, cancel }) {
    const env = (key) => Services.env.get(key);
    const home = Services.dirsvc.get("Home", Components.interfaces.nsIFile).path;
    // Match runtime defaultDataDir precedence (LITERATURE_ZOTERO_MCP_DATA_DIR first);
    // never use the Zotero profile.
    let defaultDir;
    if (Zotero.isWin) defaultDir = PathUtils.join(env("APPDATA").trim() || PathUtils.join(home, "AppData", "Roaming"), "literature-zotero-mcp");
    else if (Zotero.isMac) defaultDir = PathUtils.join(home, "Library", "Application Support", "literature-zotero-mcp");
    else defaultDir = PathUtils.join(env("XDG_DATA_HOME") || PathUtils.join(home, ".local", "share"), "literature-zotero-mcp");
    const dataDir = env("LITERATURE_ZOTERO_MCP_DATA_DIR") || env("ZOTEUS_DATA_DIR") || defaultDir;
    const root = PathUtils.join(dataDir, "plugin-jobs");
    const path = (name) => {
      if (name !== "presence.json" && !/^[a-f0-9-]{36}\.(job|ack|claim|result)\.json$/.test(name)) throw new Error("Unsafe channel filename.");
      return PathUtils.join(root, name);
    };
    async function directory() {
      refuseSymlink(Components, root);
      if ((await IOUtils.stat(root)).type !== "directory") throw new Error("Unsafe jobs directory.");
    }
    const files = {
      async initialize() {
        await IOUtils.makeDirectory(root, { createAncestors: true, permissions: 0o700 });
        await directory();
      },
      async list() { await directory(); return (await IOUtils.getChildren(root)).map((entry) => PathUtils.filename(entry)); },
      async read(name) {
        await directory();
        const target = path(name);
        if (!await IOUtils.exists(target)) return null;
        refuseSymlink(Components, target);
        const info = await IOUtils.stat(target);
        if (info.type !== "regular" || info.size > MAX_CHANNEL_FILE_BYTES) throw new Error("Unsafe channel file.");
        return IOUtils.readJSON(target);
      },
      // A native-merge job names a dedupe plan saved by the MCP runtime. Only a
      // plan directly inside <dataDir>/dedupe-plans, with a plain .json filename,
      // is ever read — never an arbitrary path, symlink, or oversized file.
      async readPlan(planPath) {
        if (typeof planPath !== "string" || !planPath) throw new Error("Unsafe dedupe plan path.");
        const normalized = PathUtils.normalize(planPath);
        const plansRoot = PathUtils.normalize(PathUtils.join(dataDir, "dedupe-plans"));
        if (PathUtils.parent(normalized) !== plansRoot
          || !/^[A-Za-z0-9._-]+\.json$/.test(PathUtils.filename(normalized))) {
          throw new Error("Unsafe dedupe plan path: plans must live directly in " + plansRoot + ".");
        }
        refuseSymlink(Components, normalized);
        if (!await IOUtils.exists(normalized)) throw new Error("Dedupe plan not found: " + normalized + ".");
        const info = await IOUtils.stat(normalized);
        if (info.type !== "regular" || info.size > MAX_PLAN_FILE_BYTES) throw new Error("Unsafe dedupe plan file.");
        return IOUtils.readJSON(normalized);
      },
      async write(name, value) {
        await directory();
        const target = path(name);
        // A unique temp file prevents following a pre-planted .tmp symlink.
        const temporary = `${target}.${Services.uuid.generateUUID().toString()}.tmp`;
        await IOUtils.writeJSON(temporary, value, { mode: "create" });
        await IOUtils.setPermissions(temporary, 0o600);
        await IOUtils.move(temporary, target);
      },
      async remove(name) { await directory(); await IOUtils.remove(path(name), { ignoreAbsent: true }); },
    };
    return create({ files, schedule, cancel,
      confirm: (title, text) => Services.prompt.confirm(Zotero.getMainWindow(), title, text),
      uuid: () => jobIdFromGenerator(Services.uuid.generateUUID().toString()),
      log: (message) => Zotero.logError(message),
      // Same-scope binding when native-merge.js loaded successfully; otherwise
      // native-merge jobs are rejected and ping / metrics-backfill still run.
      merge: (typeof LiteratureNativeMerge !== "undefined" && LiteratureNativeMerge
        && typeof LiteratureNativeMerge.createDesktop === "function")
        ? LiteratureNativeMerge.createDesktop({ Zotero, log: (message) => Zotero.logError(message) })
        : null,
    });
  }
  return Object.freeze({ create, createDesktop, planHash });
})();
