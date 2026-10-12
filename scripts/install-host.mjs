#!/usr/bin/env node
// Multi-host installer for the AI4S Literature Workbench.
//
// Behaviour is deliberately narrow. For each host it either:
//   - runs that host's OFFICIAL CLI (never edits host config files by guesswork),
//   - writes a host-specific config file that the host's docs say it reads, or
//   - prints instructions only, for hosts whose install path is not verified.
// Every result carries a `status` that says what was actually done or checked.
//
// Usage:
//   node scripts/install-host.mjs --list
//   node scripts/install-host.mjs --host claude [--dry-run]
//   node scripts/install-host.mjs --host qoder --target <project-dir>
//   node scripts/install-host.mjs --host all --dry-run
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const MARKETPLACE = "Frankkk1912/ai4s-literature-workbench";
const PLUGIN_ID = "ai4s-literature-workbench@ai4s-literature-workbench";
const CODEX_PLUGIN_ID = "ai4s-literature-workbench@personal";

// status vocabulary:
//   installed       the official CLI reported success in this run
//   config_written  a host config file was written (host not run here)
//   instructions    no install performed; the user must act
//   unavailable     the host CLI is not on PATH, so nothing was attempted
//   unverified      install path is documented but not tested here
const HOSTS = {
  claude: {
    label: "Claude Code",
    evidence: "measured: claude CLI 2.1.x subcommands confirmed in this repo",
    run(dry) {
      if (!hasCommand("claude")) return { status: "unavailable", detail: "claude not on PATH" };
      const cmds = [
        ["plugin", "marketplace", "add", MARKETPLACE],
        ["plugin", "install", PLUGIN_ID],
      ];
      if (dry) return { status: "instructions", detail: cmds.map((c) => `claude ${c.join(" ")}`).join("\n") };
      for (const c of cmds) {
        const r = spawnSync("claude", c, { encoding: "utf8" });
        if (r.status !== 0) {
          return { status: "unverified", detail: `claude ${c.join(" ")} exited ${r.status}: ${(r.stderr || r.stdout).trim()}` };
        }
      }
      return { status: "installed", detail: cmds.map((c) => `claude ${c.join(" ")}`).join("\n") };
    },
  },
  codex: {
    label: "Codex",
    evidence: "documented path; not run on this machine (codex not installed)",
    run(dry) {
      if (!hasCommand("codex")) return { status: "unavailable", detail: "codex not on PATH" };
      const cmds = [
        ["plugin", "marketplace", "add", REPO],
        ["plugin", "add", CODEX_PLUGIN_ID],
      ];
      if (dry) return { status: "instructions", detail: cmds.map((c) => `codex ${c.join(" ")}`).join("\n") };
      for (const c of cmds) {
        const r = spawnSync("codex", c, { encoding: "utf8" });
        if (r.status !== 0) {
          return { status: "unverified", detail: `codex ${c.join(" ")} exited ${r.status}: ${(r.stderr || r.stdout).trim()}` };
        }
      }
      return { status: "installed", detail: cmds.map((c) => `codex ${c.join(" ")}`).join("\n") };
    },
  },
  trae: {
    label: "Trae (MCP only)",
    evidence: "read from docs.trae.cn; reads .trae/mcp.json, not plugin manifests",
    run(dry, target) {
      const dest = join(target || REPO, ".trae", "mcp.json");
      return writeMcpConfig(dest, dry, "config_written", "Trae reads project MCP from .trae/mcp.json");
    },
  },
  qoder: {
    label: "Qoder (plugin + MCP)",
    evidence: "read from docs.qoder.com; needs .qoder-plugin/plugin.json and mcp.json",
    run(dry, target) {
      const base = target || REPO;
      const mcpDest = join(base, "mcp.json");
      const manifestDest = join(base, ".qoder-plugin", "plugin.json");
      const manifest = {
        name: "ai4s-literature-workbench",
        version: "0.1.0",
        description: "Auditable literature retrieval, Zotero workflows, and evidence-traced writing.",
        displayName: "AI4S Literature Workbench",
        homepage: "https://github.com/Frankkk1912/ai4s-literature-workbench",
        repository: "https://github.com/Frankkk1912/ai4s-literature-workbench",
        license: "MIT",
        mcpServers: "./mcp.json",
      };
      if (dry) {
        return { status: "instructions", detail: `would write ${manifestDest} and ${mcpDest}` };
      }
      mkdirSync(dirname(manifestDest), { recursive: true });
      writeFileSync(manifestDest, JSON.stringify(manifest, null, 2) + "\n");
      const mcp = readMcpSource();
      writeFileSync(mcpDest, JSON.stringify(mcp, null, 2) + "\n");
      return { status: "config_written", detail: `${manifestDest}\n${mcpDest}` };
    },
  },
  workbuddy: {
    label: "WorkBuddy",
    evidence: "unverified: custom connector form not fully read from docs",
    run() {
      return {
        status: "instructions",
        detail:
          "WorkBuddy: 专家·技能·连接器 → 右上角 自定义连接器. The connector config format was not confirmed; this script does not install into WorkBuddy.",
      };
    },
  },
  opencode: {
    label: "opencode",
    evidence: "unverified: docs not retrievable here; search summary shows plugin array and mcp key",
    run(dry) {
      if (!hasCommand("opencode")) return { status: "unavailable", detail: "opencode not on PATH" };
      return { status: "instructions", detail: "Add the MCP servers under the mcp key in opencode.json. Not auto-installed." };
    },
  },
};

