---
name: ai4s-setup
description: >-
  First-run setup for the AI4S Literature Workbench: connect search tools, show
  what works and what needs the user, add optional Zotero, PubMed, or EasyScholar
  keys on a masked page (never in chat), then run a real search. Use for set up,
  install, configure, or add a key; when a skill says "My search tools are not
  connected yet"; or to save to Zotero, speed up PubMed, or show journal ratings.
---

# AI4S Setup

This skill owns first-run. The user should type no commands: they approve a
prompt, click a link, or paste a key into a masked page that opens in their
browser. Do everything else yourself.

## Rules

1. `INSTALL.md` in the plugin root is the only source of install steps. If a
   step you want is not there, it does not exist: do not invent one. In
   particular there is no model API key, no Windows installer, and no
   SmartScreen step.
2. Never ask for a key in chat and never put one in a command, a file you write,
   or a tool argument. Keys go only into the page that `open_setup` opens.
3. Ask only for a key that unlocks something the user asked for. Search needs
   no key, so never open the page "just in case".
4. Speak in the language the user writes in (Chinese if unsure). Use no
   component names: not "server", "runtime", "bundle", "build" or "not
   configured". Say what the user can do.
5. Do not say anything works until `setup_status` says so.
6. Say once, up front, that you may ask permission to reach the network or
   GitHub, and that they should choose Allow.

## Step 1: Are the tools there?

Call `setup_status` (from the `ai4s-literature-zotero` server). Pass `language`
(`zh` or `en`) and, in `wanted`, what the user asked for: `zotero_save` to save
to Zotero, `pubmed_key` for faster PubMed, `journal_metrics` for journal ratings
in reports, `partition_columns` for the Zotero add-on.

If the tool is not in your tool list, go to Step 2. Otherwise go to Step 3.

## Step 2: Connect the tools

1. First inspect the available skills, tools and host clues. If this plugin's
   skills are visible but neither `setup_status` nor any `zotero_*` tools are
   listed, and the host looks like Claude desktop Chat or cannot run commands,
   conclude: "Claude desktop Chat: the plugin provides skills only." Do not
   ask which app the user uses. Missing tools in this case are an expected Chat
   limitation, not a broken install. Otherwise distinguish Claude Code terminal,
   the desktop Code tab, desktop Chat, Codex, ChatGPT desktop, WorkBuddy,
   CodeBuddy, or Trae/Qoder. ChatGPT desktop means the app, not the website.
   Ask once only when the host is genuinely unclear; missing tools alone in a
   known Code host do not make it Chat.
2. Open `INSTALL.md` in the plugin root (the folder with `INSTALL.md` and
   `install-manifest.json`; search for it, do not guess). If this install has
   only the skills and no `INSTALL.md`, say so and read
   https://raw.githubusercontent.com/Frankkk1912/ai4s-literature-workbench/main/INSTALL.md
3. Follow the route for that app, in order. Prefer the release archive when
   the latest release version is the same or newer than `version` in
   `.codex-plugin/plugin.json` on main, and the zip is listed. If the release
   is older than that version, or it has no archive, use the source route and
   say so. Run what you can yourself; ask the user only to approve a prompt
   or restart the app. ChatGPT desktop: try the Codex plugin route when the
   `codex` command exists; otherwise use the `config.toml` route in
   `INSTALL.md`. Skills are not loaded by that file route, so say so. If a
   step fails, go to the next route for that app without asking the user, and
   say which step failed. In Claude desktop Chat, follow the Chat section:
   upload the zip for four skills (verified on Mac with v0.2.0). Chat ignores
   plugin-local MCP, including plugin-declared `.mcpb` bundles; Code loads them.
   Then download both `ai4s-literature-zotero-<version>.mcpb` and
   `ai4s-literature-fulltext-<version>.mcpb`, check each against `SHA256SUMS.txt`,
   and stop if either file is missing, not listed, or has a different checksum.
   Open each with `open <file>` on Mac or `start "" <file>` on Windows; otherwise
   hand each file to the user to double-click. For Zotero leave optional settings
   default and press Install; for fulltext press Install (no required settings
   or keys; automatic per-user paths and safe limits). Nothing works until the
   user installs them. Both are CI-built/validated, not live-verified. They use
   Desktop's bundled Node (version unconfirmed; requires 22.13+). Fulltext is
   OA-first fetch and PDF verification, with no Zotero credentials or institutional
   login. Check for the six `fulltext_*` tools and call `fulltext_capabilities`
   before claiming fulltext is connected. Never read or edit anything under
   `~/Library/Application Support/Claude/`: it is protected and agent access was
   denied. Do not retry permission requests. The config-file fallback is for
   the user to paste manually, not for you to edit. It includes both archive
   servers: `runtime/bundle/index.mjs` with only
   `LITERATURE_ZOTERO_MCP_TOOL_PROFILE=workbench`, and
   `fulltext-runtime/bundle/index.mjs` with no env overrides. In the desktop Code tab,
   `/plugin` opens Plugins settings: prefer Add → Upload plugin; Add → Add
   marketplace is unverified. Terminal `/plugin` install commands are not for
   that tab. Do not run Steps 3–6 or claim tools work until `setup_status` is
   available; with skills only, explain the limit and give the two-extension step.
