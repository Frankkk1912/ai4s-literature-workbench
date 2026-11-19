# Install guide for agents

This file is the only source of install steps. If a step you want is not here, it does not exist for this project: do not invent one. In particular there is no model API key to set, no Windows installer, and no SmartScreen step. `install-manifest.json` holds the same routes in machine-readable form.

## Rules

1. Follow the route for the user's app below, in order. Run what you can yourself; the user only approves prompts.
2. Tell the user up front that you may ask for permission to reach GitHub or the network, and that they should choose Allow.
3. Never ask for a key in chat and never put one in a command. Keys are optional, and search works without any. Keys go only into the page that the `open_setup` tool opens (see "Keys" below).
4. Report results as what works now and what needs the user. Do not say "runtime not built" or "not configured". The `setup_status` tool already words them that way.
5. Do not say anything works until the check at the end of this file has passed.
6. The `ai4s-setup` skill runs this whole file for the user. Use it when it is available.

## Get the files: release archive or source

There are two ways to get the plugin folder. Prefer the release archive when it is current, because it needs no build.

**Which one.** Read `version` from `.codex-plugin/plugin.json` on the `main` branch:

https://raw.githubusercontent.com/Frankkk1912/ai4s-literature-workbench/main/.codex-plugin/plugin.json

Read the latest release at https://github.com/Frankkk1912/ai4s-literature-workbench/releases/latest. The release version is the tag without a leading `v`. The archive file is `ai4s-literature-workbench-<version>.zip`. Compare the two versions as dotted numbers from the left (`0.2.0` is newer than `0.1.9`; equal counts as current). Use the release archive only when that release version is the same or newer than main, and the zip is listed. If the release version is older than main, or the zip is not listed, use the source route and say which of those two it was. Compare with main. The copy of `plugin.json` inside an archive matches that release, so it cannot answer this check.

The v0.1.0 release publishes `ai4s-literature-workbench-0.1.0.zip`. CI builds and checks the archive. Installing it through a host has not been tested.

**Release archive (no build).** Download `ai4s-literature-workbench-<version>.zip` from https://github.com/Frankkk1912/ai4s-literature-workbench/releases/latest and extract it. The extracted folder is `<plugin-root>`. It already contains the prebuilt tools in `runtime/bundle/` and `fulltext-runtime/bundle/`, so skip the build step below. `SHA256SUMS.txt` on the same page lists the expected checksum of each file. In every route below, use this folder wherever the route names the GitHub address.

The archive still needs Node.js 22.13 or newer on the computer for every app except Claude Desktop (see the `.mcpb` route). Check with `node --version`.

**Double-click setup files (archive only).** The archive's top folder has `Setup AI4S.bat` (Windows) and `Setup AI4S.command` (Mac). Double-clicking one opens the key page without any agent. They are for apps whose sandbox cannot start a server or open a browser. They need Node.js 22.13 or newer. On a Mac the first double-click may be blocked as coming from an unidentified developer: right-click the file, choose Open, then Open.

**Source (build once).** Installing from the GitHub address copies source only. The `dist/` folders are build output and are not in git, so the tools do not exist until you run this once:

```text
node <plugin-root>/scripts/bootstrap.mjs
```

`<plugin-root>` is the folder that contains `scripts/bootstrap.mjs` and `.mcp.json`. Search for it; do not guess. Run the script with `node`, not with `.ps1` or `.sh` files, on every system.

It needs Node.js 22.13 or newer. If `node --version` fails or is older, say: "I need Node.js, a free standard tool, installed first", and give https://nodejs.org/ (current LTS). Re-run after it is installed.

How to tell which one you have: if `<plugin-root>/runtime/bundle/index.mjs` exists, it is the archive and nothing needs building.

## Keys

Every key is optional. Search, ranking and writing need none. Ask only for a key that unlocks something the user asked for: a Zotero key to save papers into Zotero, a PubMed key for faster PubMed search, an EasyScholar key for journal ratings in reports.

