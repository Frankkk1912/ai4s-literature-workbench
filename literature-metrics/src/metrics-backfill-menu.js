/* global Zotero */
/*
 * Metrics Backfill menu (workbench order 11).
 *
 * Right-click entries that submit a preview-only metrics-backfill request
 * through the workbench jobs channel. This module never fetches journal data,
 * never writes Extra, and never holds any EasyScholar / Zotero API key; the
 * workbench runtime consumes the request with zotero_backfill_metrics (always
 * dry_run) and answers with a result file that is shown in Zotero. Applying a
 * plan always needs a separate, explicit confirmation of its plan hash in the
 * workbench, so cancelling the menu dialog never writes anything.
 */

// "var" so Services.scriptloader.loadSubScript attaches the export to the
// caller's scope; assigning to globalThis would miss the scope and crash startup.
// eslint-disable-next-line no-unused-vars -- this var IS the module export
var LiteratureMetricsBackfillMenu = (function () {
  "use strict";

  const ITEM_MENU_ID = "literature-metrics-backfill-items-menuitem";
  const COLLECTION_MENU_ID = "literature-metrics-backfill-collection-menuitem";
  const ITEM_MENU_LABEL = "Backfill Metrics for Selected Items";
  const COLLECTION_MENU_LABEL = "Backfill Metrics for Current Collection";
  const WATCH_INTERVAL_MS = 2000;
  const WATCH_TIMEOUT_MS = 15 * 60 * 1000;

  let channel = null;
  let schedule = null;
  let cancelTimer = null;
  let confirmDialog = null;
  let mainWindow = null;
  let itemMenuNode = null;
  let collectionMenuNode = null;
  let itemMenuPopupHandler = null;
  let collectionMenuPopupHandler = null;
  const watchers = new Map();
  let started = false;

  function log(message, level) {
    if (typeof Zotero !== "undefined" && Zotero) {
      if (level === "error" && Zotero.logError) Zotero.logError(message);
      else if (Zotero.debug) Zotero.debug("[literature-metrics] " + message);
    }
  }

  function selectedRegularItems(win) {
    const pane = win && win.ZoteroPane;
    const items = pane && typeof pane.getSelectedItems === "function" ? pane.getSelectedItems() : [];
    return Array.isArray(items)
      ? items.filter((item) => item && item.isRegularItem && item.isRegularItem())
      : [];
  }

  function selectedCollectionKey(win) {
    const pane = win && win.ZoteroPane;
    const collection = pane && typeof pane.getSelectedCollection === "function" ? pane.getSelectedCollection() : null;
    return collection && collection.objectType === "collection" && typeof collection.key === "string"
      && /^[A-Z0-9]{8}$/.test(collection.key) ? collection.key : null;
  }

  function showProgress(headline, description) {
    try {
      if (typeof Zotero !== "undefined" && Zotero && Zotero.ProgressWindow) {
        const popup = new Zotero.ProgressWindow();
        popup.changeHeadline(headline);
        popup.addDescription(description);
        popup.show();
        popup.startCloseTimer(10000);
      }
    }
    catch (error) {
      log("Could not show metrics backfill progress: " + error, "error");
    }
  }

  function readable(error) {
    return error && error.message ? error.message : String(error);
  }

  function describeResult(result) {
    if (result.status === "failed") {
      return "Preview failed: " + (result.error || "unknown workbench error");
    }
    const preview = result.preview || {};
    const parts = [];
    if (Number.isFinite(preview.update)) parts.push(preview.update + " would update");
    if (Number.isFinite(preview.skip)) parts.push(preview.skip + " skipped");
    const hash = String(preview.plan_hash || "");
    if (hash) parts.push("plan_hash " + hash.slice(0, 16) + "…");
    const easyscholar = preview.easyscholar || {};
    if (easyscholar.key_configured === false) parts.push("EasyScholar key not configured");
    return parts.join(" · ") + " — review and apply from your workbench assistant.";
  }

  // Poll for the runtime's result file; stop after a generous timeout so a
  // workbench that is not running cannot spin this forever.
  function watchResult(job) {
    const jobId = job.job_id;
    const deadline = Date.now() + WATCH_TIMEOUT_MS;
    let busy = false;
    const timer = schedule(async () => {
      if (busy || !watchers.has(jobId)) return;
      busy = true;
      try {
        if (Date.now() > deadline) {
          watchers.delete(jobId);
          cancelTimer(timer);
          showProgress("Literature Metrics · Backfill",
            "No preview arrived for job " + jobId.slice(0, 8) + " — is the workbench assistant running? The request stays queued.");
          return;
        }
        let result = null;
        try { result = await channel.readMetricsBackfillResult(jobId); }
        catch (error) { log("Could not read metrics backfill result: " + readable(error), "error"); return; }
        if (!result || !watchers.has(jobId)) return;
        if (result.job_id !== jobId || result.job_plan_hash !== job.plan_hash) {
          log("Ignoring a mismatched metrics backfill result file.", "error");
          return;
        }
        watchers.delete(jobId);
        cancelTimer(timer);
        showProgress("Literature Metrics · Backfill Preview", describeResult(result));
        try { await channel.discardMetricsBackfillJob(jobId); }
        catch (error) { log("Could not clean up metrics backfill job: " + readable(error), "error"); }
      }
      finally { busy = false; }
    }, WATCH_INTERVAL_MS);
    watchers.set(jobId, timer);
  }

  async function submitRequest(payload, label) {
    let job = null;
    try {
      job = await channel.submitMetricsBackfillJob(payload);
    }
    catch (error) {
      log("Could not submit metrics backfill request: " + readable(error), "error");
      showProgress("Literature Metrics · Backfill", "Could not submit the request: " + readable(error));
      return;
    }
    showProgress("Literature Metrics · Backfill",
      "Preview request queued for " + label + ". Run zotero_backfill_metrics in your workbench assistant to build it.");
    watchResult(job);
  }

  async function backfillSelectedItems(win) {
    // Same key format the jobs channel accepts: drop items whose key cannot be a
    // real Zotero key, so the request payload never fails validation downstream.
    const keys = [...new Set(selectedRegularItems(win)
      .map((item) => (item && typeof item.key === "string" ? item.key : ""))
      .filter((key) => /^[A-Z0-9]{8}$/.test(key)))];;
    if (!keys.length) {
      showProgress("Literature Metrics · Backfill", "No eligible regular items are selected.");
      return;
    }
    const agreed = await confirmDialog("Metrics Backfill",
      "Submit a metrics backfill request for " + keys.length + " selected item(s)? The workbench will build a PREVIEW first "
      + "(dry run). Nothing is written to Zotero; applying the plan later always needs your separate confirmation of its plan hash.");
    if (!agreed) return;
    await submitRequest({ item_keys: keys }, keys.length + " selected item(s)");
  }

  async function backfillCurrentCollection(win) {
    const key = selectedCollectionKey(win);
    if (!key) {
      showProgress("Literature Metrics · Backfill", "No regular collection is selected.");
      return;
    }
    const agreed = await confirmDialog("Metrics Backfill",
      "Submit a metrics backfill request for the current collection? The workbench will build a PREVIEW first "
      + "(dry run). Nothing is written to Zotero; applying the plan later always needs your separate confirmation of its plan hash.");
    if (!agreed) return;
    await submitRequest({ collection_key: key }, "collection " + key);
  }

  function registerMenus(win) {
    if (!win || !win.document || !win.document.createElementNS) return;
    const doc = win.document;
    const xul = "http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul";
    const itemMenu = doc.getElementById("zotero-itemmenu");
    if (itemMenu) {
      const item = doc.createElementNS(xul, "menuitem");
      item.id = ITEM_MENU_ID;
      item.setAttribute("label", ITEM_MENU_LABEL);
      item.addEventListener("command", async () => { await backfillSelectedItems(win); });
      itemMenuPopupHandler = () => {
        item.hidden = selectedRegularItems(win).length === 0;
      };
      itemMenu.addEventListener("popupshowing", itemMenuPopupHandler);
      itemMenu.appendChild(item);
      itemMenuNode = item;
    }
    const collectionMenu = doc.getElementById("zotero-collectionmenu");
    if (collectionMenu) {
      const item = doc.createElementNS(xul, "menuitem");
      item.id = COLLECTION_MENU_ID;
      item.setAttribute("label", COLLECTION_MENU_LABEL);
      item.addEventListener("command", async () => { await backfillCurrentCollection(win); });
      collectionMenuPopupHandler = () => {
        item.hidden = !selectedCollectionKey(win);
      };
      collectionMenu.addEventListener("popupshowing", collectionMenuPopupHandler);
      collectionMenu.appendChild(item);
      collectionMenuNode = item;
    }
  }

  function start(options) {
    if (started) return;
    const settings = options || {};
    if (!settings.channel || typeof settings.channel.submitMetricsBackfillJob !== "function") {
      // Without a live jobs channel the menus would be dead links; leave them
      // unregistered instead. Metrics columns are unaffected either way.
      log("Metrics backfill menu not registered: the workbench jobs channel is unavailable.");
      return;
    }
    if (typeof settings.schedule !== "function" || typeof settings.cancel !== "function"
      || typeof settings.confirm !== "function") {
      log("Metrics backfill menu not registered: timer or confirm dialog is missing.");
      return;
    }
    started = true;
    channel = settings.channel;
    schedule = settings.schedule;
    cancelTimer = settings.cancel;
    confirmDialog = settings.confirm;
    mainWindow = typeof Zotero !== "undefined" && Zotero.getMainWindow ? Zotero.getMainWindow() : null;
    registerMenus(mainWindow);
  }

  async function stop() {
    if (mainWindow && itemMenuNode && itemMenuPopupHandler && itemMenuNode.parentNode) {
      itemMenuNode.parentNode.removeEventListener("popupshowing", itemMenuPopupHandler);
    }
    if (mainWindow && collectionMenuNode && collectionMenuPopupHandler && collectionMenuNode.parentNode) {
      collectionMenuNode.parentNode.removeEventListener("popupshowing", collectionMenuPopupHandler);
    }
    for (const node of [itemMenuNode, collectionMenuNode]) {
      if (node && typeof node.remove === "function") node.remove();
    }
    for (const timer of watchers.values()) cancelTimer(timer);
    watchers.clear();
    itemMenuNode = null;
    collectionMenuNode = null;
    itemMenuPopupHandler = null;
    collectionMenuPopupHandler = null;
    mainWindow = null;
    channel = null;
    schedule = null;
    cancelTimer = null;
    confirmDialog = null;
    started = false;
  }

  return Object.freeze({
    start,
    stop,
    ITEM_MENU_ID,
    COLLECTION_MENU_ID,
    ITEM_MENU_LABEL,
    COLLECTION_MENU_LABEL,
  });
})();
