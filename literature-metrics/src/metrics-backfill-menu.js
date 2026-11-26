/* global Zotero */
/*
 * Metrics Backfill menu (workbench order 11).
 *
 * Right-click entries that submit a metrics-backfill request through the
 * workbench jobs channel. This module never fetches journal data, never writes
 * Extra itself, and never holds any EasyScholar / Zotero API key; the workbench
 * runtime consumes the request. A preview (dry_run) is shown first. Applying
 * the plan happens only after a second, in-Zotero confirmation of that
 * preview's plan_hash, which queues an apply job carrying confirm_plan_hash.
 * Cancelling either dialog never writes anything.
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
  const PLAN_HASH = /^sha256:[a-f0-9]{64}$/;

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

  function hashPrefix(hash) {
    const value = String(hash || "");
    return value ? value.slice(0, 16) + "…" : "";
  }

  function describePreview(result) {
    if (result.status === "failed") {
      return "Preview failed: " + (result.error || "unknown workbench error");
    }
    const preview = result.preview || {};
    const parts = [];
    if (Number.isFinite(preview.update)) parts.push(preview.update + " would update");
    if (Number.isFinite(preview.skip)) parts.push(preview.skip + " skipped");
    const prefix = hashPrefix(preview.plan_hash);
    if (prefix) parts.push("plan_hash " + prefix);
    const easyscholar = preview.easyscholar || {};
    if (easyscholar.key_configured === false) parts.push("EasyScholar key not configured");
    return parts.join(" · ");
  }

  function writeConfirmText(preview) {
    const update = Number.isFinite(preview.update) ? preview.update : 0;
    const skip = Number.isFinite(preview.skip) ? preview.skip : 0;
    const prefix = hashPrefix(preview.plan_hash) || "(missing plan_hash)";
    return "Write this metrics plan to Zotero now?\n\n"
      + update + " item(s) will be updated, " + skip + " skipped.\n"
      + "plan_hash " + prefix + "\n\n"
      + "Cancel writes nothing. Confirm applies this exact plan. If the library has changed since the preview, the write will be refused and you can preview again.";
  }

  function describeApply(result) {
    if (result.status === "failed") {
      return "Write refused: " + (result.error || "unknown workbench error")
        + " Preview again from the menu if the library has changed.";
    }
    const apply = result.apply || {};
    const parts = [];
    if (Number.isFinite(apply.update)) parts.push("已写入 " + apply.update + " 篇");
    if (apply.receipt_path) parts.push("回执：" + apply.receipt_path);
    return parts.join("，") || "Write finished.";
  }

  async function discardJob(jobId) {
    try { await channel.discardMetricsBackfillJob(jobId); }
    catch (error) { log("Could not clean up metrics backfill job: " + readable(error), "error"); }
  }

  async function refreshMetricsView() {
    // Item-tree columns read Extra from the local item; a successful cloud write
    // refreshes them once Zotero has the updated item (sync or local notify).
    try {
      const pane = mainWindow && mainWindow.ZoteroPane;
      if (pane && pane.itemsView && typeof pane.itemsView.refresh === "function") {
        await pane.itemsView.refresh();
      }
    }
    catch (error) {
      log("Could not refresh the item tree after metrics apply: " + readable(error), "error");
    }
  }

  // Poll for the runtime's result file; stop after a generous timeout so a
  // workbench that is not running cannot spin this forever.
  function watchResult(job, context) {
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
          const waiting = context && context.kind === "apply" ? "write result" : "preview";
          showProgress("Literature Metrics · Backfill",
            "No " + waiting + " arrived for job " + jobId.slice(0, 8) + " — is the workbench assistant running? The request stays queued.");
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
        if (context && context.kind === "apply") {
          showProgress("Literature Metrics · Backfill", describeApply(result));
          await discardJob(jobId);
          if (result.status === "completed") await refreshMetricsView();
          return;
        }
        showProgress("Literature Metrics · Backfill Preview", describePreview(result));
        if (result.status === "failed") {
          await discardJob(jobId);
          return;
        }
        const preview = result.preview || {};
        const hash = String(preview.plan_hash || "");
        if (!PLAN_HASH.test(hash)) {
          showProgress("Literature Metrics · Backfill",
            "Preview did not include a usable plan_hash. Nothing was written.");
          await discardJob(jobId);
          return;
        }
        let agreed = false;
        try {
          agreed = await confirmDialog("Metrics Backfill · Confirm write", writeConfirmText(preview));
        }
        catch (error) {
          log("Could not show the metrics write confirmation: " + readable(error), "error");
        }
        await discardJob(jobId);
        if (!agreed) {
          showProgress("Literature Metrics · Backfill", "Write cancelled. Nothing was written.");
          return;
        }
        await submitApply(context.payload, hash);
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
      "Preview request queued for " + label + ". The running workbench will build a dry-run preview.");
    watchResult(job, { kind: "preview", payload });
  }

  async function submitApply(payload, confirmPlanHash) {
    const applyPayload = payload.collection_key
      ? { collection_key: payload.collection_key, mode: "apply", confirm_plan_hash: confirmPlanHash }
      : { item_keys: payload.item_keys, mode: "apply", confirm_plan_hash: confirmPlanHash };
    let job = null;
    try {
      job = await channel.submitMetricsBackfillJob(applyPayload);
    }
    catch (error) {
      log("Could not submit metrics backfill apply: " + readable(error), "error");
      showProgress("Literature Metrics · Backfill", "Could not submit the write: " + readable(error));
      return;
    }
    showProgress("Literature Metrics · Backfill",
      "Write request queued for plan_hash " + hashPrefix(confirmPlanHash) + ". The running workbench will apply this exact plan.");
    watchResult(job, { kind: "apply" });
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
      + "(dry run). Nothing is written to Zotero until you confirm the preview's plan hash.");
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
      + "(dry run). Nothing is written to Zotero until you confirm the preview's plan hash.");
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
