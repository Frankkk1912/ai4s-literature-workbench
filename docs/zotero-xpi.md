# Zotero Desktop XPI (`literature-metrics`)

The XPI is the MCP-adjacent Zotero Desktop add-on for AI4S columns (metrics,
Agent Tags, AI Summary) and the interactive Priority control.

This repository **does not automatically verify** whether the add-on is
installed, enabled, or loaded in Zotero Desktop. The configuration dashboard
label is **本轮未核验**. That is a statement about this round, not a promise
that verification will never exist.

The credential wizard and MCP do **not** install Zotero Desktop add-ons.
This page does **not** say that the add-on will auto-enable after a file
install.

## Build

From this repository root (Node.js `>=20.19`):

```bash
cd literature-metrics && npm run package
```

That is the same command the dashboard lists under XPI details. It writes
`literature-metrics/dist/literature-metrics-<version>.xpi`. Substitute the
version from `literature-metrics/package.json`; do not assume a host or
marketplace version string.

`npm run check` validates the add-on source. This round does not extend XPI
features.

## Manual install

1. Build the XPI as above.
2. Open **Zotero Desktop**.
3. Choose **Tools → Add-ons**.
4. Open the gear menu → **Install Add-on From File…**
5. Select `literature-metrics/dist/literature-metrics-<version>.xpi`.

Whether Zotero then enables the add-on, prompts for a restart, or shows it as
disabled is **未核验** here. Confirm inside Zotero Desktop yourself.

## Dashboard copy

| UI | Meaning |
| --- | --- |
| 本轮未核验 | This round did not inspect Zotero Desktop. Not “已安装”. |
| 查看安装步骤 | Expands the build command and the Tools → Add-ons path |
| evidence | `本轮未检查 Zotero Desktop 内的安装状态` plus the API `verification.level` |

Related: [`onboarding.md`](onboarding.md), [`local-dashboard.md`](local-dashboard.md).
