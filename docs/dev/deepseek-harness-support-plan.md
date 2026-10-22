# DeepSeek Harness Support Plan

Oct 20, 2026 · @Frank

**Status (Oct 22, 2026): research, the first spike and Stages 2 and 3 are done; nothing has run on Desktop.** Stage 1 (the Desktop spike), the model-behaviour part of Stage 4 and Stage 5 wait for the owner's manual tests. That plan stays the source of truth for the shared runtime, the setup flow, and the release process; this one covers only what is specific to DeepSeek Harness.

Facts come from two pieces of work: the research in PR #16 (the official DeepSeek Harness docs and design notes, read on 2026-10-20) and the `dsh web` spike in PR #17 (macOS, Node 26, `dsh` 0.2.1-rc.2). Neither involved Desktop itself or any DeepSeek model.

## Goal

A biomedical beginner installs the workbench into DeepSeek Harness (`dsh`) Desktop and runs a first literature search without opening a terminal of their own. The success measures are the main plan's: zero typed commands, a first search in 10 minutes or less on a clean Windows 11 or macOS machine, and keys never in chat or command arguments.

I assume "DeepSeek desktop" means DeepSeek Harness Desktop. Confirm this before starting.

## What DeepSeek Harness is

DeepSeek Harness is DeepSeek's open-source agent harness (MIT licence, official repository `deepseek-ai/deepseek-harness`). It is in developer preview: its README warns of compatibility-breaking changes, and the current releases are release candidates (0.2.1-rc.2 at the time of writing). Desktop is an Electron shell around the same web application that `dsh web` serves at `http://127.0.0.1:3080`.

Desktop runs its Host through its own Electron executable with `ELECTRON_RUN_AS_NODE=1`, and bundles pnpm, so installing a plugin needs no Node or pnpm on the computer.

## How it differs from the other hosts

| | Claude Code, Codex, WorkBuddy | DeepSeek Harness |
| --- | --- | --- |
| Plugin unit | A folder with a manifest in `.claude-plugin/`, `.codex-plugin/` or similar | An npm package whose `package.json` has `dsh.bundle.patch`, pointing at a `cordis.patch.yml` |
| MCP servers | `.mcp.json`, one block per server | One `@deepseek-ai/dsh-mcp-client` row per server in that patch, with `transport: stdio` (`command`, `args`, `env`, `cwd`) or `streamable-http`. Tools appear as `mcp__<serverName>__<tool>` |
| Skills | `skills/<name>/SKILL.md` | The same shape: `<name>/SKILL.md` with `name` and `description` in the frontmatter. The local provider scans project `.dsh/skills` and `.agents/skills`, extra `customSkillDirs`, then user `~/.dsh/skills` and `~/.agents/skills` |
| Install by the user | Marketplace commands typed in a terminal or in the host | The **Plugins** page takes a package spec: a registry name, a Git address, a tarball, or a local path. Offline alternative: `dsh plugin --profile desktop add <spec>` while Desktop is closed |
| Discovery | Host marketplaces | An experimental **Custom plugin markets** switch adds a **Discover** tab fed by a JSON index that can sit on any static host, such as GitHub Pages |
| Keys | Host form, or our wizard | No masked settings form for plugin config was found in the docs. Rows can read `process.env`, which the main plan does not rely on |

I found nothing saying DeepSeek Harness reads `.claude-plugin` or `.mcp.json`. That is an absence in the docs, not a test.

## What the spike showed (PR #17)

The spike installed our plugin into the `web` profile of `dsh web` 0.2.1-rc.2 with a throwaway `DSH_HOME`, and looked at the result in the web UI. No sign-in and no model key were used.

