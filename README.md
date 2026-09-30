# AI4S Literature Workbench

Standalone, private source-of-truth repository for the AI4S Literature
Workbench. This checkout is the future maintenance source for the skills, MCP
runtimes, first-party `literature-metrics` Zotero Desktop XPI, local web
configuration wizard, and configuration status dashboard delivered in
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
- A local configuration status dashboard with five sections and four evidence
  kinds (existence / validation / artifact / connection)
- Windows, macOS, and Linux CI plus a secret-scan gate

Non-goals for this release include Zotero import-history pages, remote web
access, WorkBuddy one-click install, XPI feature expansion, and new multi-agent
install scripts. See [`CHANGELOG.md`](CHANGELOG.md).

## Tech stack

- Node.js `>=20.19` (from runtime / XPI `engines`)
- TypeScript ESM runtimes, Express 5 HTTP transport, MCP SDK, Zod
- Vitest and `node:test` for automated checks
- First-party Zotero Desktop XPI packaged from `literature-metrics/`

Host product version numbers for Claude Code, Codex, WorkBuddy, CodeBuddy,
opencode, and Antigravity are omitted here (待 Frank 核对 / 未实测).

## Installation

Installation conclusions are limited to paths that can be evidenced. This
repository does **not** claim that any agent or any host can install the
workbench. This round does **not** add `sync/install.*` scripts (N11) and does
**not** promise 自动安装.

After a successful host install, bootstrap the source runtimes from this
checkout (Node.js `>=20.19` and npm required):

```bash
bash scripts/bootstrap-runtime.sh
```

Windows PowerShell:

```powershell
.\scripts\bootstrap-runtime.ps1
```

### Claude Code（实测可装）

Documented path that has been treated as 实测可装 for this repository:

```text
/plugin marketplace add Frankkk1912/ai4s-literature-workbench
```

Then:

```bash
claude plugin install ai4s-literature-workbench@frank-ai4s-skills
```

The in-product slash form used by the parent plugin docs is:

```text
/plugin install ai4s-literature-workbench@frank-ai4s-skills
```

V13 (Claude / Codex install-path regression) still needs a Frank smoke run on
this checkout. Do not read this section as “already verified in your current
host build”.

### Codex（实测可装）

Documented path that has been treated as 实测可装:

```bash
codex plugin marketplace add <local-or-https>
codex plugin add ai4s-literature-workbench@personal
```

`<local-or-https>` is either this clone path or the repository HTTPS URL.
Example with a local clone:

```bash
codex plugin marketplace add /path/to/ai4s-literature-workbench
codex plugin add ai4s-literature-workbench@personal
```

V13 still needs a Frank smoke run. This section does not record a Codex
product version.

### opencode / Antigravity（未实测）

These hosts are documented only. This repository does **not** add install
scripts for them (N11).

If a given host can consume a Claude-compatible `.claude-plugin` layout or a
URL MCP server, the local clues are:

- plugin manifest: `.claude-plugin/plugin.json`
- MCP stdio servers: `.mcp.json`
- optional loopback MCP HTTP (after `--http`): `http://127.0.0.1:3939/mcp`

**未实测.** This repository does not promise that opencode or Antigravity can
install, load, or use the workbench.

### WorkBuddy / CodeBuddy（未实测 / 待人工核验）

This is a separate compatibility note, not an install guarantee. **Every
statement in this subsection is 未实测 / 待人工核验.** V12 (WorkBuddy document
review) is Frank’s to confirm against current vendor docs.

External plugin-reference notes (unverified here) describe CodeBuddy CLI
plugins as compatible with a `.claude-plugin` layout. A plausible, still
untested path is to point that CLI at this checkout’s `.claude-plugin/`
manifest the same way a Claude-compatible plugin source would be added.

External MCP-guide notes (unverified here) describe WorkBuddy desktop as
supporting URL-form MCP. A plausible, still untested URL is the loopback MCP
endpoint `http://127.0.0.1:3939/mcp` after the Zotero runtime is started with
`--http`. Local plugin loading on WorkBuddy desktop is **not** verified.

This repository:

- does **not** ship a WorkBuddy one-click installer
- **不承诺** WorkBuddy / CodeBuddy 安装或使用成功（未实测 / 待人工核验）
- does **not** show WorkBuddy as connected on the dashboard without measured
  evidence

## Local configuration wizard and dashboard

The web wizard is an extra UX entry beside the CLI. It is not a replacement.

1. Build and start the Zotero MCP in loopback HTTP mode (no OAuth):

   ```bash
   node runtime/dist/index.js --http --host 127.0.0.1 --port 3939
   ```

2. Open the pairing page: `http://127.0.0.1:3939/admin/onboarding/`
3. Redeem the one-time pairing code from the process stderr (an agent that
   started the server may relay **only** that pairing code; keys must never
   enter chat)
4. Configure optional credentials, then open the dashboard at
   `http://127.0.0.1:3939/admin/onboarding/dashboard`

Details:

- [`docs/onboarding.md`](docs/onboarding.md) — CLI + web wizard, pairing, R12
- [`docs/local-dashboard.md`](docs/local-dashboard.md) — status dashboard
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
- The dashboard never shows **已连接** without measured connection evidence.
  Unverified hosts stay 未知 / 待人工核验. XPI stays **本轮未核验**.

## Docs

| Document | Contents |
| --- | --- |
| [`docs/onboarding.md`](docs/onboarding.md) | Credential wizard (CLI + web), pairing, R12 |
| [`docs/local-dashboard.md`](docs/local-dashboard.md) | Status dashboard |
| [`docs/zotero-xpi.md`](docs/zotero-xpi.md) | XPI build and manual install |
| [`docs/migration-from-parent.md`](docs/migration-from-parent.md) | D8 baseline, parent freeze, V10 |
| [`CHANGELOG.md`](CHANGELOG.md) | Standalone first release notes |

## License

MIT. See [`LICENSE`](LICENSE) and [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md).
