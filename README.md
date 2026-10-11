# AI4S Literature Workbench

Standalone, private source-of-truth repository for the AI4S Literature
Workbench. This checkout is the future maintenance source for the skills, MCP
runtimes, first-party `literature-metrics` Zotero Desktop XPI, local web
configuration wizard, and an embedded configuration status view delivered in
milestones M1–M5.

The parent repository `Frankkk1912/Frank_AI4S_Skill` keeps its older
`markets` / `sync` install surface frozen and compatible. This repository does
not upgrade or maintain parent-tree code. Switching remaining users from the
parent checkout to this one is out of scope here (Q4). See
[`docs/migration-from-parent.md`](docs/migration-from-parent.md).

## Who this is for

Researchers and operators who already run an AI4S literature workflow on a
local machine and need:

- a single checkout that owns the workbench skills and runtimes
- a local way to see which optional API credentials exist, and to enter them
  without pasting keys into chat
- an honest status view that does not treat “file exists” as “connected”

This is a local, single-user workbench. There is no remote shared dashboard
and no claim that every agent host can install it.

## What this repository delivers (M1–M5)

- Skills, Zotero / Fulltext / database-browser runtimes, and the
  `literature-metrics` XPI source, migrated as a fresh-seed repository
- A local web configuration wizard for optional Zotero, PubMed, and
  EasyScholar credentials (CLI `scripts/onboard.mjs` is fully retained)
- A local configuration status view on the onboarding page, with five sections
  and four evidence kinds (existence / validation / artifact / connection)
- Windows, macOS, and Linux CI plus a secret-scan gate

Non-goals for this release include Zotero import-history pages, remote web
access, WorkBuddy one-click install, XPI feature expansion, and new multi-agent
install scripts. See [`CHANGELOG.md`](CHANGELOG.md).

## Tech stack

- Node.js `>=22.13` (from runtime / XPI `engines`)
- TypeScript ESM runtimes, Express 5 HTTP transport, MCP SDK, Zod
- Vitest and `node:test` for automated checks
- First-party Zotero Desktop XPI packaged from `literature-metrics/`

Host product version numbers for Claude Code, Codex, WorkBuddy, CodeBuddy,
opencode, and Antigravity are omitted here (待 Frank 核对 / 未实测).

## Installation

One installer covers the supported hosts: `scripts/install-host.mjs`. It never
edits a host's config by guesswork. Each host either runs that host's official
CLI, writes the config file that host's docs say it reads, or prints
instructions only.

**Run it from this checkout:**

```bash
node scripts/install-host.mjs --list                  # hosts and their evidence level
node scripts/install-host.mjs --host claude --dry-run  # show the commands, change nothing
node scripts/install-host.mjs --host claude            # run the official claude CLI
node scripts/install-host.mjs --host trae --target /path/to/project
node scripts/install-host.mjs --host all --dry-run     # check every host at once
```

Each result reports a `status`: `installed` (the official CLI succeeded in this
run), `config_written` (a file was written; the host was not run), `instructions`
(the user must act), `unavailable` (the host CLI is not on PATH), or `unverified`
(the documented path was tried and failed).

After a host install, bootstrap the source runtimes (Node.js `>=22.13` and npm
required):

```bash
bash scripts/bootstrap-runtime.sh
```

Windows PowerShell:

```powershell
.\scripts\bootstrap-runtime.ps1
```

### Host support, by evidence

| Host | Status | How it connects | Evidence |
| --- | --- | --- | --- |
| Claude Code | Command path measured | `/plugin marketplace add` then `plugin install` | `claude` 2.1.x subcommands confirmed here. The install itself was **not** run on the maintainer's machine. |
| Codex | Documented, not run here | `codex plugin marketplace add` then `plugin add` | Codex is not installed on the test machine. |
| Qoder | Documented, needs one extra file | Reads `.qoder-plugin/plugin.json` plus `mcp.json` | Read from docs.qoder.com, which lists `.qoder-plugin/plugin.json` and does not mention `.claude-plugin`. Treated as not supported; the installer writes the Qoder manifest. |
| Trae | Documented, MCP only | Reads `.trae/mcp.json`; no plugin manifest | Read from docs.trae.cn. The installer writes the MCP file. |
| WorkBuddy | **Unverified** | Has a custom connector entry (专家·技能·连接器 → 自定义连接器) | The connector config format was not fully read, so the installer only prints instructions. |
| opencode | **Unverified** | Has a `plugin` array and an `mcp` key in `opencode.json` | Docs were not retrievable from the test environment. Instructions only. |