| # | Question | Result |
| --- | --- | --- |
| 1 | Does a package install and mount its patch? | **Yes, from the command line.** `dsh plugin --profile web add` worked for a linked folder and for a 3.1 MB `.tgz`. After a restart, both servers ran as child processes of `dsh`, started from the profile's `node_modules`, and the package appeared under Installed plugins. The **Add plugin** button and a Git address were not exercised |
| 2 | Can a stdio row run our bundle on the host's own Node? | **Partly.** `command: !!js process.execPath` with `ELECTRON_RUN_AS_NODE=1` works under plain Node, where the variable is ignored. The official design note says Desktop runs its Host through Electron with that same variable, so the pattern should hold, but only Desktop can show it. Desktop's own Node version is unverified |
| 3 | How does a plugin contribute skills? | **A second `@deepseek-ai/dsh-skill-filesystem` row in the patch, with `customSkillDirs` pointing into the package.** All three skills appeared in the `/` list of a new session with their full descriptions. With that row removed they disappeared and the user's own skills stayed, so the row is what loaded them |
| 4 | Is there a masked field for plugin secrets? | **Not found.** Not in the docs, and no plugin settings screen was opened. Assume the browser wizard until shown otherwise |
| 5 | Can the MCP process open a loopback page and the browser? | Not tested |
| 6 | Do the skills work with the DeepSeek models? | Not tested: needs a DeepSeek key or sign-in |

Things the spike found that the docs did not say:

- `!!js` expressions in a patch are plain code with no `require`. The package folder is not given to them, but `ctx.get('profileContext').dir` is the profile folder, and `process.getBuiltinModule('node:path')` gives them `path`. The patch uses those to find the bundles inside `node_modules`.
- The skill list reads the user's real home folder (`~/.agents/skills`), and an MCP child inherits the real home folder. Our Zotero server read the user's existing private key file at start-up. That matches every other host, but a clean-machine test must use a clean home folder.
- DeepSeek Harness's catalog cuts each skill description at 500 characters by default. `literature-manager`'s is 787 characters (the other two are 342 and 423), so its "Use when" clause may be cut in the model's prompt. The `/` list showed the full text; the prompt itself was not checked.
- The skills' frontmatter has only `name` and `description`, which is what DeepSeek Harness requires.

## What already exists in the repository

- `dsh-plugin/package.json` and `dsh-plugin/cordis.patch.yml`: a patch-only bundle with two MCP rows (the Zotero and full-text servers) and one skills row. `engines.dsh` is `>=0.2.1-rc.2 <0.3.0`.
- `scripts/build-dsh-plugin.mjs --out <dir>`: copies the prebuilt bundles, the skills and the licence files next to the patch in a temporary folder and runs `npm pack`. It stops if the package version differs from `.claude-plugin/plugin.json`. `scripts/package-release.mjs` runs it and adds the result to the release assets.
- `scripts/verify-dsh-plugin.mjs <tgz>` and `scripts/verify-dsh-install.mjs <tgz>`: the checks described under Stage 2. `tests/dsh-plugin.test.mjs` feeds them broken packages.

To repeat the spike without touching a real profile:

```text
DSH_HOME=<scratch folder> npx @deepseek-ai/dsh@0.2.1-rc.2 plugin --profile web add <path to the .tgz>
DSH_HOME=<scratch folder> npx @deepseek-ai/dsh@0.2.1-rc.2 web --no-open
```

Then open the printed `127.0.0.1:3080` link, and type `/` in a new session to see the skills.

## Implementation plan

Stages run in order, and each gate should pass before the next stage. Stages 2 and 3 were built before Stage 1 (Oct 22, 2026): the Desktop test needs a release file and an install route to test, so the route is marked unverified until Stage 1 passes. Progress:

| Stage | State |
| --- | --- |
| 1. Desktop spike | **Not started.** Needs Desktop on real machines. The owner's test script is [deepseek-harness-test-script.md](deepseek-harness-test-script.md) |
| 2. Release asset and CI | **Built.** `package-release.mjs` writes `dsh-ai4s-literature-workbench-<version>.tgz` and a fixed-name copy, both in `SHA256SUMS.txt`; `verify-release.mjs` and `verify-dsh-plugin.mjs` check the metadata, the patch paths, the skills and that both servers start from their patch rows; `verify-dsh-install.mjs` installs it with a pinned `dsh` into a scratch profile and starts the servers from the installed copy. The tarball is not in a published release yet |
| 3. Install docs | **Built.** `deepseek-harness` route in `INSTALL.md` and `install-manifest.json`, the DeepSeek block in both READMEs and both getting-started pages, all marked as not yet tested. The optional plugin market index was not built |
| 4. Key entry | **No new code.** The package reuses the setup flow. The package check confirms `setup_status` and `open_setup` answer from inside the package and that the setup page files are served from the installed folder. Whether `open_setup` can open the browser from inside DeepSeek Harness, and whether there is a masked field for plugin settings, wait for Stage 1 |
| 5. Prove it | **Not started** |