4. After the restart, call `setup_status` again. If the tool is still missing,
   say: "My search tools are not connected yet", name the one step that did not
   work, give one next action, and stop. Do not report partial success.

## Step 3: Show where things stand

Show the `rendered` text for the user's language, as the three groups it
already has:

```text
Works now
  Search and rank papers; draft from saved evidence
Needs you (1)
  Save to Zotero: create a Zotero key at <link>, paste it into the page I just opened
Optional
  Journal partition columns in Zotero: install the add-on (one file)
```

Do not read out `diagnostics`. If `search` is under Needs you with the action
`install_helper`, say in one plain sentence that search needs a small helper
tool (about 15 MB, plus about 30 MB of Python if the computer has none it can
use), downloaded into folders in their user account, with no admin rights and
no system settings changed. After a yes, call `install_search_helper`. It
answers within about 40 seconds; while it says `downloading` or
`preparing_python`, tell the user it is still downloading and call it again.
Then call `setup_status` again. Only if it reports `failed` or `unsupported`,
or the action is `ask_to_install`, offer the official installer from the link
in the status text, after a yes.

## Step 4: Add a key (mention onboarding every time)

At the end of every setup, mention the key page and offer the Zotero add-on
(Step 6). On the report's Key page line, list only keys that `setup_status`
reports as not configured: use `diagnostics.zotero_key_present`,
`diagnostics.pubmed_key_present` and `diagnostics.easyscholar_key_present`.
Read these flags without showing diagnostics or key values. A local Zotero
save option or pending restart does not mean a key is missing. If all three
are set, say: "All keys are set; ask for the key page any time to change one."
This counts as mentioning key onboarding; do not ask to configure those keys
again. If status is unavailable, do not guess. Never press for a key or skip
this mention. Open the page at once for a key the user explicitly asks to add
or change.

One key at a time. For each key the user wants:

1. Say in one plain sentence what it unlocks and that search works without it.
   Zotero: saving papers into their library. PubMed: faster, steadier PubMed
   search. EasyScholar: journal ratings in reports. Before asking for a Zotero
   key, check the Zotero line in `setup_status`: reading their library needs no
   key, only Zotero open with "Allow other applications on this computer to
   communicate with Zotero" ticked (Settings, Advanced), and with Zotero 10 or
   later saving needs no key either: Zotero asks once in its own window and
   they choose Always Allow.
2. Call `open_setup` with `keys` set to just that key and the user's `language`.
3. Tell the user a page has opened, to paste the key there, and that you cannot
   see it. If `opened` is false, give them `url` and `fallback_code` to type into
   the page instead.
4. When they say they are done, call `setup_status` again. A Zotero key takes
   effect after the app restarts: if it says so, ask them to restart and check
   again afterwards.

If `open_setup` is missing or fails, or the app cannot open a page: tell the
user to double-click `Setup AI4S.bat` (Windows) or `Setup AI4S.command` (Mac) in
the plugin folder. On a Mac the first double-click may be blocked: right-click
the file, choose Open, then Open. Say where the folder is and offer to open it
for them.

Only if the double-click file also failed, ask them to run one line, and say how
to open a terminal in the right folder: on Windows, open the folder in File
Explorer, click the address bar, type `cmd` and press Enter; on a Mac,
right-click the folder and choose "New Terminal at Folder". The line:

```text
node runtime/bundle/index.mjs --setup
```

Never ask for this earlier.

## Step 5: Prove it with a real search

Do this once at the end of setup, and tell the user a tiny search is running.
From the folder that holds `literature-research/`, with a private temporary
folder for the output (never the user's project folder). Replace `uv run` with
`search_helper.run` from `setup_status` (`run.posix` in bash or zsh,
`run.powershell` in PowerShell):

```text
uv run literature-research/scripts/literature_search.py review --question "setup check" --pubmed-query "CRISPR base editing[Title]" --limit 3 --top-n 3 --output <private-temp>/ai4s-setup-check
```

Read the selected-paper table in `report.md` there and show the user the first one to three titles. That is
the result they should see. If it fails, say plainly that the search did not run
and give the one reason in plain words (no network, helper missing), never
"basic features work". Delete the temporary folder afterwards.

## Step 6: Finish

Call `setup_status` one last time and show the three groups. End with the
onboarding mention: offer only missing keys and the add-on as the last thing
users read. When all keys are set, use the all-keys sentence in Step 4 and ask
only about the add-on. For the add-on, one file to download (use the
link in the status text, or
https://github.com/Frankkk1912/ai4s-literature-workbench/releases/latest/download/literature-metrics.xpi), then in Zotero choose Tools, Add-ons, the gear menu, Install
Add-on From File, pick the file, and restart Zotero. Do not offer to build it.
Do not claim it works; say it was found or not.
