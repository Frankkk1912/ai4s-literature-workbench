# Install guide for agents

This file is the only source of install steps. If a step you want is not here, it does not exist for this project: do not invent one. In particular there is no model API key to set, no Windows installer, and no SmartScreen step. `install-manifest.json` holds the same routes in machine-readable form.

## Rules

1. Follow the route for the user's app below, in order. Run what you can yourself; the user only approves prompts.
2. Tell the user up front that you may ask for permission to reach GitHub or the network, and that they should choose Allow.
3. Never ask for a key in chat and never put one in a command. Keys are optional, and search works without any.
4. Report results as what works now and what needs the user. Do not say "runtime not built" or "not configured".
5. Do not say anything works until the check at the end of this file has passed.

## After every install: build once

Installing the plugin copies source only. The `dist/` folders are build output and are not in git, so the tools do not exist until you run this once:

```text
node <plugin-root>/scripts/bootstrap.mjs
```

`<plugin-root>` is the folder that contains `scripts/bootstrap.mjs` and `.mcp.json`. Search for it; do not guess. Run the script with `node`, not with `.ps1` or `.sh` files, on every system.

It needs Node.js 22.13 or newer. If `node --version` fails or is older, say: "I need Node.js, a free standard tool, installed first", and give https://nodejs.org/ (current LTS). Re-run after it is installed.

## Routes by app

### Claude Code

```text
claude plugin marketplace add Frankkk1912/ai4s-literature-workbench
claude plugin install ai4s-literature-workbench@ai4s-literature-workbench
```

Then build once, then restart Claude Code.

### Codex

```text
codex plugin marketplace add https://github.com/Frankkk1912/ai4s-literature-workbench.git
codex plugin add ai4s-literature-workbench@personal
```

Then build once, then restart Codex. Codex may block GitHub access until the user approves it.

### WorkBuddy (unverified)

Not yet tested on WorkBuddy. Per WorkBuddy's plugin documentation, try in this order and stop at the first that works:

1. Add `https://github.com/Frankkk1912/ai4s-literature-workbench` as a plugin marketplace in the app and install `ai4s-literature-workbench`. Then build once and restart.
2. If the app only accepts MCP entries, add the two servers below to `~/.workbuddy/mcp.json`. The file is named `mcp.json`, with no leading dot, unlike this repository's `.mcp.json`. Do not create a second file; add to the existing one if there is one.

```json
{
  "mcpServers": {
    "ai4s-literature-zotero": {
      "command": "node",
      "args": ["<plugin-root>/runtime/dist/index.js"],
      "cwd": "<plugin-root>",
      "env": { "LITERATURE_ZOTERO_MCP_TOOL_PROFILE": "workbench" }
    },
    "ai4s-literature-fulltext": {
      "command": "node",
      "args": ["<plugin-root>/fulltext-runtime/dist/index.js"],
      "cwd": "<plugin-root>"
    }
  }
}
```

Replace `<plugin-root>` with the absolute path, and keep any servers already in the file.

If neither route works, tell the user which step failed and stop.

### CodeBuddy (unverified)

Not yet tested on CodeBuddy. Inside CodeBuddy:

```text
/plugin marketplace add Frankkk1912/ai4s-literature-workbench
/plugin install ai4s-literature-workbench@ai4s-literature-workbench
```

Then build once and restart.

### Trae and Qoder

Clone the repository, build once inside the clone, then from the clone run one line, replacing the folder with the user's project:

```text
node scripts/install-host.mjs --host trae --target <project-folder>
node scripts/install-host.mjs --host qoder --target <project-folder>
```

### Claude Desktop

No tested route yet; a one-click bundle is planned. Say so plainly rather than improvising.

## Check at the end

1. The tool list includes `zotero_whoami` (and the `fulltext_*` tools, which are optional). If `zotero_whoami` is missing, say "My search tools are not connected yet", name the step that failed, and give one next action.
2. Report in this shape:

```text
Works now
  <what the user can do today>
Needs you (<count>)
  <one line each: what, and the single action>
Optional
  Journal partition columns in Zotero: install the add-on (one file)
```

The add-on is a separate file the user installs by hand: download `literature-metrics-*.xpi` from https://github.com/Frankkk1912/ai4s-literature-workbench/releases, then in Zotero choose Tools, Add-ons, the gear menu, Install Add-on From File. Do not offer to build it.
