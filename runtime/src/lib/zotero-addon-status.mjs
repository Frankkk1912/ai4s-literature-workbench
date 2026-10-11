// Read-only detection of the literature-metrics XPI in every Zotero profile.
// Reads Zotero's own records (profiles.ini, extensions.json). Never writes to a
// profile and never installs or modifies add-ons.
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";

export const ADDON_ID = "literature-metrics@frank-ai4s.local";
// Source the published release is built from. An install whose sourceURI points
// anywhere else (for example the retired parent tree) is flagged, not trusted.
export const RELEASE_SOURCE_MARKER = "ai4s-literature-workbench";

export function zoteroRoots(env = process.env, platform = process.platform, home = homedir()) {
  if (platform === "darwin") return [join(home, "Library", "Application Support", "Zotero")];
  if (platform === "win32") {
    const appData = env.APPDATA || join(home, "AppData", "Roaming");
    return [join(appData, "Zotero", "Zotero")];
  }
  return [join(env.XDG_DATA_HOME || join(home, ".zotero"), "zotero"), join(home, ".zotero", "zotero")];
}

// profiles.ini is Zotero's authoritative profile list. Scanning the Profiles
// folder would also pick up stale or deleted profile directories.
export function listProfiles(root) {
  const ini = join(root, "profiles.ini");
  if (!existsSync(ini)) return [];
  const profiles = [];
  let current = null;
  for (const raw of readFileSync(ini, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (line.startsWith("[")) {
      if (current?.Path) profiles.push(current);
      current = line.startsWith("[Profile") ? {} : null;
      continue;
    }
    if (!current || !line.includes("=")) continue;
    const [k, ...rest] = line.split("=");
    current[k] = rest.join("=");
  }
  if (current?.Path) profiles.push(current);
  return profiles.map((p) => {
    const relative = p.IsRelative !== "0";
    const dir = relative ? resolve(root, p.Path) : p.Path;
    return { name: p.Name || p.Path, dir, isAbsolute: isAbsolute(p.Path) };
  });
}

function sourceLooksReleased(sourceURI) {
  return typeof sourceURI === "string" && sourceURI.includes(RELEASE_SOURCE_MARKER);
}

export function inspectProfile(profile) {
  const file = join(profile.dir, "extensions.json");
  if (!existsSync(file)) {
    return { profile: profile.name, state: "unknown", evidence: "No extensions.json in this profile." };
  }
  let data;
  try {
    data = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return { profile: profile.name, state: "unknown", evidence: "extensions.json could not be parsed." };
  }
  const addon = (data.addons || []).find((a) => a.id === ADDON_ID);
  if (!addon) {
    return { profile: profile.name, state: "not_installed", evidence: "Add-on not present in this profile." };
  }
  const active = addon.active === true;
  const released = sourceLooksReleased(addon.sourceURI);
  return {
    profile: profile.name,
    state: active && released ? "installed_active" : "installed_unconfirmed",
    version: addon.version ?? null,
    active,
    sourceReleased: released,
    evidence: active
      ? released
        ? `Version ${addon.version} is active and was installed from this repository.`
        : `Version ${addon.version} is active but its source is not this repository; reinstall from the release.`
      : `Version ${addon.version} is present but disabled.`,
  };
}

export function scanZoteroAddon({ roots = zoteroRoots() } = {}) {
  const profiles = roots.flatMap((root) => listProfiles(root));
  const results = profiles.map(inspectProfile);
  return { profileCount: profiles.length, profiles: results };
}
