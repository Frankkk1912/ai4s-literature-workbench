<h1 align="center">📚 AI4S Literature Workbench</h1>

<p align="center">
  <strong>An all-in-one, evidence-traced literature workbench powered by Zotero and AI Agents</strong><br>
  <em>Write literature reviews and proposals without losing track of where every citation came from</em>
</p>

<p align="center">
  🔎 Natural-Language Search · 📚 Zotero Integration · ✍️ Traceable Citations
</p>
<p align="center">
  <a href="https://github.com/Frankkk1912/ai4s-literature-workbench/releases">📥 Releases</a> ·
  <a href="README_CN.md">🇨🇳 中文文档</a> ·
  <a href="#-quick-start">🚀 Quick Start</a> ·
  <a href="docs/getting-started.md">📖 Getting Started</a>
</p>

---

## 🤔 Why This Workbench?

> 🎓 Your proposal or group meeting is right around the corner. You are still paging through PubMed, looking up impact factors and JCR/CAS quartiles journal by journal, and importing papers into Zotero by hand under a tangle of inconsistent tags. By the time you start writing, you can no longer tell which claim came from which paper.
>
> **What if a single prompt to your AI agent could return a curated reading list with journal metrics, sync and tag everything into Zotero, and produce an initial draft with traceable citations already attached?**

**AI4S Literature Workbench** plugs directly into the AI agent client you already use. Describe your research question in plain language, and the workbench runs a deduplicated search across PubMed and OpenAlex, logs the exact queries and counts, and syncs the selected papers alongside the search record into a single Zotero collection. When you move to drafting, inline `[EV:n]` markers tie every claim back to saved evidence so you can focus on reading and critical review. Because retrieval is capped and initial screening relies primarily on abstracts, both constraints are explicitly logged in the search record for you to inspect before drawing conclusions.

### 😩 Traditional Workflow Pain Points

| Bottleneck | Manual Workflow |
| --- | --- |
| 🔁 Multi-database search | Paging through PubMed result by result, then repeating the process in another database |
| 📊 Journal metrics | Looking up Impact Factor, JCR quartiles, and CAS zones one journal at a time |
| 📥 Library management | Importing items into Zotero manually and catching duplicates halfway through organizing |
| 📝 Review writing | Pausing mid-sentence because you can no longer trace a claim back to its source paper |

### 💡 A Three-Step Closed Loop

| Stage | Deliverable |
| --- | --- |
| 🔎 **Search & Rank** | Queries PubMed and OpenAlex in parallel, deduplicates by DOI/PMID, logs a full search record, and assigns Priority 1–3 to guide reading order |
| 📚 **Sync to Zotero** | Matches existing Zotero items by exact DOI/PMID to avoid duplicates, archiving both papers and the search note in one collection |
| ✍️ **Traceable Drafting** | Tags claims with `[EV:n]` pointing to saved evidence; flags abstract-only, weak, or unresolved citations in a dedicated verification list |

<!-- GIF: one sentence in, a Zotero collection out -->
<!-- GIF: IF, JCR, and CAS columns with Priority stars in Zotero -->
<!-- GIF: a review paragraph with [EV:n] beside the reference check list -->

## ⚔️ How It Compares

| | AI4S Literature Workbench | Manual Workflow | General Chatbots |
| --- | --- | --- | --- |
| 📄 **Source of Papers** | Live queries against PubMed and OpenAlex, merged by DOI or PMID | Manual browsing across database websites | Generated from model memory; prone to hallucinated or non-existent citations |
| 📝 **Search Audit Trail** | Automatically generates `report.md` with the question, date, databases, exact queries, and hit/dedup/selected counts | Ad-hoc personal notes, easy to lose or keep inconsistent | Leaves no reproducible query log in your project directory |
| 📚 **Zotero Integration** | Zero-key local read; writes via Zotero API key or local authorization in Zotero 10+ | Manual item-by-item import and tagging | No read or write access to your local Zotero library |
| 📊 **IF & Quartiles** | Bundled 2025 JCR/IF table matched by ISSN; CAS zones populated via EasyScholar or a custom metrics file | Manual lookup per journal | Metrics cited in chat are unverified, often outdated, and difficult to audit |
| ✍️ **Review Drafting** | Grounded strictly in saved evidence with `[EV:n]` links; abstract-only or uncertain citations go to a check list | Relies on memory and manual note-hunting | Unaware of your curated evidence set; claims cannot be verified against your library |

