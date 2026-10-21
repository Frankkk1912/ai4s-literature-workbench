# Zotero Desktop add-on (`literature-metrics`)

The add-on adds the AI4S columns (IF / JCR / CAS, citations), Agent Tags, AI Summary
and the interactive Priority control to Zotero Desktop. It is one file.

## Install (beginners)

1. Download the newest add-on:
   <https://github.com/Frankkk1912/ai4s-literature-workbench/releases/latest/download/literature-metrics.xpi>
   (if nothing downloads, open the [releases page](https://github.com/Frankkk1912/ai4s-literature-workbench/releases)
   and pick the `.xpi` file).
2. Open **Zotero Desktop** and choose **Tools → Add-ons** (中文界面：工具 → 插件).
3. Click the gear at the top right → **Install Add-on From File…**, and pick the file you downloaded.
4. Restart Zotero.

The setup page and `setup_status` show the same four steps in Chinese and English, and say
whether the add-on was **found in your Zotero profile** or is **not installed yet**. Finding
the file is all they can see: this repository does not prove that Zotero loaded the add-on, and
neither the setup page nor the MCP installs or changes Zotero add-ons for you.

## Updates

The add-on's manifest names an update feed, [`literature-metrics/update.json`](../literature-metrics/update.json),
served from this repository's `main` branch. Zotero reads it, and when it lists a newer version
it downloads the file at `update_link`, which is the add-on attached to that GitHub release, and
checks it against `update_hash` (a SHA-256 of the file).

- Every release carries the add-on twice: `literature-metrics-<version>.xpi` and
  `literature-metrics.xpi` (the same bytes under a fixed name, which is what the
  `releases/latest/download/` link above relies on).
- The release build refuses to run when `update.json` does not describe the add-on it is
  packaging: version, link, hash and Zotero range are all checked
  (`literature-metrics/scripts/update-feed.mjs`; `npm run package` checks the hash too).
- Copies installed **before 0.1.14 never update on their own.** They were built from a
  retired private repository and check its address, which no longer answers. Install the newest
  file once by hand; from then on Zotero checks this repository.
- **Not yet confirmed:** Zotero's developer documentation shows `update_link` values that are
  direct download addresses and does not say whether a GitHub release address (which redirects)
  is followed. Other add-ons publish this way, but the first real update has to be watched:
  install an older build, publish the next one, and check that Zotero offers it.

## Build (developers)

From the repository root (Node.js `>=22.13`):

```bash
cd literature-metrics && npm ci && npm run check && npm run package
```

This writes `literature-metrics/dist/literature-metrics-<version>.xpi` (it removes any older
`.xpi` from `dist/` first). The archive is byte-for-byte reproducible and does not contain
`update.json`. **Any change to a file in the add-on changes the hash**, so after editing, run:

```bash
cd literature-metrics && npm run package -- --update-feed
```

to rewrite `update_hash`, and commit `update.json` with the change. When you raise the add-on
version, also point `update_link` at the release tag that will carry the file
(`.../releases/download/v<plugin version>/literature-metrics-<add-on version>.xpi`).

## Dashboard copy

| UI | Meaning |
| --- | --- |
| 已在你的 Zotero 里找到（无法确认已加载） | The add-on is in a Zotero profile, active, from this project. Not proof that it works. |
| 找到了，但无法确认已启用或来自本项目 | Present but disabled, or installed from somewhere else (for example the retired repository). Reinstall the newest file. |
| 尚未安装 | Zotero was found and the add-on is not in it. |
| 没有找到 Zotero | No Zotero profile on this computer. |

Related: [`onboarding.md`](onboarding.md), [`local-dashboard.md`](local-dashboard.md),
[`dev/zotero-local-write-spike.md`](dev/zotero-local-write-spike.md).