1. Call `setup_status` to see what works now. It answers in plain words in Chinese or English.
2. When a key is wanted, call `open_setup` with only that key in `keys`. It opens the user's browser on a local page that is already signed in. The user reads why the key is useful, follows the link to get it, and pastes it into a masked field. Tell the user to do that, and that you cannot see the key.
3. If `open_setup` reports `opened: false`, give the user `url` and `fallback_code`: they open the address and type the code. If the tool is missing or fails, tell them to double-click `Setup AI4S.bat` or `Setup AI4S.command` (archive route). Only if that also fails, give them this one line and tell them how to open a terminal in the plugin folder (Windows: open the folder in File Explorer, click the address bar, type `cmd`, press Enter; Mac: right-click the folder, choose New Terminal at Folder):

```text
node runtime/bundle/index.mjs --setup
```

   On a source build the file is `runtime/dist/index.js` instead.

4. Call `setup_status` again. A Zotero key takes effect after the app restarts, and `setup_status` says so.

The source route has `scripts/onboard.mjs` for developers. Do not use it, or mention it, on a beginner's computer.

## Routes by app

### Claude Code

```text
claude plugin marketplace add Frankkk1912/ai4s-literature-workbench
claude plugin install ai4s-literature-workbench@ai4s-literature-workbench
```

From a release archive, replace the GitHub address in the first line with the extracted folder's path. This has not been tested with a local folder; if the app rejects it, say so and use the source route. Then build once (source route only), then restart Claude Code.

### Codex

```text
codex plugin marketplace add https://github.com/Frankkk1912/ai4s-literature-workbench.git
codex plugin add ai4s-literature-workbench@personal
```

From a release archive, replace the GitHub address in the first line with the extracted folder's path. This has not been tested with a local folder; if the app rejects it, say so and use the source route. Then build once (source route only), then restart Codex. Codex may block GitHub access until the user approves it.

### ChatGPT desktop

ChatGPT desktop (Windows and Mac) is a Codex-based app. The agent inside the app may not be able to run `codex plugin marketplace add`. Try the routes in order, and say which one you used.

1. **Codex plugin route (unverified).** If the `codex` command is available, run the Codex route above. This has not been tested inside ChatGPT desktop. If the command is missing or it fails, say so and use the next route.
2. **MCP config file (verified on Windows 11 only).** The app reads local MCP servers from `%USERPROFILE%\.codex\config.toml` on Windows and `~/.codex/config.toml` on Mac. Mac has not been tested.

Copy `config.toml` to `config.toml.bak` in the same folder before you change it. If `config.toml.bak` is already there, pick a new backup name and tell the user that name. If `config.toml` does not exist, create it and say so. Keep every existing entry: add tables at the end, and do not rewrite other tables. If `[mcp_servers.ai4s-literature-zotero]` or `[mcp_servers.ai4s-literature-fulltext]` is already present, do not add that server again.

Append the two servers from `.mcp.json`. Use absolute paths for `args` and `cwd`. Forward slashes are fine. The command is `node`, so Node.js 22.13 or newer must be on the computer. From a source checkout, the Windows shape that worked is:

```toml
[mcp_servers.ai4s-literature-zotero]
command = "node"
args = ["<plugin-root>/runtime/dist/index.js"]
cwd = "<plugin-root>"

[mcp_servers.ai4s-literature-zotero.env]
LITERATURE_ZOTERO_MCP_TOOL_PROFILE = "workbench"

[mcp_servers.ai4s-literature-fulltext]
command = "node"
args = ["<plugin-root>/fulltext-runtime/dist/index.js"]
cwd = "<plugin-root>"
```

Replace `<plugin-root>` with the absolute path of the plugin folder. The Windows 11 check used paths of this shape (for example `C:/AI4S/ai4s-literature-workbench/runtime/dist/index.js` with the matching `cwd`) and `LITERATURE_ZOTERO_MCP_TOOL_PROFILE` set to `workbench`. Use the user's folder, not that example path.

Also copy any other `env` keys `.mcp.json` lists for that server into the `[mcp_servers.ai4s-literature-zotero.env]` table. Today those are `ZOTEUS_LOCAL` (`auto`) and `ZOTEUS_EMBEDDINGS` (`off`). The Windows check did not record those two, so they stay unverified. Do not invent keys that `.mcp.json` does not list. The full-text server has no `env` table in `.mcp.json`; do not add one.

From a release archive, point `args` at `<plugin-root>/runtime/bundle/index.mjs` and `<plugin-root>/fulltext-runtime/bundle/index.mjs` instead of the `dist/index.js` files. Those archive paths are unverified on ChatGPT desktop.

