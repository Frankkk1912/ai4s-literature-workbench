// "var" so Services.scriptloader.loadSubScript attaches the export to the
// caller's scope; assigning to globalThis would miss the scope and crash startup.
// eslint-disable-next-line no-unused-vars -- this var IS the module export
var LiteraturePluginChannel = (function () {
  "use strict";
  const ID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
  const HASH = /^[a-f0-9]{64}$/;
  const KEY8 = /^[A-Z0-9]{8}$/;

  // Pinned metrics-backfill request payload: exactly one of a collection key or
  // selected item keys. No secrets, no Extra blobs, no local API versions, no
  // mode: requests are preview-only; apply always goes through the MCP tool.
  function validBackfillPayload(payload) {
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) return false;
    const keys = Object.keys(payload);
    if (keys.length !== 1) return false;
    if (keys[0] === "collection_key") return KEY8.test(payload.collection_key);
    if (keys[0] === "item_keys") {
      return Array.isArray(payload.item_keys) && payload.item_keys.length > 0 && payload.item_keys.length <= 100
        && payload.item_keys.every((key) => KEY8.test(key));
    }
    return false;
  }

  function planHash(job) {
    // Same-scope binding: ai-summaries.js is loaded into the same loadSubScript
    // scope before this file, so the var above is visible without globalThis.
    return LiteratureAiSummaries.sha256(JSON.stringify([
      job.schema_version, job.job_id, job.job_type, job.created_at, job.payload,
    ]));
  }

  // Only the empty ping payload is allowed: no keys, item data, or arbitrary commands.
  function valid(job, id) {
    return job && Object.keys(job).sort().join(",") === "created_at,job_id,job_type,payload,plan_hash,schema_version"
      && job.schema_version === 1 && job.job_id === id && job.job_type === "ping"
      && typeof job.created_at === "string" && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(job.created_at)
      && Number.isFinite(Date.parse(job.created_at)) && job.payload && typeof job.payload === "object"
      && !Array.isArray(job.payload) && Object.keys(job.payload).length === 0
      && HASH.test(job.plan_hash) && planHash(job) === job.plan_hash;
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

  function create({ files, confirm, schedule, cancel, log, now = () => new Date().toISOString(), uuid = () => crypto.randomUUID() }) {
    let running = false;
    let timer = null;
    let scanning = null;
    const claims = new Set();
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
          let error = "Invalid ping job or plan_hash mismatch.";
          const claimName = `${id}.claim.json`;
          const needsClaim = valid(job, id);
          if (needsClaim) {
            // Claim the job before the modal dialog blocks Zotero's event loop (which also
            // pauses this heartbeat); the runtime helper then treats it as alive while the
            // user decides, instead of failing on a stale presence file.
            claims.add(claimName);
            await files.write(claimName, { schema_version: 1, job_id: id, plan_hash: job.plan_hash, claimed_at: now() });
          }
          if (needsClaim) {
            const agreed = await confirm("Workbench connectivity test", "This is a connectivity test and will not change items. Allow this ping?");
            if (!running) break;
            status = agreed ? "completed" : "rejected";
            error = agreed ? undefined : "User declined connectivity test.";
          }
          if (!running) break;
          await files.write(ackName, { job_id: id, plan_hash: job.plan_hash, status, finished_at: now(), ...(error ? { error } : {}) });
          if (needsClaim) {
            claims.delete(claimName);
            await files.remove(claimName);
          }
        }
        catch { log("Could not process a workbench ping file."); }
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
        job_id: uuid(),
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
        if (info.type !== "regular" || info.size > 4096) throw new Error("Unsafe channel file.");
        return IOUtils.readJSON(target);
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
      uuid: () => Services.uuid.generateUUID().toString(),
      log: (message) => Zotero.logError(message),
    });
  }
  return Object.freeze({ create, createDesktop, planHash });
})();
