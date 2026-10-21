// Consistency rules for the add-on's update feed (update.json) that Zotero reads from the
// manifest's update_url. Pure functions: callers pass the parsed files, so the same rules run in
// `npm run check`, in `npm run package` and when the release assets are built.
import { createHash } from "node:crypto";

export const ADDON_ID = "literature-metrics@frank-ai4s.local";
export const RELEASE_BASE = "https://github.com/Frankkk1912/ai4s-literature-workbench/releases/download/";

export function sha256Hex(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function compareVersions(a, b) {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

export function newestEntry(feed) {
  const updates = feed?.addons?.[ADDON_ID]?.updates;
  if (!Array.isArray(updates) || updates.length === 0) return null;
  return [...updates].sort((x, y) => compareVersions(y.version, x.version))[0];
}

/**
 * Returns a list of problems (empty when the feed is sound).
 *   xpiBytes      the built add-on, to check update_hash against
 *   pluginVersion the release being built; the newest entry must not point at a later tag
 */
export function checkFeed({ manifest, feed, xpiBytes, pluginVersion }) {
  const problems = [];
  const zotero = manifest.applications?.zotero ?? {};
  const entry = newestEntry(feed);
  if (!entry) return ["update.json has no entry for this add-on."];

  if (entry.version !== manifest.version) {
    problems.push(`update.json's newest version is ${entry.version} but the add-on is ${manifest.version}.`);
  }
  const wantName = `literature-metrics-${manifest.version}.xpi`;
  const link = String(entry.update_link ?? "");
  const match = link.startsWith(RELEASE_BASE) ? link.slice(RELEASE_BASE.length).split("/") : null;
  if (!match || match.length !== 2 || match[1] !== wantName || !/^v\d+\.\d+\.\d+$/.test(match[0])) {
    problems.push(`update_link must be ${RELEASE_BASE}v<release version>/${wantName}, got ${link || "nothing"}.`);
  } else if (pluginVersion && compareVersions(match[0].slice(1), pluginVersion) > 0) {
    problems.push(`update_link points at ${match[0]}, which is newer than the release being built (v${pluginVersion}).`);
  }
  if (!/^sha256:[0-9a-f]{64}$/.test(String(entry.update_hash ?? ""))) {
    problems.push("update_hash must look like sha256:<64 hex digits>.");
  } else if (xpiBytes && entry.update_hash !== `sha256:${sha256Hex(xpiBytes)}`) {
    problems.push(
      `update_hash does not match the built add-on (expected sha256:${sha256Hex(xpiBytes)}). Run npm run package -- --update-feed.`,
    );
  }
  const range = entry.applications?.zotero ?? {};
  if (range.strict_min_version !== zotero.strict_min_version || range.strict_max_version !== zotero.strict_max_version) {
    problems.push("update.json's Zotero version range differs from manifest.json.");
  }
  if (!String(zotero.update_url ?? "").includes("/Frankkk1912/ai4s-literature-workbench/")) {
    problems.push("manifest update_url must point at this repository.");
  }
  return problems;
}
