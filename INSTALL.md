# Install guide for agents

This file is the only source of install steps. A step that is not here does not exist: do not invent one. There is no model API key, no Windows installer and no SmartScreen step. `install-manifest.json` holds the same routes in machine-readable form.

## Rules

1. Run what you can yourself. The user only approves prompts, restarts the app, or clicks where this file says. Tell them up front that you may ask to reach GitHub or the network and that they should choose Allow.
2. Use the route for the app you are running inside (table below). The Claude desktop app's Code tab is Claude Code. If you cannot tell which app you are in, ask once.
3. When a step fails, go to the next route for that app without asking, and say which step failed and why. Ask only when a step needs the user. If every route fails, name the last failed step and stop.
4. Never ask for a key in chat and never put one in a command, a file or a tool argument. Keys are optional and search works without any. Keys go only through `open_setup` (see "Onboarding").
5. Do not approve a prompt for the user (for example Claude Desktop's Install screen), and do not unpack or edit anything this file does not name.
6. Do not say anything works until "Check at the end" has passed. Report what works now and what needs the user; do not say "runtime not built" or "not configured" (`setup_status` words these).
7. A fetch tool that returns only a summary of a page is not enough. Download the raw file, or clone the repository.
8. The `ai4s-setup` skill runs this whole file for the user. Use it when it is available.

## Pick the route

| You are in | Route | Skills loaded |
| --- | --- | --- |
| Claude Code (CLI or the desktop app's Code tab) | [Claude Code](#claude-code) | yes |
| Codex | [Codex](#codex) | yes |
| ChatGPT desktop | [ChatGPT desktop](#chatgpt-desktop) | no, on the config file route |
| WorkBuddy | [WorkBuddy](#workbuddy) | no, on the `mcp.json` route |
| CodeBuddy | [CodeBuddy](#codebuddy) | yes |
| Trae, Qoder | [Trae and Qoder](#trae-and-qoder) | yes |
| Claude Desktop chat app | [Claude Desktop](#claude-desktop) | no |

## Get the files

Needed by every route except the Claude Desktop `.mcpb`. `<plugin-root>` is the folder that contains `scripts/bootstrap.mjs` and `.mcp.json`. Search for it; do not guess.

**1. Choose archive or source.** Use the archive when its release is the same or newer than `main`, and the zip is listed. Otherwise use source and say which condition failed.

- `main` version: `version` in https://raw.githubusercontent.com/Frankkk1912/ai4s-literature-workbench/main/.codex-plugin/plugin.json
- Release version: the tag of https://github.com/Frankkk1912/ai4s-literature-workbench/releases/latest without the leading `v`. If the page or the API will not load, the redirect gives the tag: `curl -sIL -o /dev/null -w '%{url_effective}' https://github.com/Frankkk1912/ai4s-literature-workbench/releases/latest`
- Compare as dotted numbers from the left (`0.2.0` is newer than `0.1.9`; equal is current). Never use the `plugin.json` inside an archive for this check.
- The zip is listed when `ai4s-literature-workbench-<version>.zip` appears in `SHA256SUMS.txt`.

**2a. Archive (no build).** Download from `https://github.com/Frankkk1912/ai4s-literature-workbench/releases/latest/download/<file>`: the zip and `SHA256SUMS.txt`. Check the zip (`shasum -a 256 <file>` on Mac, `Get-FileHash <file>` in PowerShell) and do not use it if the checksum differs. Extract it; that folder is `<plugin-root>`. It already holds `runtime/bundle/` and `fulltext-runtime/bundle/`.

**2b. Source (build once).** `dist/` is build output and is not in git, so run this once after cloning or after installing from the GitHub address:

```text
node <plugin-root>/scripts/bootstrap.mjs
```

Run it with `node`, never with `.ps1` or `.sh` files.

**Which one you have:** `<plugin-root>/runtime/bundle/index.mjs` exists means archive, so nothing needs building.

**Node.js.** Archive and source both need Node.js 22.13 or newer (check `node --version`), except the Claude Desktop `.mcpb`. If it is missing or older, say "I need Node.js, a free standard tool, installed first", give https://nodejs.org/ (current LTS), and re-run once it is installed.

## Routes

Where a route names the GitHub address, an extracted archive folder can stand in for it. Only the `marketplace add` call has been seen to accept a local folder (Codex), so if the app rejects the folder, say so and use source.

### Claude Code

```text
claude plugin marketplace add Frankkk1912/ai4s-literature-workbench
claude plugin install ai4s-literature-workbench@ai4s-literature-workbench
```

If the `claude` command is not found or is blocked, ask the user to type these in the Claude Code prompt, one at a time. Do not switch to the Claude Desktop `.mcpb`, which has no skills.

```text
/plugin marketplace add Frankkk1912/ai4s-literature-workbench
/plugin install ai4s-literature-workbench@ai4s-literature-workbench
```

Then build once (source only) and restart Claude Code.

### Codex

```text
codex plugin marketplace add https://github.com/Frankkk1912/ai4s-literature-workbench.git
codex plugin add ai4s-literature-workbench@ai4s-literature-workbench
```

The text after `@` is the marketplace name Codex registered. It registered `ai4s-literature-workbench`, not `personal` (the name in `.codex-plugin/marketplace.json` has no effect). If `plugin add` says the plugin is not found, read the name from `codex plugin marketplace list` and use that. If it still fails, use the `config.toml` route under ChatGPT desktop (same file, no skills). Then build once (source only) and restart Codex. Codex may block GitHub until the user approves.

### ChatGPT desktop

A Codex-based app. The agent inside it may not be able to run `codex`. Try in order and say which you used.

**1. Codex plugin route (unverified).** If `codex` exists, run the Codex route above. Adding the marketplace worked here once; the plugin install is not confirmed. On any failure go to route 2.

**2. MCP config file (verified on Windows 11 for the source shape; Mac and archive paths unverified).**

- File: `%USERPROFILE%\.codex\config.toml` (Windows), `~/.codex/config.toml` (Mac).
- Copy it to `config.toml.bak` first. If that exists, pick a new name and tell the user. If `config.toml` is missing, create it and say so.
- Append the tables below at the end. Keep every existing entry. If `[mcp_servers.ai4s-literature-zotero]` or `[mcp_servers.ai4s-literature-fulltext]` already exists, do not add it again.
- Use absolute paths; forward slashes are fine. For a source build, use `runtime/dist/index.js` and `fulltext-runtime/dist/index.js` instead of the bundle paths.

```toml
[mcp_servers.ai4s-literature-zotero]
command = "node"
args = ["<plugin-root>/runtime/bundle/index.mjs"]
cwd = "<plugin-root>"

[mcp_servers.ai4s-literature-zotero.env]
LITERATURE_ZOTERO_MCP_TOOL_PROFILE = "workbench"

[mcp_servers.ai4s-literature-fulltext]
command = "node"
args = ["<plugin-root>/fulltext-runtime/bundle/index.mjs"]
cwd = "<plugin-root>"
```

Add no other `env` keys, and no `env` table for the full-text server.

Ask the user to restart ChatGPT desktop. Skills are not loaded by this route. Say so: `ai4s-setup`, `literature-research`, `literature-manager` and `literature-writing` do not appear.

### WorkBuddy

Try in order and say which you used.

**1. Plugin marketplace (unverified).** Add `https://github.com/Frankkk1912/ai4s-literature-workbench` as a plugin marketplace in the app and install `ai4s-literature-workbench`. Then build once (source only) and restart.

**2. MCP config file (verified on Windows 11 for the source shape; Mac and archive paths unverified).**

- File: `~/.workbuddy/mcp.json` (Windows: `%USERPROFILE%\.workbuddy\mcp.json`). The name has no leading dot, unlike this repository's `.mcp.json`. Do not create a second file under another name.
- Add to the existing file. Keep servers already in it. If a name below is present, do not add it again.
- For a source build, use `runtime/dist/index.js` and `fulltext-runtime/dist/index.js` instead of the bundle paths.

```json
{
  "mcpServers": {
    "ai4s-literature-zotero": {
      "command": "node",
      "args": ["<plugin-root>/runtime/bundle/index.mjs"],
      "cwd": "<plugin-root>",
      "env": { "LITERATURE_ZOTERO_MCP_TOOL_PROFILE": "workbench" }
    },
    "ai4s-literature-fulltext": {
      "command": "node",
      "args": ["<plugin-root>/fulltext-runtime/bundle/index.mjs"],
      "cwd": "<plugin-root>"
    }
  }
}
```

Ask the user to restart WorkBuddy. The Windows 11 check (source paths): both servers loaded, `setup_status` worked, `install_search_helper` installed uv 0.13.7, and a real PubMed search wrote `report.md`.

If `setup_status` is still missing after the restart, WorkBuddy may not have switched on the new custom servers (seen once, with both servers starting fine when run by hand). Check that `mcp.json` has both names, the paths exist, and `node --version` is 22.13 or newer. Then ask the user to open WorkBuddy's connector (MCP) settings and switch on or trust `ai4s-literature-zotero` and `ai4s-literature-fulltext` under the custom connectors. Menu names are unconfirmed, so describe where to look. Re-run the check. If it still fails, name this step and stop.

### CodeBuddy

Unverified.

```text
/plugin marketplace add Frankkk1912/ai4s-literature-workbench
/plugin install ai4s-literature-workbench@ai4s-literature-workbench
```

Then build once (source only) and restart.

### Trae and Qoder

From the clone (built once) or the extracted archive, replace the folder with the user's project:

```text
node scripts/install-host.mjs --host trae --target <project-folder>
node scripts/install-host.mjs --host qoder --target <project-folder>
```

### Claude Desktop

Only for the Claude Desktop chat app. Both routes are unverified. Try in order and say which you used. Neither loads the skills.

**1. Config file (no clicks).** Needs Node.js 22.13 or newer and the extracted archive (the servers run from `bundle/index.mjs`). Installs the Zotero and the full-text tools.

- File: `~/Library/Application Support/Claude/claude_desktop_config.json` (Mac), `%APPDATA%\Claude\claude_desktop_config.json` (Windows). Create it if missing and say so.
- Copy it to `claude_desktop_config.json.bak` first. If that exists, pick a new name and tell the user.
- Add the entries below under `mcpServers`. Keep existing entries. If a name is present, do not add it again. Absolute paths; forward slashes are fine on Windows.

```json
{
  "mcpServers": {
    "ai4s-literature-zotero": {
      "command": "node",
      "args": ["<plugin-root>/runtime/bundle/index.mjs"],
      "env": { "LITERATURE_ZOTERO_MCP_TOOL_PROFILE": "workbench" }
    },
    "ai4s-literature-fulltext": {
      "command": "node",
      "args": ["<plugin-root>/fulltext-runtime/bundle/index.mjs"]
    }
  }
}
```

- Ask the user to quit Claude Desktop completely and reopen it.
- If `setup_status` is still missing, the app probably cannot find `node`. Put the full path (`which node` on Mac, `where node` on Windows) in `command` for both entries, for example `"command": "/usr/local/bin/node"`, and ask for one more restart.
- If a server still does not start, say so and use route 2.

**2. `.mcpb` bundle (the user clicks Install once).** Installs the Zotero tools only, not the full-text tools.

- Download `ai4s-literature-zotero-<version>.mcpb` from the release assets and check it against `SHA256SUMS.txt`. If it is not listed, say so and stop.
- With a shell, open it so the install screen appears (unverified; relies on Claude Desktop being the app registered for `.mcpb`). Mac: `open <file>`. Windows: `start "" <file>`. With no shell, or if it does not open, hand the file to the user and say it is not installed until they open it (double-click, or drag it onto the Claude Desktop window).
- The user leaves both settings alone (Zotero key empty, Zotero desktop connection `auto`) and presses Install. Nothing works until then.
- It needs no separate Node.js because Claude Desktop ships its own. That Node version is unconfirmed and the bundle asks for 22.13 or newer. If the install screen refuses it or the tools do not start, say so and stop.

## Check at the end

1. The tool list includes `setup_status` (the `fulltext_*` tools are optional). If it is missing, say "My search tools are not connected yet", name the step that failed, give one next action, and stop. Otherwise call it and show its `rendered` text.
2. Run one real search so the user sees a result. From the folder that holds `literature-research/`, in a private temporary folder, with `uv run` replaced by `search_helper.run` from `setup_status` (`run.posix` or `run.powershell`):

   ```text
   uv run literature-research/scripts/literature_search.py review --question "setup check" --pubmed-query "CRISPR base editing[Title]" --limit 3 --top-n 3 --output <private-temp>/ai4s-setup-check
   ```

   Show the first titles from the selected-paper table in `report.md`. If it fails, say the search did not run and give the one reason in plain words.

   Routes without skills (ChatGPT desktop, WorkBuddy and Claude Desktop file routes, the `.mcpb`) have no `literature-research/` in the host. Run it from the archive or clone if one is on disk. If not, call `zotero_search_items` with a short query instead and show the result; if Zotero desktop is not running, say that is what the user must do. Say which check you ran. Do not say PubMed search works unless the real search ran.
3. Report in this shape:

   ```text
   Works now
     <what the user can do today>
   Needs you (<count>)
     <one line each: what, and the single action>
   Optional (I can set these up now)
     Key page: Zotero key (save papers into Zotero), PubMed key (faster search), EasyScholar key (journal ratings)
     Journal partition columns in Zotero: install the add-on (one file)
   ```

4. Offer the onboarding (next section) in the same message, ask once which the user wants, and wait. Do not end with only the report.

## Onboarding

Both parts are optional. Never press for either, but always offer them once after the check, because a user who is not told will not find them.

**Key page.** Each key unlocks one thing: Zotero (save papers into Zotero), PubMed (faster PubMed search), EasyScholar (journal ratings in reports).

1. Call `open_setup` with only the wanted key in `keys`. It opens the user's browser on a local page that is already signed in. The user follows the link to get the key and pastes it into a masked field. Tell them you cannot see it.
2. If `open_setup` reports `opened: false`, give the user `url` and `fallback_code`: they open the address and type the code.
3. If the tool is missing or fails, tell them to double-click `Setup AI4S.bat` (Windows) or `Setup AI4S.command` (Mac) in the archive's top folder. On a Mac the first double-click may be blocked: right-click the file, choose Open, then Open.
4. Only if that also fails, give this one line and say how to open a terminal in the plugin folder (Windows: open the folder in File Explorer, click the address bar, type `cmd`, press Enter; Mac: right-click the folder, choose New Terminal at Folder):

   ```text
   node runtime/bundle/index.mjs --setup
   ```

   On a source build the file is `runtime/dist/index.js`.
5. Call `setup_status` again. A Zotero key takes effect after the app restarts and `setup_status` says so; ask for a restart and re-check.

`scripts/onboard.mjs` is for developers. Do not use it, or mention it, on a beginner's computer.

**Zotero add-on (journal partition columns).** A separate file the user installs by hand: https://github.com/Frankkk1912/ai4s-literature-workbench/releases/latest/download/literature-metrics.xpi. Offer to download it if the host allows downloads; otherwise give the link. In Zotero: Tools, Add-ons, the gear menu, Install Add-on From File, pick the file, restart Zotero. The columns need an EasyScholar key to fill in, so mention that. Do not build it, and do not say it works until the columns appear after the restart.

If the user wants none of it, say they can ask for "the key page" later and you will call `open_setup`.