function hasCommand(name) {
  const probe = process.platform === "win32" ? "where" : "which";
  return spawnSync(probe, [name], { encoding: "utf8" }).status === 0;
}

// The repo's .mcp.json is the single source for MCP servers. Read it, never retype it.
// Its entries use paths relative to the repo ("./runtime/dist/index.js"). A config
// written into another project would resolve those against that project, so
// rewrite every relative path to an absolute path under this checkout.
function readMcpSource() {
  const src = join(REPO, ".mcp.json");
  if (!existsSync(src)) throw new Error(`missing ${src}`);
  const config = JSON.parse(readFileSync(src, "utf8"));
  for (const server of Object.values(config.mcpServers || {})) {
    if (server.cwd === ".") server.cwd = REPO;
    server.args = (server.args || []).map((a) =>
      typeof a === "string" && a.startsWith("./") ? join(REPO, a) : a,
    );
  }
  return config;
}

function writeMcpConfig(dest, dry, okStatus, note) {
  if (dry) return { status: "instructions", detail: `would write ${dest}` };
  mkdirSync(dirname(dest), { recursive: true });
  writeFileSync(dest, JSON.stringify(readMcpSource(), null, 2) + "\n");
  return { status: okStatus, detail: `${dest} (${note})` };
}

function parseArgs(argv) {
  const out = { host: null, dryRun: false, list: false, target: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--host") out.host = argv[++i];
    else if (a === "--target") out.target = resolve(argv[++i]);
    else if (a === "--dry-run") out.dryRun = true;
    else if (a === "--list") out.list = true;
    else throw new Error(`unknown argument: ${a}`);
  }
  return out;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.list || !args.host) {
    for (const [id, h] of Object.entries(HOSTS)) console.log(`${id.padEnd(10)} ${h.label} — ${h.evidence}`);
    return;
  }
  const ids = args.host === "all" ? Object.keys(HOSTS) : [args.host];
  for (const id of ids) {
    const host = HOSTS[id];
    if (!host) {
      console.error(`unknown host: ${id}`);
      process.exitCode = 2;
      continue;
    }
    const result = host.run(args.dryRun, args.target);
    console.log(`\n[${id}] ${host.label}`);
    console.log(`  status:   ${result.status}`);
    console.log(`  evidence: ${host.evidence}`);
    console.log(`  detail:   ${result.detail.replace(/\n/g, "\n            ")}`);
  }
}

main();
