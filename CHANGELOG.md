# Changelog

All notable changes to the standalone AI4S Literature Workbench repository are
documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/).
Versioning follows [Semantic Versioning](https://semver.org/lang/zh-CN/).

## [Unreleased]

### Changed

- README and README_CN: install by app (Claude Desktop `.mcpb`, a pasted prompt for the plugin hosts, Trae/Qoder by hand), what to expect before the first run, a symptom table and a plain FAQ, written separately in Chinese rather than translated. New `docs/getting-started.md` and `docs/getting-started_CN.md`; `onboarding.md` and `local-dashboard.md` moved to `docs/dev/`. `tests/readme-sync.test.mjs` fails when a README command is missing from `INSTALL.md`.
- `docs/dev/release-checklist.md`: the automated and manual release gates, with the three numbers to record per beginner run.

### Added

- Zotero add-on 0.1.14: the update feed (`literature-metrics/update.json`) now carries a
  SHA-256 `update_hash`, and the release build fails when the feed does not describe the add-on
  it packages. Copies installed before 0.1.14 checked a retired repository and never updated;
  install the new file once by hand.
- Every release carries the add-on a second time as `literature-metrics.xpi`, so
  `releases/latest/download/literature-metrics.xpi` always gives the newest one. The setup page,
  `setup_status` and the install guide link to it and show the four install steps in Chinese
  and English.
- Reading the Zotero library on this computer needs no key and now survives opening Zotero after
  the tools started; `setup_status` says whether Zotero is closed or its "Allow other
  applications on this computer to communicate with Zotero" setting is off. Item children are
  read locally too.
- Saving to Zotero without a key when Zotero 10 or later is open (`ZOTEUS_LOCAL_WRITES`). Tested
  against a stand-in for the documented protocol only.
- `docs/dev/zotero-local-write-spike.md`: finding on an add-on write endpoint (not built).

### Fixed

- The add-on status reads where an add-on updates from, not where its file was saved, so a
  download from the browser is no longer reported as "not from this project".
- `npm run package` no longer leaves an older `.xpi` in `dist/` for the release build to pick up.

## [0.1.0] - 2026-09-30

Standalone first release covering delivered milestones M1–M5 (fresh-seed
migration, three-platform CI, shared onboarding core, local web wizard, local
status dashboard). Host product versions for Claude Code / Codex / WorkBuddy
are omitted (待 Frank 核对 / 未实测).

### Added

- Skills (`literature-research`, `literature-manager`, `literature-writing`),
  Zotero / Fulltext / database-browser runtimes, plugin manifests, and the
  first-party `literature-metrics` XPI source, migrated into this private
  repository as a fresh seed (M1). One-time parent hash baseline is archived
  in `docs/migration-from-parent.md` (commit `936b3cb`).
- Local web configuration wizard on the existing Zotero MCP HTTP transport
  (M4): loopback-only pairing-code session, credential verify/save for
  Zotero / PubMed / EasyScholar, CLI `scripts/onboard.mjs` retained.
- Local configuration status dashboard (M5): five sections (凭证 / MCP 构建产物 /
  Zotero Desktop XPI / 宿主线索 / 连接证据) with evidence-graded display.
  Unmeasured rows stay 未知 / 待人工核验 / 本轮未核验; 已连接 requires measured
  evidence.
- Three-platform CI (Windows, macOS, Linux) plus a secret-scan gate on every
  push/merge (M2).

### Changed

- None in this standalone first release. Parent `markets` / `sync` stay frozen
  in the parent repository; this checkout does not rewrite them.

### Deprecated

- None.

### Removed

- None. Parent history was never mirrored into this fresh seed; that is an
  exclusion, not a removal from this repository.

### Fixed

- None recorded as a user-facing fix in this first changelog. Platform CI
  follow-ups during M2/M4 stay in git history rather than as a separate
  released patch.

### Security

- Management routes: loopback-only; OAuth / non-loopback HTTP does not
  register them.
- Pairing code: 16 random bytes, 5-minute TTL, single use, constant-time
  compare, attempt limiting; never in URL or server log. Agents may relay
  **only** that code (D12); keys never enter chat.
- Session: 30-minute HttpOnly SameSite=Strict cookie; in-memory; discarded on
  restart. All management GET/POST require the session.
- Host / Origin / CSRF / DNS-rebinding checks cover management GET and POST.
- Credential paths follow R12: browser → local POST body; Zotero
  `Zotero-API-Key` Header; PubMed `api_key` / EasyScholar `secretKey` query
  parameters on official HTTPS checks only (D10). Local / browser URL,
  address bar, logs, errors, responses, reports, and chat must not contain
  plaintext keys or key-bearing URLs.
- Secret-scan gate: pinned automated scanner; any hit blocks push/merge.

## Non-goals (this release)

From Plan §3. This repository does **not** deliver:

- Zotero import-history pages (N1)
- Remote shared web / multi-user access (N2)
- WorkBuddy one-click install (N3); WorkBuddy / CodeBuddy remain
  **未实测 / 待人工核验**
- XPI feature expansion (N4)
- Parent-repository edits (N5, V10)
- Parent git-history mirror (N6)
- A new always-on dashboard process or Docker service (N7)
- Connectivity impersonation, or XPI install-state probing this round (N8)
- MCP tool-contract changes (N9)
- Parent → new-repository cutover (N10, Q4)
- New multi-agent install scripts such as `sync/install.*` (N11)
- Manual secret-scan waiver as a pass path (N12)

## Support matrix (draft)

Columns are **实测** vs **未实测**. This matrix does not promise that any
agent or any host can install the workbench.

| Target | 实测 | 未实测 / 待人工核验 |
| --- | --- | --- |
| Claude Code marketplace / plugin install path | Documented as 实测可装; V13 Frank smoke still due | Host product version 待 Frank 核对 |
| Codex marketplace / plugin add path | Documented as 实测可装; V13 Frank smoke still due | Host product version 待 Frank 核对 |
| Windows / macOS / Linux CI + secret-scan | M2/M5 CI jobs reported green | — |
| Local wizard + dashboard (loopback HTTP) | Implemented and covered by automated tests | V6/V7 browser sign-off is Frank’s |
| opencode | — | 未实测; docs only, no new install script |
| Antigravity | — | 未实测; docs only, no new install script |
| WorkBuddy / CodeBuddy | — | 未实测 / 待人工核验 (V12) |
| XPI installed inside Zotero Desktop | — | 本轮未核验 |
| Measured MCP “已连接” | — | Not displayed without measured evidence |
