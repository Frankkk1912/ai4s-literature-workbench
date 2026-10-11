// Regression guard: the published runtime must load its onboarding core from
// inside the package. A repo checkout can mask a broken package, so this packs
// the runtime, installs the tarball into a clean project, and loads the bridge.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const runtimeDir = resolve("runtime");
const npm = process.platform === "win32" ? "npm.cmd" : "npm";

test("packed runtime loads the onboarding core from inside the package", () => {
  const work = mkdtempSync(join(tmpdir(), "packed-install-"));
  try {
    const packOut = execFileSync(npm, ["pack", "--pack-destination", work, "--silent"], {
      cwd: runtimeDir,
      encoding: "utf8",
      shell: process.platform === "win32",
    }).trim().split(/\r?\n/).pop();
    const tgz = join(work, packOut);

    const consumer = join(work, "consumer");
    execFileSync("node", ["-e", "require('fs').mkdirSync(process.argv[1],{recursive:true})", consumer]);
    writeFileSync(join(consumer, "package.json"), JSON.stringify({ name: "consumer", version: "0.0.0", type: "module" }));
    // Capture npm's output instead of discarding it, so a failing install
    // reports its real reason rather than a downstream "module not found".
    const install = spawnSync(npm, ["install", tgz, "--no-audit", "--no-fund"], {
      cwd: consumer,
      encoding: "utf8",
      shell: process.platform === "win32",
    });
    assert.equal(
      install.status,
      0,
      `npm install of the packed runtime failed (exit ${install.status}):\n${install.stdout}\n${install.stderr}`,
    );

    const probe = join(consumer, "probe.mjs");
    writeFileSync(
      probe,
      `const m = await import("literature-zotero-mcp/dist/lib/onboarding-core.js");
       const c = await m.loadOnboardingCore();
       console.log(JSON.stringify({ ok: typeof c.verifyZoteroKey === "function" && typeof c.saveAcademicKey === "function" }));`,
    );
    const out = execFileSync("node", [probe], { cwd: consumer, encoding: "utf8" });
    assert.deepEqual(JSON.parse(out.trim().split(/\r?\n/).pop()), { ok: true });
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});
