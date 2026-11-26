# AGENTS.md

Guidance for coding agents (Cursor, Claude Code, Codex, pi, and others) working in this
repository. Humans should start with `README.md`. Install steps for end users live only in
`INSTALL.md` and `install-manifest.json`; do not duplicate or invent them here.

## Project overview

AI4S Literature Workbench is a local, single-user toolkit for literature search, Zotero library
management, and evidence-traced writing. It ships as agent skills plus two MCP runtimes and a
Zotero Desktop add-on.

| Path | What it is |
| --- | --- |
| `runtime/` | Zotero MCP server (TypeScript, derived from Zoteus) plus the local key/setup page. The `workbench` tool profile exposes the tools listed in `WORKBENCH_TOOL_NAMES` in `runtime/src/server.ts`. |
| `fulltext-runtime/` | Open-access full-text MCP server: resolves PMC (via Europe PMC) and explicit OA URLs, validates main-article PDFs, writes hashed handoffs. It never holds Zotero credentials. |
| `literature-metrics/` | Zotero 7+ add-on (XPI). Display layer: IF/JCR/CAS/Priority/tag columns read from item `Extra` and tags. Its only write is the Priority tag. |
| `skills/` | `ai4s-setup`, `literature-research`, `literature-manager`, `literature-writing`. Each `SKILL.md` description must stay under 500 characters (`tests/skill-descriptions.test.mjs`). |
| `scripts/` | Bootstrap, bundling, plugin assembly, release packaging, and `verify-*` checks. |
| `tests/` | Repository-level `node:test` suites (install docs, README sync, onboarding, update feed, packaging). |
| `release/` | Double-click launchers (`launchers/`) and Claude Desktop `.mcpb` sources (`mcpb/`, `mcpb-fulltext/`). |
| `.claude-plugin/`, `.codex-plugin/`, `.codebuddy-plugin/` | Host plugin manifests. `.mcp.json` starts both runtimes from `dist/`. |
| `docs/` | User guides; `docs/dev/` holds the release checklist, onboarding notes, and removed surfaces. |

## Environment

- Node.js `>=22.13` (CI pins `22.13`; pdfjs-dist needs it). npm with the committed lockfiles.
- There is no root `package.json`. Each of `runtime/`, `fulltext-runtime/`, `literature-metrics/`
  is its own npm package.

## Commands

From the repository root. These are the commands CI runs (`.github/workflows/workbench-ci.yml`).

```bash
# Install and build both runtimes in one step
node scripts/bootstrap.mjs

# Zotero runtime
(cd runtime && npm ci && npm run typecheck && npm test && npm run build)

# Root tests (need runtime/node_modules for the tsx loader; keep the glob quoted)
node --import ./runtime/node_modules/tsx/dist/loader.mjs --test "tests/*.test.mjs"

# Full-text runtime
(cd fulltext-runtime && npm ci && npm run typecheck && npm test && npm run build)

# Zotero add-on
(cd literature-metrics && npm ci && npm test && npm run check && npm run package)

# Structure, bundles, launchers (after both dist builds)
node scripts/assemble-plugin.mjs check
(cd runtime && npm run bundle) && (cd fulltext-runtime && npm run bundle)
node scripts/verify-bundles.mjs
node scripts/verify-launchers.mjs

# Release assets dry run (publishes nothing)
node scripts/package-release.mjs --out release-out && node scripts/verify-release.mjs release-out
```

`runtime` also has `npm run lint` (not run in CI).

**Add-on update feed.** Any change to a file inside `literature-metrics/` changes the XPI hash.
After such a change, run `cd literature-metrics && npm run package -- --update-feed` and commit
the rewritten `update.json`; otherwise `npm run package` and the release check fail. When the
add-on version changes, also point `update_link` at the release tag that will carry it (see
`docs/zotero-xpi.md`).

**Tool lists.** Adding, removing, or renaming a workbench tool means updating
`WORKBENCH_TOOL_NAMES` (`runtime/src/server.ts`), `EXPECTED_RUNTIME_TOOLS`
(`scripts/verify-bundles.mjs`), the list in `scripts/verify-runtime.mjs`, and the count asserted in
`tests/install-docs.test.mjs`. Full-text tools: `EXPECTED_FULLTEXT_TOOLS` and
`scripts/verify-fulltext-runtime.mjs`.

