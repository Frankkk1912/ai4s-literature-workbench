# Install guide for agents

This file is the only source of install steps. A step that is not here does not exist: do not invent one. There is no model API key, no Windows installer and no SmartScreen step. `install-manifest.json` holds the same routes in machine-readable form.

## Rules

1. Run what you can yourself. The user only approves prompts, restarts the app, or clicks where this file says. Tell them up front that you may ask to reach GitHub or the network and that they should choose Allow.
2. Use the route for the app and entry point below. Claude Code terminal, the desktop Code tab, and desktop Chat have different install steps. If the plugin's skills are visible but `setup_status` and `zotero_*` tools are absent, and this looks like Claude desktop Chat or cannot run commands, use the Chat route without asking which app. Ask once only when the host is genuinely unclear.
3. When a step fails, go to the next route for that app without asking, and say which step failed and why. Ask only when a step needs the user. If every route fails, name the last failed step and stop.
4. Never ask for a key in chat and never put one in a command, a file or a tool argument. Keys are optional and search works without any. Keys go only through `open_setup` (see "Onboarding").
5. Do not approve a prompt for the user (for example Claude Desktop's Install screen), and do not unpack or edit anything this file does not name.
6. Do not say anything works until "Check at the end" has passed. Report what works now and what needs the user; do not say "runtime not built" or "not configured" (`setup_status` words these).
7. A fetch tool that returns only a summary of a page is not enough. Download the raw file, or clone the repository.
8. The `ai4s-setup` skill runs this whole file for the user. Use it when it is available.

## Pick the route

| You are in | Route | Skills loaded |
| --- | --- | --- |
| Claude Code terminal | [Claude Code terminal](#claude-code-terminal) | yes |
| Claude desktop Code tab | [Claude desktop Code tab](#claude-desktop-code-tab) | yes |
| Codex | [Codex](#codex) | yes |
| ChatGPT desktop | [ChatGPT desktop](#chatgpt-desktop) | no, on the config file route |
| WorkBuddy | [WorkBuddy](#workbuddy) | no, on the `mcp.json` route |
| CodeBuddy | [CodeBuddy](#codebuddy) | yes |
| Trae, Qoder | [Trae and Qoder](#trae-and-qoder) | yes |
| Claude desktop Chat | [Claude desktop Chat](#claude-desktop-chat) | yes via plugin upload; tools need two separate `.mcpb` installs |

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

**Node.js.** Running archive or source tools needs Node.js 22.13 or newer (check `node --version`), except the Claude Desktop `.mcpb`. Uploading the zip for skills-only Chat does not need Node.js. If it is missing or older, say "I need Node.js, a free standard tool, installed first", give https://nodejs.org/ (current LTS), and re-run once it is installed.

## Routes

Where a route names the GitHub address, an extracted archive folder can stand in for it. Only the `marketplace add` call has been seen to accept a local folder (Codex), so if the app rejects the folder, say so and use source.

### Claude Code terminal

```text
claude plugin marketplace add Frankkk1912/ai4s-literature-workbench
claude plugin install ai4s-literature-workbench@ai4s-literature-workbench
```

If the `claude` command is not found or is blocked, ask the user to type these in the terminal Claude Code prompt, one at a time. These `/plugin` install commands are for the terminal, not the desktop Code tab. Do not switch to the Claude Desktop `.mcpb`, which has no skills.

```text
/plugin marketplace add Frankkk1912/ai4s-literature-workbench
/plugin install ai4s-literature-workbench@ai4s-literature-workbench
```

Then build once (source only) and restart Claude Code.

### Claude desktop Code tab

In this tab, `/plugin` opens Settings → Plugins; it does not execute the terminal install commands.

1. Prefer the release zip from "Get the files": download `ai4s-literature-workbench-<version>.zip` and check its checksum. In Settings → Plugins, choose Add → Upload plugin and select the zip. Upload and recognition of both local servers and all four skills are verified on Mac with v0.2.0. That published zip's relative MCP paths fail to start; MCP startup with this repository's path fix is not yet verified in the desktop app. Do not claim the published asset already contains the fix.
2. Alternative (unverified): choose Add → Add marketplace and enter `Frankkk1912/ai4s-literature-workbench`, then install the plugin. Build once for this GitHub source route.
3. Run `/reload-plugins` or start a new session, then run "Check at the end". The plugin uses `${CLAUDE_PLUGIN_ROOT}` for both servers, so the session's working folder need not be the plugin folder.

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

### Claude desktop Chat

**1. Upload the plugin for skills.** Download and check the release zip as above, then choose Settings → Plugins → Add → Upload plugin. Verified on Mac with v0.2.0: all four skills (`literature-research`, `literature-manager`, `literature-writing`, `ai4s-setup`) appear in Chat's `/` menu, but no MCP tools appear. Plugin uploads are stored on the claude.ai account and sync across Chat, Cowork and Code. Chat ignores plugin-local MCP servers, including plugin-declared `.mcpb` bundles; Code loads them. See the official platform matrix:

https://claude.com/docs/plugins/platform-support

This is a skills-only install in Chat, not a failed tool connection. To add both tool servers, install the two separate desktop extensions below; uploading the zip is not enough.

**2. Install two separate `.mcpb` desktop extensions (both unverified live).** One provides Zotero tools; the other provides OA-first full-text fetch and PDF verification, with no Zotero credentials or institutional login. These are separate extension installs, not `.mcpb` bundles declared inside the uploaded plugin. CI builds and validates both.

- Download both `ai4s-literature-zotero-<version>.mcpb` and `ai4s-literature-fulltext-<version>.mcpb` from the release assets and check each against `SHA256SUMS.txt`. If either file is missing or not listed, say so and stop; do not use a file whose checksum differs.
- With a shell, open each file so its install screen appears (unverified; relies on Claude Desktop being the app registered for `.mcpb`). Mac: `open <file>`. Windows: `start "" <file>`. With no shell, or if it does not open, hand each file to the user and say it is not installed until they open it (double-click, or drag it onto the Claude Desktop window).
- For Zotero, the user leaves both optional settings alone (Zotero key empty, Zotero desktop connection `auto`) and presses Install. For fulltext, press Install; there are no required settings or keys, and storage paths and limits use automatic defaults. Nothing works until the user installs the extensions.
- They need no separate Node.js because Claude Desktop ships its own. That Node version is unconfirmed and both bundles ask for 22.13 or newer. If the install screen refuses either or the tools do not start, say so; offer the user-only last resort below, or stop if they decline.
- Restart Claude Desktop and check for `setup_status` and the six `fulltext_*` tools; call `fulltext_capabilities` before claiming fulltext is connected.

**3. Last resort: user-managed config (unverified).** Only if the extension route fails and the user chooses it, give them this JSON to paste themselves. Never read, create, back up, or edit files under `~/Library/Application Support/Claude/` as an agent: this is protected on Mac and agent access was denied in the live test. Do not retry permission requests. Do not edit the Windows config on the user's behalf either.

The user backs up `claude_desktop_config.json`, keeps existing servers, and adds only the missing entries for both servers. File: `~/Library/Application Support/Claude/claude_desktop_config.json` (Mac), `%APPDATA%\Claude\claude_desktop_config.json` (Windows). Needs Node.js 22.13 or newer and an extracted archive. Replace `<absolute-node-path>` and `<plugin-root>` with real absolute paths. This fallback connects both tool servers but does not load skills. Use only the archive's env: the Zotero workbench profile, with no env overrides for fulltext.

```json
{
  "mcpServers": {
    "ai4s-literature-zotero": {
      "command": "<absolute-node-path>",
      "args": ["<plugin-root>/runtime/bundle/index.mjs"],
      "env": { "LITERATURE_ZOTERO_MCP_TOOL_PROFILE": "workbench" }
    },
    "ai4s-literature-fulltext": {
      "command": "<absolute-node-path>",
      "args": ["<plugin-root>/fulltext-runtime/bundle/index.mjs"]
    }
  }
}
```

Ask the user to quit Claude Desktop completely and reopen it, then check for `setup_status` and `fulltext_capabilities`.

## Duplicate Zotero tool sets

Every route in this file installs the current tool server under the name
`ai4s-literature-zotero` — the `.mcpb` manifests, the plugin `.mcp.json`, and
the config snippets all use it. An older desktop extension from this project
was published as `literature-zotero-mcp` (display name “Literature Zotero
MCP”); it is retired and no route here installs it. `setup_status` and
`zotero_whoami` report this server's name and version, so you can always tell
which one answered.

If the host shows two sets of Zotero tools at once — for example tool prefixes
from both `ai4s-literature-zotero` and `literature-zotero-mcp`, or a second
`setup_status`-like tool — the old desktop extension is still installed. Two
copies do not share settings: a key saved through one is invisible to the
other, and edits can land in the wrong one. Do not uninstall anything yourself,
and never read or edit files under `~/Library/Application Support/Claude/`.
Ask the user to remove the old one:

1. In Claude Desktop, open Settings → Extensions.
2. Find `literature-zotero-mcp` (shown as “Literature Zotero MCP”).
3. Use its Remove (Uninstall) control, then restart Claude Desktop.
4. Run "Check at the end" again with the remaining `ai4s-literature-zotero`
   tools.

Only the retired `literature-zotero-mcp` goes; `ai4s-literature-zotero` and
`ai4s-literature-fulltext` stay. In other hosts without an Extensions list,
the same rule applies: remove the entry named `literature-zotero-mcp` from
that host's tool or server list, keep the ones named `ai4s-literature-*`.

## Check at the end

1. The tool list includes `setup_status` (the `fulltext_*` tools are optional). If it is missing, say "My search tools are not connected yet", name the step that failed, give one next action, and stop. Otherwise call it and show its `rendered` text. When the rendered Network check shows a required endpoint unreachable, do not report online search under Works now — the status itself has moved it to Needs you; show the failure lines instead. If your host also lists Zotero tools from `literature-zotero-mcp` ("Literature Zotero MCP"), follow [Duplicate Zotero tool sets](#duplicate-zotero-tool-sets).
2. Run one real search so the user sees a result. From the folder that holds `literature-research/`, in a private temporary folder, with `uv run` replaced by `search_helper.run` from `setup_status` (`run.posix` or `run.powershell`):

   ```text
   uv run literature-research/scripts/literature_search.py review --question "setup check" --pubmed-query "CRISPR base editing[Title]" --limit 3 --top-n 3 --output <private-temp>/ai4s-setup-check
   ```

   Show the first titles from the selected-paper table in `report.md`. If it fails, say the search did not run and give the one reason in plain words.

   Config-only routes (ChatGPT desktop, WorkBuddy, user-managed Claude config) and a standalone `.mcpb` install do not load `literature-research/`. Run it from the archive or clone if one is on disk. If not, call `zotero_search_items` with a short query instead and show the result; if Zotero desktop is not running, say that is what the user must do. Say which check you ran. Do not say PubMed search works unless the real search ran.
3. Report in this shape:

   ```text
   Works now
     <what the user can do today>
   Needs you (<count>)
     <one line each: what, and the single action>
   Optional (I can set these up now)
     Key page: <only keys setup_status reports as not configured, with what each unlocks>
     <if all three are set instead: All keys are set; ask for the key page any time to change one.>
     Journal partition columns in Zotero: install the add-on (one file)
   ```

4. Use `setup_status.diagnostics` presence flags (`zotero_key_present`, `pubmed_key_present`, `easyscholar_key_present`) to select only missing keys for the Key page line; do not infer a missing key from a local Zotero save option or a pending restart. Never print diagnostics or key values. If all three are configured, replace that line with exactly: "All keys are set; ask for the key page any time to change one." This counts as mentioning key onboarding. If status is unavailable, do not guess which keys are missing.
5. Offer the onboarding (next section) in the same message. Ask once about missing keys and the add-on, not keys already set, and wait. Do not end with only the report.

## TLS and proxies

Certificate verification is on by default and is never disabled silently. If a
school or company gateway re-signs traffic, export its root certificate as a
PEM file and set one of these, then restart: `SSL_CERT_FILE` or
`REQUESTS_CA_BUNDLE` (the search scripts and the tool servers' outbound
requests), or `NODE_EXTRA_CA_CERTS` (Node itself). The Python scripts also use
the system certificate store when the optional `truststore` package is
installed (`uv add truststore`), and Node 22.15+ can with
`NODE_USE_SYSTEM_CA=1`. An invalid CA path is a clear startup error, never a
silent skip. `LITERATURE_TLS_INSECURE=1` exists only as an explicit, loudly
warned last resort on a trusted private network; the workbench never turns
verification off on its own. `setup_status`'s Network check section shows which
endpoints are reachable and carries the same fix text when a certificate
fails.

## Onboarding

Both parts are optional. Mention them once after the check, because a user who is not told will not find them. Offer only keys that `setup_status` reports as missing; when all are set, use the all-keys sentence above instead of asking to configure them again. Still offer the add-on. Never press for either.

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
