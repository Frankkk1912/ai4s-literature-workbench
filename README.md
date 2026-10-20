# AI4S Literature Workbench

[中文文档](README_CN.md)

> Turn your research question into a ranked reading list, an organized Zotero collection, and a draft you can trace back to evidence.

![License: MIT](https://img.shields.io/badge/license-MIT-blue)

<!-- Screenshot: Show a Zotero project collection with colored IF/JCR/CAS columns and reading Priority controls. -->
<!-- ![Zotero project collection with journal metrics and reading priorities](assets/zotero-project-collection.png) -->

## What it does
Stop switching between database searches, journal lookups, and scattered citation notes. When you research a biomedical question, you need to know which papers matter—and which claims they actually support.

Describe your question in one sentence. Use the built-in tools to retrieve and rank papers, keep selected evidence with your report in Zotero, and draft from that saved evidence. Review the search coverage and abstract/full-text limits before drawing conclusions.

```mermaid
flowchart LR
    A["Research<br/>literature-research"] --> B["Retrieve & rank<br/>literature-research"]
    B --> C["Zotero sync<br/>literature-manager"]
    C --> D["Evidence writing<br/>literature-writing"]
```

See what you get: a reading table with ranking reasons, matched 2025 JCR metrics, and source links, alongside a research report.
<!-- Screenshot: Show ranked_all.csv beside report.md, with ranking reasons, matched 2025 JCR metrics, and source links. -->
<!-- ![Ranked literature evidence table and research report](assets/retrieval-evidence-table.png) -->

## Try it: say this, get that
### Find papers worth reading
```text
Retrieve and rank PubMed evidence on GLP-1 receptor agonists and cardiovascular outcomes. Save the evidence and report for later writing.
```
Get a deduplicated reading list, ranking reasons, and a saved report you can inspect.

### Keep your project together in Zotero
```text
Sync my finalized literature report and selected papers into a Zotero collection named "GLP-1 CVD Project".
```
Keep your report note and selected papers in the same collection; reuse exact DOI/PMID matches instead of creating them again.

### Draft with evidence you can check
```text
Draft an English literature review section from my saved ranked evidence and report. Use [EV:n] citation placeholders and flag references that need checking.
```
Get a draft with evidence-linked claims and a reference audit table; get a separate check list when citations need attention.
<!-- Screenshot: Show a review paragraph with [EV:n] placeholders beside its reference audit table. -->
<!-- ![Evidence-linked review paragraph and reference audit table](assets/evidence-traced-writing.png) -->

## Why you'll love it
- **Choose your next read** — Compare relevance and ranking reasons, with journal metrics matched from the bundled 2025 JCR table.
- **Find your project again** — Keep selected papers and the current report together in Zotero; request reusable English tags or a Chinese summary sentence when you need them.
- **Check what your draft says** — Trace claims to saved evidence through citation placeholders and a reference audit table.
- **Stay in control of changes** — Preview batch imports and metric refreshes, confirm before writing, and keep a record of changes.
- **Keep keys out of chat** — Enter optional credentials yourself through masked setup on your own computer.
<details>
<summary>Included skills</summary>

`literature-research` — retrieve and rank; `literature-manager` — organize in Zotero; `literature-writing` — draft from evidence.
</details>

## What's inside
The workbench ships in two pieces. Use either on its own, or together.

### Built-in tools for your agent
Your agent can call these on your behalf — they speak the same protocol your agent already understands (MCP, Model Context Protocol), so the conversation stays in plain language.
- **Find and rank** — pull papers from configured sources, dedupe, and rank by relevance. (`search-items`, `find-duplicates`)
- **Sync to your Zotero collection** — match by DOI/PMID, write a single project note, never re-create what you already have. (`sync-literature-project`, `apply-import-plan`, `manage-collections`)
- **Tag and summarize** — clean redundant source tags, apply `AI4S:Semantic:*` tags, add a one-sentence Chinese summary to each item. (`apply-semantic-tags`, `apply-ai-summaries`, `cleanup-auto-tags`, `tag-audit`)
- **Cite and draft** — turn ranked evidence into a draft with `[EV:n]` placeholders, format references, export. (`apply-citation-plan`, `format-bibliography`, `export`)
- **Audit and metrics** — keep an evidence-to-claim table, audit tag consistency, refresh journal indicators. (`tag-audit`, `apply-metrics-plan`)

### Zotero Desktop add-on
A separate XPI you install into Zotero Desktop. It adds columns and controls on the right of your library, all read-only by default:
- Colored **IF / JCR / CAS** columns for at-a-glance journal quality
- **Article Type** auto-detection, **AI Summary** field, **Agent Tags** for fast navigation
- **Priority 1 / 2 / 3** — the only direct write path, set explicitly by you with a star control, number shortcut, or context menu


## Get started

### What you need
- Use **Claude Code** or **Codex** as your agent app.
- Add **Zotero Desktop** if you want to organize your papers there.
- Add optional Zotero, PubMed/NCBI, or EasyScholar credentials for library writes, higher retrieval allowances, or extra journal metrics.
- Let your agent check the technical prerequisites during first-run setup and explain anything you need to install.

### 1. Install
Paste this into Codex, Claude Code, or WorkBuddy:
> Please install the plugin from https://github.com/Frankkk1912/ai4s-literature-workbench.git into this app. Follow INSTALL.md in that repository exactly and do not add steps of your own. When it's done, tell me in plain language what works now and what I need to do myself.

Your app may ask permission to reach GitHub or the network. Choose **Allow**; the install cannot continue without it. WorkBuddy and CodeBuddy support is not yet tested on a real machine.

### 2. First-run setup
- **Optional:** Obtain the credentials you need and enter them through masked setup on your computer—not in chat. Allow Zotero library writes if you want to sync items or notes.
- **Optional:** Ask your agent to build the Zotero add-on for colored metrics and reading priorities. In Zotero, choose **Tools → Add-ons → gear menu → Install Add-on From File…**, select the file it built, and follow Zotero's prompts.

### 3. Say your first prompt
Start with **Find papers worth reading** above. You can retrieve, rank, and draft from saved evidence without optional credentials.

<details>
<summary>Other agents & manual install</summary>

Install Git, Node.js ≥22.13 with npm, and uv. Clone and build:
```bash
git clone https://github.com/Frankkk1912/ai4s-literature-workbench.git
cd ai4s-literature-workbench
node scripts/bootstrap.mjs
```
On Windows, run `git clone` and `cd` as above, then the same `node scripts/bootstrap.mjs` command.
Choose your agent's commands. Run Trae/Qoder commands from this checkout; replace `/path/to/project` with your project folder. Those commands add built-in tools to that project.

**Claude Code**
```bash
claude plugin marketplace add Frankkk1912/ai4s-literature-workbench
claude plugin install ai4s-literature-workbench@ai4s-literature-workbench
```
**Codex**
```bash
codex plugin marketplace add https://github.com/Frankkk1912/ai4s-literature-workbench.git
codex plugin add ai4s-literature-workbench@personal
```
**Trae / Qoder** — choose the line for your app.
```bash
node scripts/install-host.mjs --host trae --target /path/to/project
node scripts/install-host.mjs --host qoder --target /path/to/project
```
</details>

---

## For Developers

### Project Structure
```text
ai4s-literature-workbench/
├── .claude-plugin/            # Claude Code manifests and marketplace
├── .codex-plugin/             # Codex manifest and default prompts
├── docs/                      # Setup and component guides
├── scripts/                   # Install, build, and verification scripts
├── skills/                    # Retrieval, Zotero management, and writing skills
├── runtime/                   # Zotero tools and local configuration service
├── fulltext-runtime/          # Open-access full-text retrieval and PDF checks
├── database-browser-runtime/  # Visible-browser access to authorized databases
├── literature-metrics/        # Zotero Desktop add-on source
└── tests/                     # Repository-level tests
```

### Development
Run from the repository root; build installs the Zotero/full-text dependencies:
```bash
node scripts/bootstrap.mjs
node --import ./runtime/node_modules/tsx/dist/loader.mjs --test "tests/*.test.mjs"
(cd runtime && npm run typecheck && npm test)
(cd fulltext-runtime && npm run typecheck && npm test)
(cd database-browser-runtime && npm ci && npx playwright install chromium && npm run build && npm run typecheck && npm test)
(cd literature-metrics && npm ci && npm run check && npm test && npm run package)
```

### Docs
- [First-run setup and credentials](docs/onboarding.md)
- [Zotero Desktop add-on: build and install](docs/zotero-xpi.md)
- [Local configuration status view](docs/local-dashboard.md)

### Citation & Acknowledgements
Follow **No Evidence, No Conclusion**: trace scientific claims to saved evidence.
Credit Frank AI4S Skill contributors and Oscar Devos's [Zoteus](https://github.com/oscardvs/zoteus). See [third-party notices](THIRD_PARTY_NOTICES.md) for component credits and licenses.

### License
[MIT](LICENSE) © Frank AI4S Skill contributors.