Ask the user to restart ChatGPT desktop.

Skills are not loaded by this route. Say so. `ai4s-setup`, `literature-research`, `literature-manager`, and `literature-writing` do not appear. The user still has this file, from the prompt.

### WorkBuddy

Two routes. Try them in order and stop at the first that works. Say which one you used.

1. **Plugin marketplace (unverified).** Not yet tested on WorkBuddy. Per WorkBuddy's plugin documentation, add `https://github.com/Frankkk1912/ai4s-literature-workbench` as a plugin marketplace in the app and install `ai4s-literature-workbench`. Then build once (source route only) and restart.
2. **MCP config file (verified on Windows 11).** If the marketplace route does not work, add the two servers below to `~/.workbuddy/mcp.json` (on Windows, `%USERPROFILE%\.workbuddy\mcp.json`). The file is named `mcp.json`, with no leading dot, unlike this repository's `.mcp.json`. Do not create a second file under another name. Add to the existing `mcp.json` if there is one. Keep servers already in the file. If a server name below is already present, do not add it again.

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

Replace `<plugin-root>` with the absolute path. From a release archive, use `runtime/bundle/index.mjs` and `fulltext-runtime/bundle/index.mjs` as the two entry files instead of the `dist/index.js` ones. Those archive paths were not part of the Windows test, so they stay unverified. Mac was not part of it either.

Verified on Windows 11 for this MCP file route: both servers load, `setup_status` works, `install_search_helper` installs uv 0.13.7, and a real PubMed search wrote `report.md`. Ask the user to restart WorkBuddy after the file changes.

If neither route works, tell the user which step failed and stop.

### CodeBuddy (unverified)

Not yet tested on CodeBuddy. Inside CodeBuddy:

```text
/plugin marketplace add Frankkk1912/ai4s-literature-workbench
/plugin install ai4s-literature-workbench@ai4s-literature-workbench
```

Then build once (source route only) and restart.

### Trae and Qoder

Clone the repository and build once inside the clone, or extract the release archive (no build). Then from that folder run one line, replacing the folder with the user's project:

```text
node scripts/install-host.mjs --host trae --target <project-folder>
node scripts/install-host.mjs --host qoder --target <project-folder>
```

### Claude Desktop (unverified)

Not yet tested in Claude Desktop. The release page lists `ai4s-literature-zotero-<version>.mcpb`. Download it and double-click it, or drag it onto the Claude Desktop window. Claude Desktop shows an install screen with two optional settings: a Zotero key (leave empty to search and read without one) and the Zotero desktop connection (leave on `auto`). Do not paste a key into chat. The same key page is available later: `open_setup` opens it from this file's tools. This file installs only the Zotero tools. It does not install the three skills or the full-text tools, and it should need no separate Node.js, because Claude Desktop ships its own. Which Node version that is has not been confirmed, and the bundle asks for 22.13 or newer. If the install screen refuses it or the tools do not start, say so and stop. If the release page does not list this file, say so plainly rather than improvising.

## Check at the end

1. The tool list includes `setup_status` (and the `fulltext_*` tools, which are optional). If `setup_status` is missing, say "My search tools are not connected yet", name the step that failed, and give one next action. Then call it and use its `rendered` text.
2. Run one tiny real search, so the user sees a result rather than a file-exists check. In a private temporary folder, from the folder that holds `literature-research/`, with `uv run` replaced by `search_helper.run` from `setup_status` (`run.posix` or `run.powershell`): `uv run literature-research/scripts/literature_search.py review --question "setup check" --pubmed-query "CRISPR base editing[Title]" --limit 3 --top-n 3 --output <private-temp>/ai4s-setup-check`. Show the first titles from the selected-paper table in `report.md`. If it fails, say the search did not run and give the one reason in plain words.
3. Report in this shape:

```text
Works now
  <what the user can do today>
Needs you (<count>)
  <one line each: what, and the single action>
Optional
  Journal partition columns in Zotero: install the add-on (one file)
```

The add-on is a separate file the user installs by hand: download `literature-metrics-*.xpi` from https://github.com/Frankkk1912/ai4s-literature-workbench/releases, then in Zotero choose Tools, Add-ons, the gear menu, Install Add-on From File. Do not offer to build it.
