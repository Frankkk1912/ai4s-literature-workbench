/*
 * Literature Metrics, Article Type, Agent Tags, AI Summary, and Priority bootstrap entrypoint.
 *
 * Metrics and article-type data remain read-only. The only direct write path
 * is an explicit user action through the Priority star control, scoped number
 * shortcut, or item context menu; these replace only AI4S:Priority:1|2|3 tags.
 * The add-on never fetches journal data.
 */

var { Services } = ChromeUtils.importESModule("resource://gre/modules/Services.sys.mjs");
var LiteratureMetricsRuntime = null;
var WorkbenchPluginChannel = null;

// Startup failures must never escape unlogged again: report them to both the
// Error Console (logError) and the debug output (debug), with the full error
// message and stack so a real-Zotero smoke can always show the cause.
function reportStartupProblem(prefix, error) {
  const message = error && error.message ? error.message : String(error);
  const stack = error && error.stack ? `\n${error.stack}` : "";
  const detail = `${prefix} ${message}${stack}`;
  try { Zotero.logError(detail); } catch { /* never let logging rethrow */ }
  try { Zotero.debug(detail); } catch { /* never let logging rethrow */ }
}

// The Zotero main window's own interval timer works in bootstrap scopes where
// Timer.sys.mjs cannot be imported.
function windowChannelTimer(window) {
  return {
    schedule: (task, ms) => window.setInterval(task, ms),
    cancel: (id) => window.clearInterval(id),
  };
}

// Last-resort fallback: a re-arming setTimeout loop that satisfies the same
// repeating schedule/cancel contract the channel expects.
function setTimeoutChannelTimer() {
  const live = new Map();
  return {
    schedule(task, ms) {
      const handle = {};
      let stopped = false;
      let pending = setTimeout(function fire() {
        if (stopped) return;
        try { task(); }
        finally {
          if (!stopped) pending = setTimeout(fire, ms);
        }
      }, ms);
      handle.stop = () => { stopped = true; clearTimeout(pending); };
      live.set(handle, handle.stop);
      return handle;
    },
    cancel(handle) {
      const stop = live.get(handle);
      if (stop) {
        stop();
        live.delete(handle);
      }
    },
  };
}

function resolveChannelTimer() {
  try {
    const { setInterval, clearInterval } = ChromeUtils.importESModule("resource://gre/modules/Timer.sys.mjs");
    return { schedule: setInterval, cancel: clearInterval };
  }
  catch { /* fall through to the window timer */ }
  try {
    const window = Zotero.getMainWindow && Zotero.getMainWindow();
    if (window && typeof window.setInterval === "function" && typeof window.clearInterval === "function") {
      return windowChannelTimer(window);
    }
  }
  catch { /* fall through to the setTimeout loop */ }
  if (typeof setTimeout === "function" && typeof clearTimeout === "function") {
    return setTimeoutChannelTimer();
  }
  throw new Error("No safe repeating timer is available in this Zotero bootstrap scope.");
}

// Everything the jobs channel needs is resolved here, after the metrics
// columns are already running, so a channel failure can only disable the
// channel itself. This must never call Components.utils.importGlobalProperties:
// that API can throw in Zotero plugin sandboxes and once killed the whole
// startup, taking the metrics columns down with it.
async function startJobsChannel(data, scope) {
  // native-merge.js must load first: plugin-channel.js's createDesktop binds the
  // same-scope LiteratureNativeMerge var for native-merge jobs.
  Services.scriptloader.loadSubScript(data.rootURI + "src/native-merge.js", scope);
  Services.scriptloader.loadSubScript(data.rootURI + "src/plugin-channel.js", scope);
  // In Zotero 7+ bootstrap scopes IOUtils and PathUtils are already globals;
  // fall back to a guarded ES module import only when they are missing.
  let channelIOUtils = typeof IOUtils === "undefined" ? undefined : IOUtils;
  let channelPathUtils = typeof PathUtils === "undefined" ? undefined : PathUtils;
  if (!channelIOUtils) {
    channelIOUtils = ChromeUtils.importESModule("resource://gre/modules/IOUtils.sys.mjs").IOUtils;
  }
  if (!channelPathUtils) {
    channelPathUtils = ChromeUtils.importESModule("resource://gre/modules/PathUtils.sys.mjs").PathUtils;
  }
  const timer = resolveChannelTimer();
  WorkbenchPluginChannel = scope.LiteraturePluginChannel.createDesktop({
    Zotero,
    Services,
    Components,
    IOUtils: channelIOUtils,
    PathUtils: channelPathUtils,
    schedule: timer.schedule,
    cancel: timer.cancel,
  });
  await WorkbenchPluginChannel.start();
}

async function startup(data) {
  try {
    await Zotero.initializationPromise;
    const scope = {
      Zotero,
      rootURI: data.rootURI,
    };
    Services.scriptloader.loadSubScript(data.rootURI + "src/metrics-payload.js", scope);
    Services.scriptloader.loadSubScript(data.rootURI + "src/article-types.js", scope);
    Services.scriptloader.loadSubScript(data.rootURI + "src/semantic-tags.js", scope);
    Services.scriptloader.loadSubScript(data.rootURI + "src/ai-summaries.js", scope);
    Services.scriptloader.loadSubScript(data.rootURI + "src/priorities.js", scope);
    Services.scriptloader.loadSubScript(data.rootURI + "src/literature-metrics.js", scope);
    LiteratureMetricsRuntime = scope.LiteratureMetrics;
    // Metrics start FIRST and independently: the columns must appear even if
    // every step of the jobs channel below fails.
    await LiteratureMetricsRuntime.start({ id: data.id, version: data.version, rootURI: data.rootURI });
    try {
      await startJobsChannel(data, scope);
    }
    catch (error) {
      // Log loudly but keep the metrics columns alive; shutdown still attempts
      // a channel stop if start() got far enough to need cleanup.
      reportStartupProblem("Workbench jobs channel:", error);
    }
  }
  catch (error) {
    // A channel failure is already isolated above; anything reaching here is a
    // metrics-startup problem and must still be visible in Zotero's logs.
    reportStartupProblem("Workbench literature-metrics startup:", error);
  }
}

async function shutdown() {
  if (WorkbenchPluginChannel) {
    try { await WorkbenchPluginChannel.stop(); }
    catch (error) { reportStartupProblem("Workbench jobs channel:", error); }
    WorkbenchPluginChannel = null;
  }
  if (LiteratureMetricsRuntime) {
    await LiteratureMetricsRuntime.stop();
    LiteratureMetricsRuntime = null;
  }
}

function install() {}

function uninstall() {}