DeepSeek Harness (`dsh`, official, `deepseek-ai/deepseek-harness`) is **not**
in the installer. It is a developer preview with breaking changes, is not
security-audited, and can execute model-generated commands and load third-party
plugins. Its MCP servers are configured in `cordis.patch.yml`, not `.mcp.json`,
so this repository's MCP config does not load there unchanged. Run it only in a
disposable VM or container. See its
[SAFETY.md](https://github.com/deepseek-ai/deepseek-harness/blob/master/SAFETY.md).
DeepSeek-TUI (`Hmbown/DeepSeek-TUI`) is a separate community project; its
behaviour here is unverified.

The labels above describe what was read or run. Nothing is marked "verified on
your host" unless it has been run on that host. The Claude install and the
Codex, Qoder, Trae, WorkBuddy, and opencode paths still need a real smoke run.

### Using the installer as an agent

An agent that reads this section should:

1. Run `node scripts/install-host.mjs --list` to see which hosts exist.
2. Run `--dry-run` first and show the user the commands before any write.
3. Run without `--dry-run` only for the host the user named.
4. Report the returned `status` verbatim. Do not turn `config_written` or
   `instructions` into "installed".

The installer never reads or writes credentials. Keys stay in the onboarding
wizard (see below).

The MCP configs written for Qoder and Trae use absolute paths to this checkout,
so they work from any project. They are tied to this machine: after moving the
repository, run the installer again.

## Local configuration wizard and status view

The web wizard is an extra UX entry beside the CLI. It is not a replacement.

1. Build and start the Zotero MCP in loopback HTTP mode (no OAuth):

   ```bash
   node runtime/dist/index.js --http --host 127.0.0.1 --port 3939
   ```

2. Open the pairing page: `http://127.0.0.1:3939/admin/onboarding/`
3. Redeem the one-time pairing code from the process stderr (an agent that
   started the server may relay **only** that pairing code; keys must never
   enter chat)
4. Configure optional credentials. 配置状态在配置向导页面底部展示.

Details:

- [`docs/onboarding.md`](docs/onboarding.md) — CLI + web wizard, pairing, R12
- [`docs/local-dashboard.md`](docs/local-dashboard.md) — embedded status view
- [`docs/zotero-xpi.md`](docs/zotero-xpi.md) — manual XPI build and install

The CLI remains:

```bash
node scripts/onboard.mjs setup --output onboarding-result.json
node scripts/onboard.mjs status --output onboarding-status.json
```

Never paste an API key into Agent chat or pass it as a command argument.

## Security boundary

- Management routes bind to loopback only. OAuth or non-loopback HTTP does not
  register them and does not print a pairing code.
- Pairing code: 16 random bytes, 5-minute TTL, single use, constant-time
  compare, attempt limiting. It never enters a URL or server log.
- Session after redeem: 30 minutes, HttpOnly, SameSite=Strict, in-memory,
  discarded on process restart. Every management GET and POST requires that
  session. Clearing the session cookie yields `401` JSON.
- Host / Origin checks, CSRF on writes, and DNS-rebinding protection cover the
  management surface.
- Credential exposure follows R12’s three paths (see
  [`docs/onboarding.md`](docs/onboarding.md)):
  1. Browser → local POST body (visible in the user’s own DevTools; inherent)
  2. Zotero official check via `Zotero-API-Key` Header
  3. PubMed / EasyScholar official HTTPS checks carry `api_key` / `secretKey`
     as query parameters (D10-approved exception; server-side request only)
- Local / browser URLs, address bar, logs, errors, responses, reports, and
  chat must not contain plaintext keys or key-bearing URLs.
- The status view never shows **已连接** without measured connection evidence.
  Unverified hosts stay 未知 / 待人工核验. The XPI status is read from Zotero
  profile records; an active install proves presence, not that it works.

## Docs

| Document | Contents |
| --- | --- |
| [`docs/onboarding.md`](docs/onboarding.md) | Credential wizard (CLI + web), pairing, R12 |
| [`docs/local-dashboard.md`](docs/local-dashboard.md) | Embedded status view |
| [`docs/zotero-xpi.md`](docs/zotero-xpi.md) | XPI build and manual install |
| [`docs/migration-from-parent.md`](docs/migration-from-parent.md) | D8 baseline, parent freeze, V10 |
| [`CHANGELOG.md`](CHANGELOG.md) | Standalone first release notes |

## License

MIT. See [`LICENSE`](LICENSE) and [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md).
