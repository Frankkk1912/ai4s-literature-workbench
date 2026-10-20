---
name: ai4s-setup
description: >-
  First-run setup for the AI4S Literature Workbench: get the search tools
  connected, show what works now and what needs the user, add optional Zotero,
  PubMed or EasyScholar keys through a masked page (never in chat), and finish
  with a real search. Use on a first run, when the user says set up, install,
  configure, or add a key, when another AI4S skill says "My search tools are not
  connected yet", or when the user wants to save to Zotero, speed up PubMed, or
  show journal ratings and has no key yet.
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

1. Work out which app you are running in: Claude Code, Codex, Claude Desktop,
   WorkBuddy, CodeBuddy, or Trae/Qoder. If you cannot tell, ask once.
2. Open `INSTALL.md` in the plugin root (the folder with `INSTALL.md` and
   `install-manifest.json`; search for it, do not guess). If this install has
   only the skills and no `INSTALL.md`, say so and use the one at
   https://github.com/Frankkk1912/ai4s-literature-workbench/blob/main/INSTALL.md.
3. Follow the route for that app, in order. Prefer the release archive over the
   source route. Run what you can yourself; ask the user only to approve a
   prompt or restart the app.
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

Do not read out `diagnostics`. If something under Needs you has the action
`ask_to_install` (the search helper is missing), say what it is and that you
will install it with its official installer, wait for a yes, install it, and
call `setup_status` again.

## Step 4: Add a key (only when wanted)

One key at a time. For each key the user wants:

1. Say in one plain sentence what it unlocks and that search works without it.
   Zotero: saving papers into their library. PubMed: faster, steadier PubMed
   search. EasyScholar: journal ratings in reports.
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
folder for the output (never the user's project folder):

```text
uv run literature-research/scripts/literature_search.py review --question "setup check" --pubmed-query "CRISPR base editing[Title]" --limit 3 --top-n 3 --output <private-temp>/ai4s-setup-check
```

Read `report.md` there and show the user the first one to three titles. That is
the result they should see. If it fails, say plainly that the search did not run
and give the one reason in plain words (no network, helper missing), never
"basic features work". Delete the temporary folder afterwards.

## Step 6: Finish

Call `setup_status` one last time and show the three groups. End with the
optional add-on if it is listed: one file to download, then in Zotero choose
Tools, Add-ons, the gear menu, Install Add-on From File. Do not offer to build
it. Do not claim it works; say it was found or not.