> Built for the workflow every researcher faces before a deadline: the research question is clear, and you need an auditable search record, a clean Zotero collection, and a draft where every claim maps back to a real paper.

## 🧰 Core Modules & Architecture

Three specialized skills handle the pipeline: `literature-research` runs retrieval and ranking, `literature-manager` manages Zotero syncing and cleanup, and `literature-writing` handles evidence-traced drafting. On first run, `ai4s-setup` inspects your environment and reports what is ready. Under the hood, the Zotero MCP server exposes 22 tools—12 of which remain active in read-only mode without modifying your library (two of those solely launch the local key setup page or download the search helper).

### 🔎 Retrieval & Ranking

Default searches query PubMed and OpenAlex in parallel. OpenAlex is free and requires no API key; if a contact email is already configured locally, requests automatically use OpenAlex's polite pool without writing your address into the search plan.

Deduplication merges records by DOI first, falling back to PMID. A script generates `report.md` as an immutable search log containing the research question, date, databases, exact query strings, caps, hit/dedup/selected counts, and the selected paper table. Detailed scoring breakdowns are stored in `ranked_all.json`. This stage strictly gathers and logs evidence—synthesis and prose drafting are deferred to `literature-writing`.

Relevance scores follow deterministic rules across title, abstract, MeSH terms, recency, and related signals, with every point explained in `ranked_all.json`. **Priority (1–3)** indicates reading order for the current topic: selected papers default to `1`; during the relevance pass, the agent upgrades papers worth close reading (key mechanisms, methods, reviews, or contrasting findings) to `2` and must-reads to `3`, each accompanied by a short reason code. Journal Impact Factor stays in its own metadata column rather than distorting reading priority. You can adjust Priority stars manually at any time, and subsequent imports preserve your existing Priority tags.

Journal metrics default to a bundled, vetted 2025 JCR/IF table matched by ISSN and attached alongside each record without altering the search recall. CAS zones are populated via EasyScholar lookups or a custom metrics file you provide.

Additional sources: arXiv is included only when explicitly requested; Web of Science is supported via official CSV/TSV exports you have already downloaded; institutional subscription databases remain in your local browser. Fetching open-access PDFs runs as a separate step—until the full text is retrieved, every hit is treated strictly as abstract-level evidence.

### 📚 Zotero Sync

Reading your local Zotero library requires no API key. Open Zotero, go to **Settings → Advanced**, and enable **Allow other applications on this computer to communicate with Zotero**.

Writing to Zotero works via two paths: configuring a Zotero API key, or running Zotero 10+ locally and selecting **Always Allow** when Zotero prompts for permission (earlier versions support read-only local connections only). *Note: The keyless local write path has been validated against a mock implementation of the documented protocol and has not yet been verified against a live Zotero 10+ desktop window.*

Project sync matches on exact DOI or PMID to reuse existing library items without creating duplicates, saving the search record as a note inside the target collection. Fuzzy title-plus-year matches are flagged as candidates for your explicit confirmation before being treated as the same paper.

### 🏷️ Tag Management

`zotero_tag_manager` cleans up duplicate and unused tags through a strict `scan` → `plan` → `apply` workflow. `plan` generates a hashed change plan without touching Zotero or your controlled vocabulary; `apply` runs a dry-run first and executes writes only after you confirm the plan hash.

When merging tags, retired tags are folded into the surviving tag's aliases, with both item updates and vocabulary changes logged in a single receipt. Untargeted tags remain intact on every item. Structured tags (`Priority`, `Article Type`, `JCR`, `CAS`) are never modified unless explicitly named in the plan and approved by you.

### ✍️ Evidence-Traced Writing

Drafting requires existing `ranked_all.json` and search record files. If either is missing, the skill halts and offers to run a search first so that no draft is generated without grounded evidence.

Drafts attach `[EV:n]` markers (optionally paired with PMID or DOI) to claims and output a companion reference audit table. Any citation that is weak, abstract-only, or unresolved is automatically separated into `references_to_check.md` for manual verification.

