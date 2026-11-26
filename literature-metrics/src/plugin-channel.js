globalThis.LiteraturePluginChannel = (function () {
  "use strict";
  const ID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
  const HASH = /^[a-f0-9]{64}$/;

  function planHash(job) {
    return globalThis.LiteratureAiSummaries.sha256(JSON.stringify([
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

  function create({ files, confirm, schedule, cancel, log, now = () => new Date().toISOString() }) {
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
    return Object.freeze({ start, stop, scan });
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
      if (name !== "presence.json" && !/^[a-f0-9-]{36}\.(job|ack|claim)\.json$/.test(name)) throw new Error("Unsafe channel filename.");
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
      log: (message) => Zotero.logError(message),
    });
  }
  return Object.freeze({ create, createDesktop, planHash });
})();
