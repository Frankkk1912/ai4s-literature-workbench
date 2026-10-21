// Tests for the read-only Zotero XPI detector. Uses fake profile trees so the
// result does not depend on the machine running the tests.
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  ADDON_ID,
  inspectProfile,
  listProfiles,
  scanZoteroAddon,
} from "../runtime/src/lib/zotero-addon-status.mjs";
import { zoteroXpiStatus } from "../runtime/src/lib/onboarding-core.mjs";

function fakeZoteroRoot(profiles, { iniRelative = true } = {}) {
  const root = mkdtempSync(join(tmpdir(), "zotero-root-"));
  const lines = [];
  profiles.forEach((p, i) => {
    const rel = `Profiles/${p.name}`;
    const dir = join(root, rel);
    mkdirSync(dir, { recursive: true });
    if (p.extensions !== undefined) {
      writeFileSync(join(dir, "extensions.json"), JSON.stringify({ schemaVersion: 37, addons: p.extensions }));
    }
    lines.push(`[Profile${i}]`, `Name=${p.name}`, `IsRelative=${iniRelative ? 1 : 0}`, `Path=${iniRelative ? rel : dir}`, "");
  });
  writeFileSync(join(root, "profiles.ini"), lines.join("\n"));
  return root;
}

const addon = (over = {}) => ({
  id: ADDON_ID,
  version: "0.1.13",
  active: true,
  sourceURI: "file:///x/ai4s-literature-workbench/literature-metrics/dist/literature-metrics-0.1.13.xpi",
  ...over,
});

test("profiles come from profiles.ini, not from scanning a folder", () => {
  const root = fakeZoteroRoot([{ name: "a", extensions: [] }, { name: "b", extensions: [] }]);
  try {
    assert.deepEqual(listProfiles(root).map((p) => p.name), ["a", "b"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a stale profile folder not listed in profiles.ini is ignored", () => {
  const root = fakeZoteroRoot([{ name: "live", extensions: [] }]);
  mkdirSync(join(root, "Profiles", "deleted-old"), { recursive: true });
  writeFileSync(join(root, "Profiles", "deleted-old", "extensions.json"), JSON.stringify({ addons: [addon()] }));
  try {
    assert.deepEqual(scanZoteroAddon({ roots: [root] }).profiles.map((p) => p.profile), ["live"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("absent add-on is reported as not_installed", () => {
  const root = fakeZoteroRoot([{ name: "p", extensions: [] }]);
  try {
    const r = scanZoteroAddon({ roots: [root] });
    assert.equal(r.profiles[0].state, "not_installed");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("active add-on from this repository is installed_active", () => {
  const root = fakeZoteroRoot([{ name: "p", extensions: [addon()] }]);
  try {
    const r = scanZoteroAddon({ roots: [root] });
    assert.equal(r.profiles[0].state, "installed_active");
    assert.equal(r.profiles[0].sourceReleased, true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("active add-on from another source is flagged, not trusted", () => {
  const root = fakeZoteroRoot([{ name: "p", extensions: [addon({ sourceURI: "file:///old/Frank_AI4S_Skill/x.xpi" })] }]);
  try {
    const r = scanZoteroAddon({ roots: [root] });
    assert.equal(r.profiles[0].state, "installed_unconfirmed");
    assert.match(r.profiles[0].evidence, /reinstall/i);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a file saved in Downloads counts when the add-on updates from this repository", () => {
  const downloaded = addon({
    sourceURI: "file:///Users/someone/Downloads/literature-metrics.xpi",
    updateURL: "https://raw.githubusercontent.com/Frankkk1912/ai4s-literature-workbench/main/literature-metrics/update.json",
  });
  const root = fakeZoteroRoot([{ name: "p", extensions: [downloaded] }]);
  try {
    assert.equal(scanZoteroAddon({ roots: [root] }).profiles[0].state, "installed_active");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a copy that checks the retired repository for updates is flagged even from Downloads", () => {
  const old = addon({
    sourceURI: "file:///Users/someone/Downloads/literature-metrics-0.1.13.xpi",
    updateURL: "https://raw.githubusercontent.com/Frankkk1912/Frank_AI4S_Skill/main/literature-metrics/update.json",
  });
  const root = fakeZoteroRoot([{ name: "p", extensions: [old] }]);
  try {
    const r = scanZoteroAddon({ roots: [root] });
    assert.equal(r.profiles[0].state, "installed_unconfirmed");
    assert.match(r.profiles[0].evidence, /reinstall/i);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("disabled add-on is not reported as active", () => {
  const root = fakeZoteroRoot([{ name: "p", extensions: [addon({ active: false })] }]);
  try {
    const r = scanZoteroAddon({ roots: [root] });
    assert.equal(r.profiles[0].state, "installed_unconfirmed");
    assert.match(r.profiles[0].evidence, /disabled/i);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("unparseable extensions.json is unknown, not an error", () => {
  const root = fakeZoteroRoot([{ name: "p" }]);
  writeFileSync(join(root, "Profiles", "p", "extensions.json"), "{ not json");
  try {
    assert.equal(scanZoteroAddon({ roots: [root] }).profiles[0].state, "unknown");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("no profiles at all maps to unknown with no false positive", () => {
  const root = mkdtempSync(join(tmpdir(), "zotero-empty-"));
  try {
    const status = zoteroXpiStatus(scanZoteroAddon({ roots: [root] }));
    assert.equal(status.verification.level, "unknown");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a healthy install is pending_manual at most, never verified", () => {
  const root = fakeZoteroRoot([{ name: "p", extensions: [addon()] }]);
  try {
    const status = zoteroXpiStatus(scanZoteroAddon({ roots: [root] }));
    assert.equal(status.verification.level, "pending_manual");
    assert.notEqual(status.verification.level, "verified");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("an install from another source is never reported as healthy", () => {
  const root = fakeZoteroRoot([{ name: "p", extensions: [addon({ sourceURI: "file:///old/Frank_AI4S_Skill/x.xpi" })] }]);
  try {
    const status = zoteroXpiStatus(scanZoteroAddon({ roots: [root] }));
    assert.match(status.verification.evidence, /another source|Reinstall/i);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("inspectProfile tolerates a profile with no extensions file", () => {
  assert.equal(inspectProfile({ name: "x", dir: "/nonexistent-zotero-profile" }).state, "unknown");
});