An optional one-sentence Chinese summary can be generated from titles and abstracts upon request for quick library triage. Substantive conclusions always trace back to the ranked evidence or retrieved full text.

### 📊 The `literature-metrics` Zotero Add-on

`literature-metrics` is a standalone companion plugin for Zotero Desktop. Download [`literature-metrics.xpi`](https://github.com/Frankkk1912/ai4s-literature-workbench/releases/latest/download/literature-metrics.xpi), open Zotero, go to **Tools → Add-ons → Gear icon → Install Add-on From File…**, and restart. Full installation and upgrade instructions are in `docs/zotero-xpi.md`.

The add-on introduces color-coded **IF / JCR / CAS** columns, **Priority** stars (synced to the 1–3 reading scale), **Article Type**, **Agent Tags**, and a one-line **AI Summary** column. Clicking the stars, pressing `1` / `2` / `3`, or using the **Set Priority** context menu are the only write actions the add-on performs, touching only Priority tags.

Column values are read directly from each item's `Extra` field. After installing the add-on, ask your agent to sync or refresh a collection to populate the metrics. All lookups are handled by the MCP tools, while API keys stay isolated on the local setup page.

### 🔑 Local-Only API Key Management

All API keys are optional—searching, ranking, and drafting work out of the box without them.

When you choose to add a key, the agent calls `open_setup` to launch a local configuration page in your browser with masked input fields. Your keys are saved to a private local file on your machine; they are never pasted into chat or exposed to the agent context.

- **PubMed API key** (free with an NCBI account): increases request rate limits.
- **Zotero API key** (free with a Zotero account): enables writing to your library.
- **EasyScholar API key**: enables additional journal ratings, including CAS zones.

Direct registration links for each service are provided on the setup page.

## 🗣️ Example Prompts

### 1. Search and Rank Literature
```text
Retrieve and rank PubMed and OpenAlex evidence on GLP-1 receptor agonists and cardiovascular outcomes. Save the search record for later writing.
```

### 2. Sync to a Zotero Collection
```text
Sync this search record and the selected papers into a Zotero collection named "GLP-1 CVD Project". Reuse items that match on DOI or PMID.
```

### 3. Draft an Evidence-Traced Review Section
```text
Draft an English review section from my saved ranked evidence and search record. Use [EV:n] placeholders and list references that need checking.
```

## 🚀 Quick Start

### Prerequisites
- A supported AI agent client: **Claude Desktop**, **Claude Code**, **Codex**, **ChatGPT desktop**, WorkBuddy, CodeBuddy, Trae, or Qoder.
- **Zotero Desktop** (optional, required for collection syncing and journal metric columns).
- A web browser (for entering optional API keys on the local setup page).

Nothing else needs manual installation. On your first search, the workbench asks for confirmation and downloads an ~15 MB search helper into your user directory (along with a local Python runtime if none is available)—no admin privileges or system-wide changes required. If your client requires Node.js, the agent will notify you and provide the download link.

### 1. Installation (Choose Your Client)

**Claude desktop Code tab:** Download `ai4s-literature-workbench-<version>.zip` from [Latest Release](https://github.com/Frankkk1912/ai4s-literature-workbench/releases/latest), check `SHA256SUMS.txt`, then choose **Settings → Plugins → Add → Upload plugin**. Upload and recognition of four skills and two local servers were verified on Mac with v0.2.0; that published zip has broken relative MCP paths. MCP startup with the path fix is not yet desktop-verified or in that published asset. Alternative (unverified): **Add → Add marketplace**, enter `Frankkk1912/ai4s-literature-workbench`, and build the source once. Then `/reload-plugins` or start a new session. In this tab, `/plugin` opens Plugins settings, not the terminal installer.

**Claude desktop Chat:** Upload the same zip for **four skills only** (verified on Mac with v0.2.0); Chat ignores plugin-local MCP servers, including plugin-declared `.mcpb` bundles; Code loads them. Then separately download **both** `ai4s-literature-zotero-<version>.mcpb` and `ai4s-literature-fulltext-<version>.mcpb`, check each against `SHA256SUMS.txt`, and stop if either is missing or fails the check. Open each (`open <file>` on Mac, `start "" <file>` on Windows), or hand each to the user to double-click. For Zotero, leave both optional settings default and press **Install**; for fulltext, press **Install** (no required settings or keys). Nothing works until the user installs them. Both extensions are CI-built/validated, not live-verified. Fulltext provides OA-first fetch and PDF verification, not Zotero credentials or institutional login. Never ask an agent to edit files under `~/Library/Application Support/Claude/`: Mac protects that directory and agent access was denied. Manual config is a user-only last resort in [INSTALL.md](INSTALL.md). Never paste API keys into chat.

Both separate `.mcpb` extensions use Claude Desktop's bundled Node.js (version unverified; requires ≥ 22.13). Uploaded plugins sync across Chat, Cowork and Code on the claude.ai account; tool support differs by entry point.

**Terminal Claude Code, Codex, ChatGPT desktop, WorkBuddy**: Paste the following prompt verbatim into your client:

```text
Please install the plugin from
https://github.com/Frankkk1912/ai4s-literature-workbench.git
into this app. Follow INSTALL.md exactly, and if you cannot open the repository read
https://raw.githubusercontent.com/Frankkk1912/ai4s-literature-workbench/main/INSTALL.md
Do not add steps of your own. When it's done, tell me in plain language what works now and what I need to do myself.
```

**Trae, Qoder**: Follow the **Other agents & manual install** section below.

If your client prompts for permission to access GitHub or the network, select **Allow** so the installation can complete.

> **Verification status:** Tested on Windows 11 via MCP configuration files for both WorkBuddy and ChatGPT desktop (note that the ChatGPT MCP file route connects tools without loading skills). Mac Claude plugin upload and four Chat skills are verified; fixed MCP startup in desktop Code, desktop Add marketplace, and both separate `.mcpb` installs remain unverified. Also unverified: WorkBuddy's in-app marketplace, CodeBuddy, ChatGPT desktop on macOS, and the Codex plugin command inside ChatGPT desktop.

### 2. First Run

Where tools are connected, the agent runs `ai4s-setup`, reports what works and offers only missing keys plus the Zotero add-on. If all keys are set, it says you can ask for the key page to change one. All are optional. In skills-only Claude Chat, setup explains the limitation and guides the two separate extension installs instead of claiming search works.

- **API keys are optional:** Search, ranking, and drafting work with zero keys. Add keys only through the local setup page, never in chat.
- **Local Zotero read (keyless):** Enable **Settings → Advanced → Allow other applications on this computer to communicate with Zotero**.
- **Zotero write:** Configure a Zotero API key on the setup page, or use Zotero 10+ and choose **Always Allow** when prompted.
- **IF / JCR / CAS columns:** Install [`literature-metrics.xpi`](https://github.com/Frankkk1912/ai4s-literature-workbench/releases/latest/download/literature-metrics.xpi) via **Tools → Add-ons → Gear icon → Install Add-on From File…**, restart Zotero, and ask your agent to sync or refresh a collection to populate the data.

### 3. Run Your First Search

Start with the **Search and Rank Literature** prompt above. Your first search typically completes within a few minutes.

### Troubleshooting

| Symptom | Resolution |
| --- | --- |
| `"My search tools are not connected yet"` | Restart your client and ask it to run `ai4s-setup`. |
| Local setup page does not open automatically | Open the URL provided by the agent and enter the short code, or double-click `Setup AI4S.bat` (Windows) / `Setup AI4S.command` (macOS) in the extracted release folder. On macOS, if Gatekeeper blocks it, right-click → **Open** → **Open**. |
| Cannot read local Zotero library | Verify **Settings → Advanced → Allow other applications on this computer to communicate with Zotero** is checked. |
| Cannot save items to Zotero | Add a Zotero API key on the local setup page, or use Zotero 10+ and select **Always Allow** on the permission dialog. |
| IF / JCR / CAS columns are missing or empty | Confirm `literature-metrics.xpi` is installed, restart Zotero, and ask the agent to sync or refresh the collection. |
| Client requests GitHub or network access | Select **Allow**. |

For a full walkthrough, see `docs/getting-started.md`.

### About Optional API Keys

- Keys are stored locally in a private file on your computer and are never exposed in chat transcripts.
- PubMed and Zotero API keys are free with standard accounts; EasyScholar issues keys under its own terms.
- Public sources power core search without any keys. Optional keys unlock higher PubMed rate limits, Zotero writes, and extended journal metrics such as CAS zones.

<details>
<summary>Other agents & manual install</summary>

Requires Git and Node.js ≥ 22.13 (with npm). Clone the repository and run the bootstrap script once. The first search automatically downloads the search helper—you do not need to install `uv` manually.

```bash
git clone https://github.com/Frankkk1912/ai4s-literature-workbench.git
cd ai4s-literature-workbench
node scripts/bootstrap.mjs
```

Use the exact same three commands on Windows. Invoke the script directly via `node`; do not use `.ps1` or `.sh` wrappers.

**Claude Code terminal** (type `/plugin` install commands only in the terminal, not the desktop Code tab)

```bash
claude plugin marketplace add Frankkk1912/ai4s-literature-workbench
claude plugin install ai4s-literature-workbench@ai4s-literature-workbench
```

**Codex**

```bash
codex plugin marketplace add https://github.com/Frankkk1912/ai4s-literature-workbench.git
codex plugin add ai4s-literature-workbench@ai4s-literature-workbench
```

**ChatGPT desktop**: Prefer the installation prompt above. For manual setup, use the Codex commands if the `codex` CLI is installed; otherwise follow the MCP configuration file route in [INSTALL.md](INSTALL.md) (note that the MCP file route does not load skills). Verified on Windows 11; not yet tested on macOS.

**CodeBuddy** *(not yet tested on CodeBuddy)*: Run inside the application:

```bash
/plugin marketplace add Frankkk1912/ai4s-literature-workbench
/plugin install ai4s-literature-workbench@ai4s-literature-workbench
```

**Trae / Qoder**: Run from the repository root, replacing `/path/to/project` with your target workspace path:

```bash
node scripts/install-host.mjs --host trae --target /path/to/project
node scripts/install-host.mjs --host qoder --target /path/to/project
```

</details>

<details>
<summary>For developers</summary>

### Project structure

```text
ai4s-literature-workbench/
├── .claude-plugin/            # Claude Code marketplace and plugin manifest
├── .codebuddy-plugin/         # CodeBuddy marketplace and plugin manifest
├── .codex-plugin/             # Codex manifest and marketplace
├── docs/                      # Setup and component guides
├── release/launchers/         # Setup AI4S.bat and Setup AI4S.command
├── scripts/                   # Install, build, and verification
├── skills/                    # ai4s-setup, research, Zotero, writing
├── runtime/                   # Zotero tools and the local key page
├── fulltext-runtime/          # Open-access full text and PDF checks
├── literature-metrics/        # Zotero Desktop add-on
└── tests/                     # Repository tests
```

`install-manifest.json` matches `INSTALL.md`. Agents follow those two files. This page is the human one.

### Development

From the repository root. The bootstrap installs and builds the Zotero and full-text runtimes:

```bash
node scripts/bootstrap.mjs
node --import ./runtime/node_modules/tsx/dist/loader.mjs --test "tests/*.test.mjs"
(cd runtime && npm run typecheck && npm test)
(cd fulltext-runtime && npm run typecheck && npm test)
(cd literature-metrics && npm ci && npm run check && npm test && npm run package)
```

### Docs

- `docs/getting-started.md`
- `docs/zotero-xpi.md`
- `docs/dev/onboarding.md`
- `docs/dev/local-dashboard.md`
- `docs/dev/release-checklist.md`
- `SECURITY.md`

</details>

## 🤝 Contributing

Issues and pull requests are welcome.

## 📄 License

MIT, see `LICENSE`. © Frank AI4S Skill contributors.

**No Evidence, No Conclusion.** A scientific claim traces back to saved evidence. The Zotero layer credits Oscar Devos's Zoteus (`https://github.com/oscardvs/zoteus`). Component credits are in `THIRD_PARTY_NOTICES.md`.

---

<p align="center">
  <sub>📚 AI4S Literature Workbench · Which sentence came from which paper.</sub>
</p>