| Stage | Work | Gate |
| --- | --- | --- |
| 1. Desktop spike | On a clean Windows 11 PC and a clean Mac, with Desktop installed and a clean home folder: install the tarball from the **Plugins** page (a local path, then a Git address); check both servers start on Desktop's own Node; check the **Add plugin** flow needs no terminal; look for any masked field for plugin secrets; test that the MCP process can open a loopback page and the browser; run a first search with a DeepSeek model and see whether the skills trigger and call tools. Record the answers in this document | The tools load on both systems with nothing typed. If the Electron-Node pattern fails, decide between a system `node` and the standalone-binary spike from the main plan |
| 2. Release asset and CI | Add the tarball to `package-release.mjs`, `release.yml` and `SHA256SUMS.txt`. Add a CI check that the tarball has `dsh.bundle`, that every patch path exists inside it, and that its version equals `plugin.json`. Add a check that the tarball installs into a scratch profile with `dsh plugin add` | CI green; the tarball appears in a draft release |
| 3. Install docs | Add the route to `INSTALL.md` and `install-manifest.json` as `deepseek-harness`, marked unverified until Stage 1 passes. Add a DeepSeek block to the README install section, in both languages, when the main plan's README rewrite happens. Optional: host a plugin market index so users can install from **Discover** without typing a spec | The route matches the manifest; the README check passes |
| 4. Key entry | Use whatever the main plan's setup flow provides (`setup_status`, `open_setup`, the browser wizard). If Stage 1 finds a masked field for plugin secrets, use it as well and write to the same private file | A key entered through the DeepSeek route is read by both servers |
| 5. Prove it | A clean-machine run on Desktop, recorded on video: minutes to first search, commands typed, agent turns. Compare the skills' behaviour on the DeepSeek models against another host. Update the dashboard row from "unverified" to measured | The main plan's release gate: no typed commands and a first search in 10 minutes or less |

### What building Stages 2 and 3 found

- The tarball installs with the pinned `dsh` 0.2.1-rc.2 (`plugin --profile web add <tgz>`): the profile's `package.json` lists the package under `dsh.profile.bundles`, and `node_modules/dsh-ai4s-literature-workbench` holds it. Both servers then start from that installed copy using the patch's own command, arguments and environment (evaluated with `ctx.get('profileContext').dir` set to the profile folder). Tried on macOS and in the CI dry run; not on Windows.
- The 500-character cut on skill descriptions is the `catalogDescriptionMaxLength` setting of `@deepseek-ai/dsh-tool-skill` (default 500, minimum 3), not of the skill-filesystem row this package adds. A patch from this package could override that plugin's config, but only if the row's id in DeepSeek Harness's own profile is known. That was not looked up, so the setting is **not** changed: the description of `literature-manager` is unchanged and may be cut. Stage 1 should read what the model is actually shown before anything is changed.
- `dsh` 0.2.1-rc.2 itself declares Node 22.19 or newer. On Node 22.13 (what the rest of CI uses) `plugin add` printed engine warnings and exited 0 **without installing anything**, which the install check caught. The install step therefore sets up Node 22.19 for itself. `plugin add` also stops with "pnpm was not found" when pnpm is not on PATH, so the install step installs pnpm too. This concerns only the command-line route; Desktop brings its own Node and pnpm.
- `npm pack` of the tarball is assembled in a temporary folder, so `dsh-plugin/` holds only the patch and `package.json`.
- A release build takes `dsh` from npm at a pinned version. On a cold cache that download is large (several minutes), so the install check runs in the release and dry-run jobs, not in the per-OS test matrix.

## Dependencies on the main plan

- **Prebuilt bundles and the release workflow** (Phase 1, done). The tarball is built from them.
- **`uv` decision** (Workstream A). The Python scripts behind `literature-research` and `literature-manager` are unaffected by the host, so the same `uv` answer applies here.
- **Setup flow** (Phase 2). Key entry in Stage 4 depends on it.
- **README rewrite** (Workstream E). The DeepSeek block belongs in it.