## Workflow rules

1. Before starting, `git fetch origin` and branch from the latest `origin/main`.
2. One task, one branch, one PR. Branch names follow what the history uses:
   `feat/…`, `fix/…`, `docs/…`, `chore/…`, `release/vX.Y.Z`; cloud agents may prefix with the
   agent (`cursor/<topic>-<id>`, `claude/<topic>-<id>`).
3. Never push to `main`. Never force-push a branch someone else is using.
4. Open a PR into `main` and get CI green: `secret-scan`, `test (ubuntu-latest)`,
   `test (macos-latest)`, `test (windows-latest)`, and `release assets (dry run)`.
5. The maintainer (Frank, @Frankkk1912) decides merges, releases and tags, closing issues, and
   deleting branches. Agents do not do these unless he asks for that specific action.
6. Commit messages use conventional style: `feat:`, `fix:`, `docs:`, `chore:`, `test:`, with an
   optional scope (`fix(claude): …`).
7. Add a `CHANGELOG.md` entry for user-visible changes.

### Version bumps

A workbench version bump (see commits `e6d69f5` and `d961672` for v0.2.1) touches:

- `.claude-plugin/plugin.json`, `.codex-plugin/plugin.json`, `.codebuddy-plugin/plugin.json`
- `runtime/package.json`, `runtime/package-lock.json`, `runtime/server.json`,
  `runtime/dxt/manifest.json`, `runtime/src/index.ts`, `runtime/src/server.ts`,
  `runtime/docs/distribution.md`
- `fulltext-runtime/package.json`, `fulltext-runtime/package-lock.json`,
  `fulltext-runtime/src/server.ts`
- `scripts/install-host.mjs`
- Add-on: `literature-metrics/manifest.json`, `package.json`, `package-lock.json`,
  `update.json` (via `--update-feed`), and `tests/update-feed.test.mjs`
- `CHANGELOG.md`

The release tag (without `v`) must equal the version in `.claude-plugin/plugin.json`. Tagging
creates a draft release; follow `docs/dev/release-checklist.md`.

## Roadmap and task tracking

- The roadmap lives in Notion and nowhere else:
  project page <https://app.notion.com/p/4232cc82859380018506d06eed7cf7b7>,
  task database <https://app.notion.com/p/4242cc828593819eaa0bfa79abe046aa>.
  These pages may be private; if you cannot open them, follow your task description.
- If you have Notion access, set the task's status to in progress when you start and note the
  agent and branch in the row. Do not create roadmap files in this repository.

## Multi-agent collaboration

- Cloud agents (Cursor) and local agents (pi, Claude Code, Codex, …) meet only through GitHub
  branches and pull requests.
- Do not give the same task to two agents at once. Check open PRs and branches before starting.
- Work that needs a real Zotero Desktop, a desktop host app, or a clean machine (manual rows in
  `docs/dev/release-checklist.md`) goes to a local agent on the user's machine.

## Constraints

- **No secrets.** Never commit keys, tokens, `.env` files, or Zotero credentials. CI runs
  gitleaks over the full history and working tree. Keys are entered only through `open_setup`.
- **Full text from legitimate sources only.** Use open-access sources (PMC/Europe PMC, OA
  publisher links, and similar) or Zotero's own Find Available PDF. Do not bundle, name, or write
  instructions for shadow-library sources in code or docs.
- **Be polite to external sites.** Rate-limit requests, stop on HTTP 429/403, and never run
  parallel bulk downloads against one host.
- **Zotero writes are gated.** Every write goes plan → dry run → user confirmation → apply with a
  plan hash, and leaves a receipt. Deletions move items to the Zotero trash; nothing is
  permanently deleted.
- **Claim only what is tested.** Tool descriptions and docs must not promise properties (for
  example idempotency) that no test verifies. Project sync was described as safe to re-run and
  still created duplicates.
- Skill descriptions under 500 characters; keep `README.md`, `README_CN.md`, `INSTALL.md`, and
  `install-manifest.json` in step (`tests/readme-sync.test.mjs`, `tests/install-docs.test.mjs`).
