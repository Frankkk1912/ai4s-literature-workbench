#!/usr/bin/env node
/**
 * Cross-platform runtime bootstrap: install dependencies, build, and verify the
 * Zotero and Fulltext MCP runtimes over stdio.
 *
 * Usage:
 *   node scripts/bootstrap.mjs [--require-optional] [--report <path>]
 *
 * The .sh and .ps1 scripts are one-line wrappers around this file.
 * The Zotero runtime is required. The Fulltext runtime is optional unless
 * --require-optional is passed.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import os from "node:os";

const REQUIRED = [22, 13];
const pluginRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const scriptsDir = join(pluginRoot, "scripts");
const isWindows = process.platform === "win32";
const npm = isWindows ? "npm.cmd" : "npm";

function parseArgs(argv) {
  const out = { requireOptional: false, report: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--require-optional") out.requireOptional = true;
    else if (a === "--report") {
      const value = argv[++i];
      if (!value) throw new Error("--report needs a file path.");
      out.report = resolve(value);
    } else throw new Error(`Unknown argument: ${a}`);
  }
  return out;
}

function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, stdio: "inherit", shell: isWindows });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} exited with code ${result.status}.`);
  }
}

function capture(command, args) {
  const result = spawnSync(command, args, { encoding: "utf8", shell: isWindows });
  return result.status === 0 ? result.stdout.trim() : null;
}

function nodeIsSupported() {
  const [major, minor] = process.versions.node.split(".").map(Number);
  return major > REQUIRED[0] || (major === REQUIRED[0] && minor >= REQUIRED[1]);
}

const checks = [];

function bootstrapRuntime(name, dir, verifier) {
  const started = Date.now();
  try {
    if (!existsSync(dir)) throw new Error(`Runtime directory does not exist: ${dir}`);
    run(npm, ["ci"], dir);
    run(npm, ["run", "build"], dir);
    run(process.execPath, [join(scriptsDir, verifier)], pluginRoot);
    checks.push({ name, status: "passed", duration_ms: Date.now() - started, message: "Runtime built and verified over stdio." });
    return true;
  } catch (error) {
    checks.push({ name, status: "failed", duration_ms: Date.now() - started, message: error.message });
    console.error(`\n${name}: ${error.message}`);
    return false;
  }
}

function writeReport(path, overall) {
  mkdirSync(dirname(path), { recursive: true });
  const report = {
    schema_version: 1,
    generated_at: new Date().toISOString(),
    host: {
      os: `${os.type()} ${os.release()}`,
      node: process.version,
      npm: capture(npm, ["--version"]),
    },
    checks,
    artifacts: { plugin_root: pluginRoot },
    overall_status: overall,
  };
  writeFileSync(path, JSON.stringify(report, null, 2) + "\n");
  console.log(`Bootstrap report written to: ${path}`);
}

function main() {
  const args = parseArgs(process.argv.slice(2));

  if (!nodeIsSupported()) {
    console.error(
      `This computer has Node.js ${process.versions.node}, but the workbench needs Node.js ${REQUIRED.join(".")} or newer.\n` +
        "Install the current LTS version from https://nodejs.org/ and run this again.",
    );
    process.exit(1);
  }
  if (!capture(npm, ["--version"])) {
    console.error("npm was not found. It comes with Node.js; reinstall Node.js from https://nodejs.org/ and run this again.");
    process.exit(1);
  }

  const zoteroReady = bootstrapRuntime("zotero-runtime", join(pluginRoot, "runtime"), "verify-runtime.mjs");
  const fulltextReady = bootstrapRuntime("fulltext-runtime", join(pluginRoot, "fulltext-runtime"), "verify-fulltext-runtime.mjs");

  if (!fulltextReady) {
    console.warn("Warning: the optional full-text tools were not installed. Zotero tools and the literature skills remain available.");
  }

  const failed = !zoteroReady || (args.requireOptional && !fulltextReady);
  const overall = failed ? "failed" : fulltextReady ? "passed" : "partial";
  if (args.report) writeReport(args.report, overall);

  if (!zoteroReady) {
    console.error("The required Zotero runtime failed to bootstrap.");
    process.exit(1);
  }
  if (args.requireOptional && !fulltextReady) {
    console.error("The optional full-text runtime failed and --require-optional was specified.");
    process.exit(1);
  }

  console.log(`\nAI4S Literature Workbench runtime bootstrap completed with status: ${overall}`);
  console.log("\nSearch, ranking and writing work without any keys.");
  console.log("To add a Zotero, PubMed or EasyScholar key, ask your agent to start setup; keys are entered in a masked page, never in chat.");
}

try {
  main();
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
