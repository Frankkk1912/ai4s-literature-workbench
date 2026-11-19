// Regression guard: the published runtime must load its onboarding core from
// inside the package. A repo checkout can mask a broken package, so this packs
// the runtime, installs the tarball into a clean project, and loads the bridge.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync, existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnCommand } from "../scripts/spawn-command.mjs";

const runtimeDir = resolve("runtime");

function runNpm(args, options) {
  const result = spawnCommand("npm", args, { encoding: "utf8", ...options });
  if (result.error || result.status !== 0) {
    const error = new Error(result.stderr || result.error?.message || `npm ${args.join(" ")} exited ${result.status}`);
    error.stdout = result.stdout;
    error.stderr = result.stderr;
    throw error;
  }
  return result.stdout ?? "";
}

test("packed runtime loads the onboarding core from inside the package", () => {
  // Build first: dist/ is not produced by npm ci, and the root test step runs
  // before the workflow's runtime build. Without this the tarball has no dist.
  runNpm(["run", "build"], { cwd: runtimeDir, stdio: "ignore" });
  // A space in the destination is the Windows failure mode: cmd.exe used to
  // split `--pack-destination` and the packed tarball path.
  const work = mkdtempSync(join(tmpdir(), "packed install-"));
  try {
    const packOut = runNpm(["pack", "--pack-destination", work, "--silent"], { cwd: runtimeDir }).trim().split(/\r?\n/).pop();
    const tgz = join(work, packOut);

    const consumer = join(work, "consumer");
    const made = spawnCommand(process.execPath, ["-e", "require('fs').mkdirSync(process.argv[1],{recursive:true})", consumer]);
    if (made.status !== 0) throw made.error || new Error(`mkdir failed: ${made.stderr}`);
    writeFileSync(join(consumer, "package.json"), JSON.stringify({ name: "consumer", version: "0.0.0", type: "module" }));
    // Capture npm's output instead of discarding it, so a failing install
    // reports its real reason rather than a downstream "module not found".
    const install = spawnCommand("npm", ["install", tgz, "--no-audit", "--no-fund"], {
      cwd: consumer,
      encoding: "utf8",
    });
    assert.equal(
      install.status,
      0,
      `npm install of the packed runtime failed (exit ${install.status}):\n${install.stdout}\n${install.stderr}`,
    );

    const probe = join(consumer, "probe.mjs");
    writeFileSync(
      probe,
      `const c = await import("literature-zotero-mcp/dist/lib/onboarding-core.mjs");
       console.log(JSON.stringify({ ok: typeof c.verifyZoteroKey === "function" && typeof c.saveAcademicKey === "function" }));`,
    );
    // On failure, record what the consumer actually contains so a CI-only
    // difference is visible in the test output instead of guessed at.
    const probeRun = spawnCommand(process.execPath, [probe], { cwd: consumer, encoding: "utf8" });
    if (probeRun.status !== 0) {
      const pkgDir = join(consumer, "node_modules", "literature-zotero-mcp");
      const libDir = join(pkgDir, "dist", "lib");
      const listing = existsSync(libDir) ? readdirSync(libDir).join(", ") : "(dist/lib missing)";
      const top = existsSync(pkgDir) ? readdirSync(pkgDir).join(", ") : "(package dir missing)";
      assert.fail(
        `probe failed (exit ${probeRun.status}).\n` +
        `package top-level: ${top}\n` +
        `dist/lib: ${listing}\n` +
        `stderr: ${String(probeRun.stderr ?? "").slice(0, 600)}`,
      );
    }
    assert.deepEqual(JSON.parse(probeRun.stdout.trim().split(/\r?\n/).pop()), { ok: true });
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});
