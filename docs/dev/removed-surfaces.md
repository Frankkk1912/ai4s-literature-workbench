# Removed surfaces

Two pieces were taken out of the tree so the default install and CI stay smaller. Open-access full text in `fulltext-runtime/` is unchanged. Official Web of Science CSV/TSV import in `literature-research` is unchanged.

## Database browser

`database-browser-runtime/` was a Playwright broker that opened a visible browser for campus-network database search and export. It is gone, including its tests, the CI Chromium install, `scripts/verify-database-browser-runtime.mjs`, and the install-guide section that told agents to call `database_browser_install`.

To put it back, restore the directory and those references from git history (the commit that deleted them, parent side). The direct dependency was `playwright`; CI also downloaded Chromium.

## DeepSeek Harness

The `dsh` plugin package is not built or documented as an install route. Removed:

- `dsh-plugin/` (`package.json`, `cordis.patch.yml`)
- `scripts/build-dsh-plugin.mjs`, `scripts/verify-dsh-plugin.mjs`, `scripts/verify-dsh-install.mjs`
- the release-workflow steps that installed a pinned `dsh` and uploaded `dsh-ai4s-literature-workbench-*.tgz`
- the DeepSeek blocks in `README.md`, `README_CN.md`, `INSTALL.md`, `install-manifest.json`, and the getting-started pages
- `docs/dev/deepseek-harness-support-plan.md` and `docs/dev/deepseek-harness-test-script.md`

To put it back, restore those paths from the same parent commit, then wire `scripts/package-release.mjs` and `.github/workflows/release.yml` to build and check the tarball again. The earlier design notes lived in the deleted plan file.
