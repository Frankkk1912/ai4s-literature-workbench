# AI4S Literature Workbench: Zero-Terminal Onboarding Plan

Oct 18, 2026 · @Frank · updated Oct 20, 2026: DeepSeek Harness Desktop added as a host · Oct 21, 2026: Phase 3 findings (Zotero 10 local writes, update feed) · Oct 22, 2026: DeepSeek Harness package and route built

## Goal and success criteria

A biomedical beginner installs the workbench, runs a first literature search, and sees the Zotero journal-partition columns (IF / JCR / CAS), without ever opening a terminal of their own. This holds on WorkBuddy first, then Codex and Claude Desktop, then CodeBuddy, Claude Code, and Trae/Qoder. DeepSeek Harness Desktop follows after this plan, with its own plan in [deepseek-harness-support-plan.md](deepseek-harness-support-plan.md).

The targets below are proposals; adjust them before work starts.

| Target | Measure |
| --- | --- |
| Commands the user types | 0 |
| User actions allowed | Approve a prompt, drag a file, paste a key into a masked form |
| Time to first successful search | 10 minutes or less on a clean Windows 11 or macOS machine with no Node, Git, or uv |
| Time to visible partition columns | One download and one drag into Zotero, plus a restart |
| Keys in chat or command arguments | Never (unchanged from today) |
| Status wording | States what works now and what needs the user, never component names |
| Verification | One scripted clean-machine run per supported host before each release |

**Non-goals:** rewriting retrieval or ranking logic, and supporting hosts that cannot run MCP servers or skills.

## Diagnosis

On Codex, the README's install prompt leaves a half-installed plugin, and the rest of setup needs a terminal the agent cannot use. The real-user transcript and the repo docs show eight problems; each maps to a workstream below.