## Risks

| Risk | Why it matters | Fallback |
| --- | --- | --- |
| DeepSeek Harness is a developer preview | Its README warns of compatibility-breaking changes and releases are release candidates, so a plugin can stop loading after an update | Pin an `engines.dsh` range, recheck on each DeepSeek Harness release, and treat the route as best-effort until a stable release |
| A stdio server on Desktop cannot run our bundle | The Host runs on Electron's Node; the child may not behave like Node or find `node` on its PATH | Run the bundle with Desktop's own Node (`process.execPath` with `ELECTRON_RUN_AS_NODE=1`); if that fails, a standalone binary |
| `!!js` evaluation changes | The patch relies on `ctx.get('profileContext').dir` and `process.getBuiltinModule`, which are not documented as stable | The Stage 2 install check catches a break; fall back to a small plugin module that locates its own files |
| Skill descriptions are cut in the prompt | `literature-manager`'s description is 787 characters against a 500-character default | Shorten the description so the "Use when" clause comes first, or raise `catalogDescriptionMaxLength`, which belongs to the `@deepseek-ai/dsh-tool-skill` plugin and so needs a patch entry that targets that plugin's row (not done; see Stage 2 findings) |
| A real home folder leaks into tests | The skill list and the MCP child both see it | Run every test with a clean home folder |
| The Desktop installer is hard to obtain | None of the 30 latest GitHub releases carries an installer, so a clean-machine run depends on a download page I have not found | Ask where DeepSeek publishes it before Stage 1 |

## Decisions to make

1. Where DeepSeek Harness sits in the host order. The main plan's proposal was after Codex and Claude Desktop; with this plan separate, the position is "after the main plan" unless you decide otherwise.
2. The package name. The spike used `dsh-ai4s-literature-workbench`.
3. Whether to publish to npm, or to ship only the tarball on GitHub releases.
4. Whether to host a plugin market index.
5. How much of the DeepSeek-model behaviour is in scope. Stage 5 measures it, but tuning the skills for DeepSeek models would be a separate piece of work.

## Sources

Opened on 2026-10-20, from the official repository `deepseek-ai/deepseek-harness`: [README](https://github.com/deepseek-ai/deepseek-harness), [CLI help](https://github.com/deepseek-ai/deepseek-harness/blob/main/docs/cli-help.md), [plugin markets](https://github.com/deepseek-ai/deepseek-harness/blob/main/docs/user/guide/plugin-market.md), [MCP client guide](https://github.com/deepseek-ai/deepseek-harness/blob/main/docs/user/guide/mcp-memory.md), [packaging a plugin](https://github.com/deepseek-ai/deepseek-harness/blob/main/docs/user/develop/basic/publish.md), [plugin manager reference](https://github.com/deepseek-ai/deepseek-harness/blob/main/packages/boot/plugin-manager/README.md), [MCP client reference](https://github.com/deepseek-ai/deepseek-harness/blob/main/packages/mcp/mcp-client/README.md), [Desktop reference](https://github.com/deepseek-ai/deepseek-harness/blob/main/apps/desktop/README.md), and the design notes on the [skill system](https://github.com/deepseek-ai/deepseek-harness/blob/main/.agents/notes/archived/feature/2026-07-05-skill-system.md), on [bundling the Desktop runtime with external plugins](https://github.com/deepseek-ai/deepseek-harness/blob/main/.agents/notes/implemented/architecture/2026-09-08-desktop-bundled-runtime-and-external-plugins.md), and on [using Electron as the Desktop Node runtime](https://github.com/deepseek-ai/deepseek-harness/blob/main/.agents/notes/archived/architecture/2026-09-11-desktop-electron-node-runtime.md). An example third-party plugin that shows the package shape: [sugarforever/dsh-mcp-apps](https://github.com/sugarforever/dsh-mcp-apps).

Also run in the spike: the `@deepseek-ai/dsh` 0.2.1-rc.2 npm package, whose loader source I read to learn how `!!js` expressions are evaluated.

Not opened and not relied on: community plugin directories and blog posts about DeepSeek Harness that appeared in search results.
