# Release checklist

Phase 4 of the [zero-terminal onboarding plan](zero-terminal-onboarding-plan.md). The standing
definition of done is the Codex transcript that started the plan: a clean Windows PC, one pasted
prompt, and the goal of seeing the partition columns.

## 1. Automated (must be green before tagging)

| Check | Where |
| --- | --- |
| Tests and typechecks, runtime and full-text | `Workbench CI`, Windows, macOS, Linux |
| Each bundle starts over stdio with no `node_modules` and lists its tools (19 / 6) | `scripts/verify-bundles.mjs`, same jobs |
| Double-click launchers run the bundle with `--setup` | `scripts/verify-launchers.mjs` |
| The wizard stores a key, masks it, rejects a bad one | runtime and root tests, loopback |
| README commands, INSTALL.md and the manifests agree | `tests/readme-sync.test.mjs` |
| Add-on update feed matches the packaged add-on | `npm run package` in `literature-metrics/`, `scripts/verify-release.mjs` |
| Release assets build and pass `verify-release` | `Release assets` workflow (also as a dry run in `Workbench CI`) |
| Secret scan | `gitleaks`, full history |

## 2. Manual (record each run on video)

Clean machine, nothing installed: no Node, Git or uv. Start with Windows 11 and macOS.
Order of hosts: WorkBuddy, then Codex and Claude Desktop, then DeepSeek Harness, then CodeBuddy and
Claude Code. Trae and Qoder are best-effort.

For each host and OS, with the beginner typing nothing:

1. Install by the route in the README.
2. The setup page opens (or the address and code, or the double-click file).
3. First search returns a ranked list.
4. Zotero add-on installed by hand; partition columns visible after a sync and a restart.
5. Zotero reading works after ticking "Allow other applications on this computer to communicate with Zotero".
6. Saving: with a Zotero key; and, on Zotero 10 or later, without one.

### Numbers to record per beginner run

| Host | OS | Beginner | Minutes to first search | Commands typed | Agent turns | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| | | | | | | |

**Gate:** a release ships only if the manual rows pass with zero typed commands and a first search
in 10 minutes or less, for three beginners on the release candidate.

## 3. After publishing

- Download the release assets on a fresh machine and run `sha256sum -c SHA256SUMS.txt` (or `Get-FileHash`).
- Check that `releases/latest/download/literature-metrics.xpi` downloads.
- **First update check:** install an older add-on build, publish the next release, and confirm
  Zotero offers the update from the GitHub address in `update.json`. Zotero's documentation does not
  say whether a redirecting address is followed; this is the only way to know.