| # | Problem | Evidence | Fixed by |
| --- | --- | --- | --- |
| 1 | The agent installed only the three skills, not the MCP tools or runtime, yet said basic features worked | Transcript: skills installed, `runtime/dist` not built | A, C |
| 2 | The agent described setup steps that do not exist for this project (model API key, Windows installer, SmartScreen) | Not in [README\_CN](https://github.com/Frankkk1912/ai4s-literature-workbench/blob/main/README_CN.md) or [Releases](https://github.com/Frankkk1912/ai4s-literature-workbench/releases) | C, E |
| 3 | Credential setup needs an interactive terminal, so the agent cannot do it | Transcript; [onboarding.md](https://github.com/Frankkk1912/ai4s-literature-workbench/blob/main/docs/onboarding.md) | B |
| 4 | Node.js 22.13+ was missing, so the add-on build failed | Transcript | A, D |
| 5 | The agent gave `node .\scripts\bootstrap-runtime.ps1`, which cannot run a PowerShell script, and never named the folder | Transcript; README says to run it in PowerShell | A, B |
| 6 | Status mixed "installed", "not built", "not configured" and "optional"; the user asked whether anything was installed | Transcript | C |
| 7 | The partition columns the user wanted need the add-on; a prebuilt one exists, but its release note says "Private repo; download requires repo access" | [Releases](https://github.com/Frankkk1912/ai4s-literature-workbench/releases) | D, E |
| 8 | User docs carry internal IDs (D12, R12, M4) and mix Chinese and English | [local-dashboard.md](https://github.com/Frankkk1912/ai4s-literature-workbench/blob/main/docs/local-dashboard.md) | E |

## Design principles

Seven rules decide every later choice.

1. **The agent does everything it can.** The user only approves, drags a file, or pastes a key into a form.
2. **Nothing is built on the user's machine.** Ship prebuilt runtimes and the add-on; remove the Node/npm/uv requirement for end users.
3. **One entry point per host, same end state.** Whichever host they use, they finish with the same working tools.
4. **Keys go into a masked form that is not a terminal.** Use the host's own form where one exists, and a local browser page everywhere else.
5. **The runtime finds its own keys.** It reads one private config file at a fixed path, so it does not depend on any host injecting environment values.
6. **Report capabilities, not components.** Say "you can search now; saving to Zotero needs one key", never "runtime not built".
7. **A skill checks its own tools first.** If the MCP tools are missing, it stops and says so in plain words, with one next action.

## Target architecture

Every host installs the same prebuilt runtime, and every key-entry route ends in the same private file.

&#91;embedded content: architecture · 6 host boxes, 1 runtime, 3 key-entry routes\]

Claude Desktop and Claude Code share one `.mcpb`; WorkBuddy and CodeBuddy use the plugin route; Codex and Trae/Qoder use the plugin archive or the install script; DeepSeek Harness installs a plugin package of its own and is planned separately. The runtime reads keys from the private file, whichever route wrote them.

## First target: WorkBuddy and CodeBuddy

WorkBuddy ships first. It is a desktop agent aimed at non-technical users, which matches the biomedical beginner, and CodeBuddy appears to share its plugin system, so one route should serve both. Everything below comes from search results, not from the apps themselves, so the first task is to test it.

**What the docs say**

- A plugin manifest is read from `.codebuddy-plugin/`, `.workbuddy-plugin/` or `.claude-plugin/`, and a marketplace needs `.codebuddy-plugin/marketplace.json` ([plugin reference](https://www.workbuddy.ai/docs/cli/plugins-reference), [marketplaces](https://www.workbuddy.ai/docs/cli/plugin-marketplaces)).
- The servers in a plugin's `.mcp.json` start when the plugin is enabled (plugin reference).
- CodeBuddy uses `/plugin marketplace add owner/repo` and `/plugin install name@marketplace`, and its IDE installs from a marketplace page in Settings ([EdgeOne plugin docs](https://pages.edgeone.ai/document/plugin)).
- WorkBuddy reads MCP servers from `~/.workbuddy/mcp.json`, spelled without a leading dot, and from a project-level `workbuddy.mcp.json` ([ChatCut guide](https://chatcut.io/zh/workbuddy), [CloudBase guide](https://docs.cloudbase.net/en/ai/cloudbase-ai-toolkit/ide-setup/workbuddy)).
- WorkBuddy has an in-app MCP marketplace and a "Connect App" button (CloudBase guide).

**Test first** (a short spike on a clean Windows PC and a clean Mac)

1. Can WorkBuddy install this plugin from GitHub through its interface, or only skills and MCP entries?
2. Does the existing `.claude-plugin` manifest load unchanged, with its skills and `.mcp.json`?
3. Does WorkBuddy offer a masked form for plugin secrets? If not, the browser wizard is its key-entry route.
4. Can the MCP process open a loopback page and a browser from inside the app?
5. Does the app expose Node to MCP servers? If not, the standalone binary is required.

**Tasks**

- [ ] Add `.codebuddy-plugin/marketplace.json` pointing at the same plugin folder.
- [ ] Write the WorkBuddy route in `INSTALL.md` and README\_CN first: add the plugin, accept the permission prompt, use the setup page that opens, run the first search.
- [ ] Ship a ready-made `mcp.json` entry for when the plugin route fails, with the exact path and the "no leading dot" warning. Have the setup tool offer to write that entry itself, so the user edits no file.
- [ ] Run the first clean-machine tests on WorkBuddy, then Codex and Claude Desktop, then CodeBuddy.
- [ ] Change the dashboard's WorkBuddy and CodeBuddy rows from "unverified" to measured once those runs pass.

## DeepSeek Harness Desktop

DeepSeek Harness has its own plugin model: an npm package that carries a configuration patch, not a `.claude-plugin` folder or a `.mcp.json`. It gets its own plan, [deepseek-harness-support-plan.md](deepseek-harness-support-plan.md), which holds the research, the `dsh web` spike results, the tasks and the risks. Its package (`dsh-plugin/`), the release asset and the install route are built (Oct 22, 2026); what is left there is testing on Desktop, which this plan's release gate does not wait for.

## Workstream A: Packaging and prebuilt runtimes

After install, the tools must already work: no `npm install`, no TypeScript build, and no browser download on the user's machine. CI does the building; the user receives the output.

- [ ] Bundle `runtime` and `fulltext-runtime` into single JavaScript files with dependencies included (esbuild or similar), built in CI on every tag.
- [ ] Move `database-browser-runtime` out of the default install. Playwright's Chromium is a large download, so fetch it on first use, after the user agrees.
- [ ] Publish four assets per release tag: a `.mcpb` bundle, a plugin archive with prebuilt `dist/` folders, the Zotero XPI, and a checksums file.
- [ ] Add `scripts/bootstrap.mjs` as the single cross-platform entry. Reduce the `.sh` and `.ps1` scripts to one-line wrappers. Every command then has the shape `node scripts/<name>.mjs`, which removes problem 5.
- [ ] Provide `uv` from `bootstrap.mjs` (fetch a pinned release with a checksum, or ship it in the archive) and point the research and manager skills at that copy.
- [ ] Remove "Node.js ≥22.13, uv, Git" from the beginner path in README and README\_CN. Keep it in the developer section only.

**The `.mcpb` bundle covers two hosts.** Claude Desktop installs it by double-click or drag-and-drop and ships its own Node.js on macOS and Windows ([MCPB docs](https://claude.com/docs/connectors/building/mcpb)). Claude Code's `plugin.json` can point `mcpServers` at a `.mcpb` file or URL ([manifest reference](https://code.claude.com/docs/en/plugins/manifest-reference.md)).

WorkBuddy, CodeBuddy, **Codex, Trae and Qoder need a runtime we provide.** They do not bundle Node the way Claude Desktop does, as far as I know. Two options for a spike in Phase 1:

| Option | How it works | Trade-off |
| --- | --- | --- |
| Standalone binaries | Build per-OS executables (Node single-executable or `bun build --compile`) and have `.mcp.json` point at the right one | Larger downloads; four platform builds in CI |
| Portable Node | The setup step downloads a portable Node into the plugin data folder, no admin rights | Needs network access from the agent's shell, which Codex blocked in the transcript |

Standalone binaries avoid the blocked-network problem, so I would start there.

**Search needs Python, not just Node.** `literature-research` and `literature-manager` run two Python scripts (about 5,500 lines, standard library only, 141 unit tests). Today `uv` is only the launcher that supplies Python, and the beginner path still asks the user to install it. Phase 0 makes the skills stop and say so; Phase 1 removes the requirement.

Decision: keep the Python scripts and do not port them to Node, because a rewrite is a non-goal and risks silent ranking drift. Instead provide `uv` ourselves, then let it fetch Python on first use (no admin rights).

| Option | How it works | Trade-off |
| --- | --- | --- |
| Fetch pinned `uv` | `bootstrap.mjs` downloads a pinned `uv` release for the OS into the plugin data folder and checks a hard-coded SHA-256 | About 20 MB plus Python on first search; needs network from the agent's shell |
| Ship `uv` in the archive | Release assets carry one `uv` binary per OS | 20 to 30 MB per OS, no network needed |
| Freeze with PyInstaller | Per-OS executables for the two scripts | Same CI cost as the Node binaries, plus antivirus false positives; not preferred |

Start with fetching, fall back to shipping if the host blocks the download, matching the Node decision above. Later, expose search as an MCP tool that spawns the same script, so the agent never shells out.

## Workstream B: Setup flow without a terminal

Keep the current safety rule (keys never enter chat), but give every host a way to enter keys that is not a terminal. All entry points write to the same private config file, so the runtime behaves identically whichever door was used.

| Host | Where the user enters keys | Fallback |
| --- | --- | --- |
| WorkBuddy (first target) | Browser wizard; I found no secret form for plugin settings in WorkBuddy's docs, so confirm in the spike | Double-click launcher |
| CodeBuddy | Browser wizard; confirm whether the IDE's plugin settings offer a masked form | Double-click launcher |
| Claude Desktop | Masked settings form generated from `user_config` in the `.mcpb` manifest | Browser wizard |
| Claude Code | Masked prompt when the plugin is enabled (`userConfig` with `sensitive: true`, kept in secure storage) | Browser wizard |
| Codex | Browser wizard; I found no plugin-secret form in Codex's plugin docs, so confirm | Double-click launcher |
| Trae / Qoder | Browser wizard | Double-click launcher |

Sources: [MCPB docs](https://claude.com/docs/connectors/building/mcpb), [Claude Code manifest reference](https://code.claude.com/docs/en/plugins/manifest-reference.md), [Codex plugin docs](https://developers.openai.com/codex/plugins/build/). A third-party plugin repo reports that Codex CLI 0.130 does not interpolate `${VAR}` in a plugin's `.mcp.json` ([fusengine/codex](https://github.com/fusengine/codex)), which is why the runtime should read its own config file rather than rely on injected values.

**Tasks**

- [ ] Runtime reads credentials in this order: host-injected environment variables, then the private config file. Existing native and legacy files keep working.
- [ ] Add MCP tools `setup_status` and `open_setup`. `open_setup` starts the loopback wizard if it is not running and opens the user's default browser.
- [ ] Start the wizard from the MCP process itself, so the agent no longer launches `--http` and relays a code from stderr.
- [ ] Add double-click launchers (`Setup AI4S.bat`, `Setup AI4S.command`) that run `bootstrap.mjs` and open the wizard. They cover agent sandboxes that cannot start a server or a browser.
- [ ] Keep `onboard.mjs` for developers; the beginner path never mentions it.
- [ ] Ask only for keys that unlock something the user asked for. Search needs none; the wizard offers the Zotero, PubMed and EasyScholar keys one at a time, each with a plain-language reason and a link to where to get it.

**Decision, accepted:** today the pairing code never appears in a URL. To skip the copy-and-paste step, the launching process could open the browser with a one-time token in the URL fragment, which browsers do not send to the server. This weakens the current rule slightly in exchange for one less manual step. You accepted it, because the code only protects a loopback page that expires in minutes.

## Workstream C: Skills self-check and plain-language status

The agent should never guess what is installed or improvise setup steps. The skills and the status output tell it exactly what to say.

- [ ] Add a first step to all three skills: call `setup_status`. If the MCP tools are missing, stop and say "My search tools are not connected yet" plus one next action. No silent fallback and no "basic features work" claim.
- [ ] Add a fourth skill, `ai4s-setup`, that owns first-run. It detects the host, follows the install route for that host, calls `setup_status`, opens the wizard if a key is wanted, and re-checks at the end.
- [ ] Add `INSTALL.md` (and a small `install-manifest.json`) listing the exact install route per host. The README prompt tells the agent to follow it, which prevents invented steps like problem 2.
- [ ] Make `setup_status` return capabilities, not components, and have the skill render them in three groups.
- [ ] Reply in the language the user writes in; ship status strings in Chinese and English, Chinese by default.
- [ ] Ask the user to run a command only when the double-click launcher has failed. Then give one copy-paste line and say how to open a terminal in the right folder.
- [ ] Finish setup with a real smoke test (a tiny PubMed query), so the user sees a result rather than a file-exists check.

The status the user reads should look like this:

```text
Works now
  Search and rank papers; draft from saved evidence
Needs you (1)
  Save to Zotero: create a Zotero key (link), paste it into the page I just opened
Optional
  Journal partition columns in Zotero: install the add-on (one file, link)
```

The existing dashboard keeps the detailed component evidence under its collapsed sections. That detail stays for developers and bug reports.

## Workstream D: Zotero add-on and Zotero connection

The partition columns are what this user wanted first, so the add-on stops being an "optional extra" and becomes the recommended second step. A prebuilt XPI already exists in the [v0.1.13 release](https://github.com/Frankkk1912/ai4s-literature-workbench/releases), so nobody needs Node to get it.

**Add-on tasks**

- [x] Attach the XPI to every release (done by `package-release`, now also under the fixed name `literature-metrics.xpi`). The published v0.1.13 release note no longer says "Private repo"; the stale line in the diagnosis table is history.
- [x] Have the setup page and the agent link straight to the latest XPI (`releases/latest/download/literature-metrics.xpi`), with a four-step guide in Chinese and English. The picture guide is still to do (Phase 4). The link works once a release that carries the fixed-name file is published.
- [x] Report the result in plain words: "found in your Zotero profile" or "not installed yet", keeping the note that load success cannot be proven. The check now reads where the add-on updates from, so a file saved in Downloads counts.
- [x] Update route. Zotero's developer docs describe the feed (`update_url` in the manifest, a JSON file with `update_link` and `update_hash`); this add-on already pointed at one. Phase 3 added the missing `update_hash` and a release-time check that the feed describes the packaged file. **Found:** copies installed before 0.1.14 check a retired private repository and will never update, so they need one manual reinstall. **Open:** the docs do not say whether a GitHub release address (a redirect) is accepted as `update_link`; confirm on the first real update.
- [x] Stop recommending a local XPI build in the beginner path (the build steps moved to a developer section in `docs/zotero-xpi.md`).

**Zotero connection tasks**

Today every Zotero feature needs a Web API key. Zotero Desktop 7 also offers a local HTTP API on port 23119 that needs no key, enabled by the setting "Allow other applications on this computer to communicate with Zotero". The Zotero developers described it as read-only and said write support was planned but undecided ([zotero-dev post, June 2024](https://groups.google.com/g/zotero-dev/c/ElvHhIFAXrY/m/fA7SKKwsAgAJ)). **Checked on 2026-10-21: no longer true.** Zotero 10.0 (released 2026-08-17; 10.0.6 is the current stable release) accepts writes on the local API, authorised once by a dialog inside Zotero ([local API page](https://www.zotero.org/support/dev/web_api/v3/local_api)). Zotero 7 to 9 stay read-only (Zotero 9.0.6 tested).

- [x] Read paths (list collections, find duplicates, check existing items, item children) use the local API when Zotero is running, with no key. They were partly there already; Phase 3 added re-probing (opening Zotero after the tools started works), telling "Zotero closed" from "setting off", and local children. Tried against a real Zotero 9.0.6 with no key.
- [x] Write paths keep the Web API key as the default. With no key and Zotero 10 or later open, saving goes through the local API (`ZOTEUS_LOCAL_WRITES=off` turns it off). Tested against a stand-in written from the documentation, **not against a real Zotero 10**. The wizard links to Zotero's key page and says to tick write access. Whether the key page accepts prefilled permissions is **unverified**: the documented parameters belong to the OAuth exchange and the page needs a sign-in.
- [x] Spike: an add-on write endpoint. Written finding only, in [zotero-local-write-spike.md](zotero-local-write-spike.md): Zotero 10 makes it unnecessary for most users; recommendation is not to build it.
- [x] Tell the user about the "allow other applications" setting in the wizard, in `setup_status`, and in the runtime docs.

## Workstream E: README and docs rewrite

The README should give one install route per host, in the order a beginner meets them. Everything about builds, keys and threat models moves out of the beginner path.

- [x] **Install by host, not one generic prompt.** Four short blocks: Claude Desktop (download the `.mcpb`, double-click), Claude Code (the plugin install lines, typed inside Claude Code), Codex (a prompt that names the plugin marketplace route and points to `INSTALL.md`), DeepSeek Harness (paste one package spec into the Plugins page), and Trae/Qoder. *Done for all five blocks. The DeepSeek Harness block is marked as not yet tested on a real machine.*
- [x] **Reword "What you need".** Host app, a browser, and Zotero Desktop if wanted. Drop Node, uv and Git from this list.
- [x] **Set expectations before the first run.** Say the agent may ask for permission to reach GitHub or the network, and that the user should choose Allow. In the transcript that approval cost a full round trip.
- [ ] **Show the finish line.** Add a short GIF or four screenshots: install, the setup page, the first search result, and the partition columns in Zotero. *Not done: needs real runs on the target hosts; the placeholders are still commented out in the READMEs.*
- [x] **Add a symptom-based troubleshooting table** in the user's words: "the agent says the tools are not connected", "no partition columns", "the setup page did not open".
- [x] **Add a plain FAQ**: what a key is, which keys are free, and why search works without any.
- [x] **Split the docs.** Create `docs/getting-started.md` and `docs/getting-started_CN.md` for beginners. Move `onboarding.md` and `local-dashboard.md` to `docs/dev/` and remove the internal IDs (D12, R12, M4, T5.2) from anything a beginner might open.
- [x] **Treat Chinese as first-class.** The same steps and screenshots in README\_CN, not a translation of the English one.
- [x] **Keep README and the install docs in sync automatically.** A CI check fails if a command in README is missing from `INSTALL.md` or the plugin manifests.
- [ ] If README is generated from your readme-writer prompt templates, change the templates as well, or the next regeneration will undo this work.

## Workstream F: Testing and release gates

The Codex transcript is already a failing acceptance test: a clean Windows PC, one pasted prompt, and the goal of seeing the partition columns. Keep it as the standing definition of done, and automate everything around it that can be automated.

| Check | Where it runs | Automated |
| --- | --- | --- |
| Each bundle starts over stdio and lists its tools | CI on Windows, macOS, Linux | Yes |
| `mcpb validate`, `claude plugin validate --strict`, Codex manifest check | CI | Yes |
| `bootstrap.mjs` on a machine with no Node installed | CI container | Yes |
| The wizard stores a key, masks it, and rejects a bad one | CI with a headless browser against loopback | Yes |
| README and `INSTALL.md` commands match the manifests | CI | Yes |
| Install on each host from a clean machine, first search, partition columns visible | Release checklist: Windows 11 and macOS, starting with WorkBuddy, then Codex and Claude Desktop, then CodeBuddy and Claude Code | No, recorded on video |
| Three beginners install unaided | Every release candidate | No |

GitHub-hosted CI cannot drive the desktop host apps, so the host-by-OS rows stay manual. Trae and Qoder are tested best-effort.

**Release gate:** a release ships only if the manual rows pass with zero typed commands and a first search in 10 minutes or less. Record three numbers per beginner run: minutes to first search, commands typed, and agent turns used.

## Roadmap

Five phases ship in order, and a gate after phases 1, 2 and 4 decides whether the next one starts. Phase 0 can ship as a patch this week. Phase 1 is done (Gate 1 passed on Windows, macOS and Linux CI). Phases 2 and 3 are done and release v0.1.0 is published (Oct 22, 2026). Phase 4 has its documents and automatic checks in place; the manual runs (clean machines, three beginners) and the screenshots are still to do, see [release-checklist.md](release-checklist.md). The DeepSeek Harness package, release asset and install route are in place (Oct 22, 2026); testing it on Desktop is the owner's manual run, see [deepseek-harness-support-plan.md](deepseek-harness-support-plan.md).

&#91;embedded content: roadmap · 5 phases, 3 gates\]

Effort figures are my rough estimates for one developer; re-plan them after the Phase 1 spike.

| Phase | Work | Rough effort | Gate |
| --- | --- | --- | --- |
| 0 Quick wins | A: `bootstrap.mjs`. E: Codex and WorkBuddy install prompts, CodeBuddy marketplace file, `INSTALL.md`, release-note fix. C: tools check at the start of each skill | 1 to 2 days | None |
| 1 Package | A: bundles, `.mcpb`, release assets, binary-versus-portable-Node spike, `uv` fetch-versus-ship spike. F: validation jobs in CI | About 1 week | Gate 1: bundles start on Windows and macOS |
| 2 Setup flow | B: `setup_status`, `open_setup`, wizard that opens itself, launchers. C: `ai4s-setup` skill and status template | 1 to 2 weeks | Gate 2: no typed commands, first search works |
| 3 Zotero | D: XPI in every release, local-API reads, add-on update route. Spike: key-free writes through the add-on (replaced by Zotero 10's own local writes; see the finding) | About 1 week, spike open-ended | None |
| 4 Prove it | F: clean-machine runs, WorkBuddy first, then each other host. E: getting-started pages in both languages, screenshots | About 1 week | Gate 3: first search in 10 minutes or less for three beginners |

## Risks and decisions

The biggest risk is that a host's sandbox blocks something the plan assumes, and the plan keeps a fallback for each.

| Risk | Why it matters | Fallback |
| --- | --- | --- |
| Codex's sandbox blocks network, local servers or the browser | The transcript shows GitHub access blocked until the user approved it | Double-click launcher; `INSTALL.md` route that tells the user which approvals to accept |
| Claude Code's key prompt misbehaves | A plugin README reports the configure dialog not taking input and secrets not persisting in some versions ([FlutterFlow plugin](https://github.com/FlutterFlow/flutterflow-claude)) | Browser wizard and private config file |
| Claude Desktop does not inject `user_config` in cowork sessions | A March 2026 issue reports the values missing there ([claude-code#39125](https://github.com/anthropics/claude-code/issues/39125)) | Runtime reads its own config file as a backup |
| Unsigned executables trigger antivirus, SmartScreen or macOS Gatekeeper warnings | Beginners will stop at a warning | Prefer the `.mcpb` route where possible; evaluate code signing, plus Apple notarization, for binaries |
| Zotero's local API changes | Write support was undecided in 2024; it shipped in Zotero 10 (Aug 2026) and Zotero said it was still adjusting it | Feature-detect at runtime (a `Zotero-Server-ID` header means Zotero 10+); keep the Web API key path |
| The agent's shell blocks the `uv` or Python download | Search then cannot run, and it is the first thing a beginner tries | Ship `uv` inside the archive; the skill already stops with a plain message |
| Seven hosts times two operating systems | Maintenance cost grows quickly | WorkBuddy first, then Codex and Claude Desktop, then CodeBuddy and Claude Code; Trae and Qoder best-effort |

**Decisions made**

1. WorkBuddy ships first; Codex and Claude Desktop share second place.
2. Windows and macOS are both fully supported. Development happens on macOS, so Windows gets a clean-machine run on every release.
3. The wizard opens with a one-time token in the URL fragment (Workstream B).
4. Per-OS binaries of tens of megabytes are acceptable for releases.
5. Chinese is the default language of the setup page and status text.
6. DeepSeek Harness Desktop is a host with its own plan; its package and install route were built after this plan's phases 1 to 4 (Oct 22, 2026) and wait for the manual test.

## Sources

Host and Zotero documentation checked on 2026-10-18. The Codex transcript is the user's own screenshots and has no link.

**Pages opened**

- [Build a desktop extension with MCPB](https://claude.com/docs/connectors/building/mcpb)
- [Claude Code plugin manifest reference](https://code.claude.com/docs/en/plugins/manifest-reference.md)
- [Zotero local HTTP API announcement, zotero-dev, June 2024](https://groups.google.com/g/zotero-dev/c/ElvHhIFAXrY/m/fA7SKKwsAgAJ)
- Repo: [README](https://github.com/Frankkk1912/ai4s-literature-workbench), [README\_CN](https://github.com/Frankkk1912/ai4s-literature-workbench/blob/main/README_CN.md), [Releases](https://github.com/Frankkk1912/ai4s-literature-workbench/releases), [onboarding.md](https://github.com/Frankkk1912/ai4s-literature-workbench/blob/main/docs/onboarding.md), [local-dashboard.md](https://github.com/Frankkk1912/ai4s-literature-workbench/blob/main/docs/local-dashboard.md), [zotero-xpi.md](https://github.com/Frankkk1912/ai4s-literature-workbench/blob/main/docs/zotero-xpi.md)

**Seen in search results only, not opened; verify before relying on them**

- [Codex plugin build docs](https://developers.openai.com/codex/plugins/build/)
- [fusengine/codex](https://github.com/fusengine/codex): reports Codex CLI not interpolating `${VAR}` in plugin `.mcp.json`
- [FlutterFlow plugin](https://github.com/FlutterFlow/flutterflow-claude): reports Claude Code key-prompt issues
- [claude-code issue 39125](https://github.com/anthropics/claude-code/issues/39125): reports `user_config` missing in cowork sessions

Also seen in search results only, for WorkBuddy and CodeBuddy: [WorkBuddy plugin reference](https://www.workbuddy.ai/docs/cli/plugins-reference), [WorkBuddy plugin marketplaces](https://www.workbuddy.ai/docs/cli/plugin-marketplaces), [EdgeOne plugin docs](https://pages.edgeone.ai/document/plugin), [ChatCut WorkBuddy guide](https://chatcut.io/zh/workbuddy), [CloudBase WorkBuddy guide](https://docs.cloudbase.net/en/ai/cloudbase-ai-toolkit/ide-setup/workbuddy).

DeepSeek Harness sources are listed in [deepseek-harness-support-plan.md](deepseek-harness-support-plan.md#sources).
