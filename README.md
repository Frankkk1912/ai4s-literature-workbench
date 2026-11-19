<h1 align="center">📚 AI4S Literature Workbench</h1>

<p align="center">
  <strong>One question in. A ranked reading list, a Zotero collection, and a draft that still names the paper.</strong><br>
  <em>Which sentence came from which paper.</em>
</p>

<p align="center">
  🔎 Search with a record · 📚 Papers in your Zotero · ✍️ Drafts you can check
</p>
<p align="center">
  <a href="https://github.com/Frankkk1912/ai4s-literature-workbench/releases">📥 Releases</a> ·
  <a href="README_CN.md">🇨🇳 中文文档</a> ·
  <a href="#-quick-start">🚀 Quick Start</a> ·
  <a href="docs/getting-started.md">📖 Getting started</a>
</p>

---

## 🤔 Why this workbench?

> 🎓 Group meeting is tomorrow, and the proposal is still open. The night before, you are paging through PubMed, looking up the impact factor and the JCR or CAS zone for each journal, importing the keepers into Zotero by hand. When you finally write the review, you cannot find which sentence came from which paper.
>
> **What if you said the question once, and came back to a reading list, a Zotero collection, and a draft that still points at the paper?**

**AI4S Literature Workbench** plugs into the agent app you already use. You describe the question in plain language. It searches PubMed and OpenAlex, merges records that share a DOI or a PMID, and writes the query down. Selected papers and that search note can go into one Zotero collection. When you draft, `[EV:n]` stays next to the sentence and points at a saved paper. The search is capped, and most of what it saw is the abstract. Both limits are written in the search record. Read them before you conclude.

### 😩 The Problem

| Trouble | By hand |
| --- | --- |
| 🔁 Another database | Page through PubMed, then start again in the next database |
| 📊 IF and zone | Impact factor, JCR quartile, CAS zone, one journal at a time |
| 📥 Zotero | Import each item yourself, and notice the duplicate later |
| 📝 The review | Halfway through a sentence, the source paper is gone |

### 💡 The Solution

| | What you get |
| --- | --- |
| 🔎 **Retrieve, then rank** | PubMed and OpenAlex together, duplicates merged on DOI or PMID, a search record, and Priority 1–3 for what to read first on this question |
| 📚 **File it in your library** | An exact DOI or PMID reuses the Zotero item you already have. The search note and the papers share one collection |
| ✍️ **Write with the paper attached** | Drafts use `[EV:n]`. A thin citation goes on a check list |

<!-- GIF: one sentence in, a Zotero collection out -->
<!-- GIF: IF, JCR, and CAS columns with Priority stars in Zotero -->
<!-- GIF: a review paragraph with [EV:n] beside the reference check list -->

## ⚔️ Compared with the other two ways

| | This workbench | By hand | A general chatbot |
| --- | --- | --- | --- |
| 📄 **Where papers come from** | PubMed and OpenAlex, merged when the DOI or PMID matches | You page through the sites | The model answers from memory. It can name papers that do not exist |
| 📝 **Search record** | `report.md` stores the question, date, databases, exact queries, and the hit, dedup, and selected counts | Whatever you wrote down | It does not leave the query in your project files |
| 📚 **Your Zotero** | Reads the library on this computer with no key. Saves with a Zotero key, or through Zotero 10 or later (it asks once) | You import each item | It has no access to your Zotero |
| 📊 **IF and zone** | Bundled 2025 JCR/IF, matched by ISSN. CAS shows up once an EasyScholar lookup, or a metrics file you supplied, has been written onto the item | You look each journal up | A number from chat is not read from the 2025 table shipped here, and it can be wrong |
| ✍️ **The draft** | Claims use `[EV:n]` back to saved evidence. Weak, abstract-only, or unresolved citations get a check list | You keep the mapping yourself | It did not read the evidence you saved |

> It is built for the night before the meeting: the question is clear, and you want a search you can recheck, a Zotero collection, and a draft that still names the paper.

## 🧰 Features

Three skills do the work: `literature-research` retrieves, `literature-manager` files it in Zotero, `literature-writing` drafts. `ai4s-setup` is the first-run check. The Zotero connector exposes 22 tools. In read-only mode, 12 remain. Those 12 do not modify the library. Two of them only open the key page or download the search helper.

### 🔎 Retrieval and ranking

The default search hits PubMed and OpenAlex. OpenAlex is free and needs no key. If a contact email is already configured, the request uses OpenAlex's polite pool. That address is not stored in the search plan.

Records merge on DOI, then PMID. `report.md` is written by the script. It holds the question, the date, the databases, the exact queries, the limits, the hit / dedup / selected counts, and a table of the papers you kept. Ranking reasons sit in `ranked_all.json`. The file is a search record. Synthesis waits for `literature-writing`.

The rank score is a fixed rule: title, abstract, and MeSH hits, plus recency and a few other signals. Every point has a reason, stored in `ranked_all.json`. Priority is the reading order for this question. Selected papers start at 1. On the relevance pass, the agent marks 2 for support you should read carefully (a mechanism, a method, a review, a contrasting result) and 3 for a must-read, with a short reason code. Impact factor stays in the journal columns. You can change the stars later. An existing Priority tag stays as you set it on the next import.

Journal numbers come from the bundled, reviewed 2025 JCR/IF table, matched by ISSN, and sit beside the evidence. The result list stays as the search left it. CAS zones come from EasyScholar or from a metrics file you supply. The bundled table is 2025 data.

arXiv joins only when you ask. Web of Science joins as an official CSV or TSV you already downloaded. Campus databases stay in your own browser. Open-access PDFs can be fetched in a later step. Until that PDF is in hand, treat the hit as abstract-level.

### 📚 Zotero sync

Reading the library on this computer needs no key. Open Zotero and, in Settings → Advanced, tick **Allow other applications on this computer to communicate with Zotero**.

Saving needs a Zotero key, or Zotero 10 or later open on this computer. Zotero asks once in its own window. Choose Always Allow. Older desktop connections are read-only. The no-key save path was checked against a stand-in for the documented protocol. It has not been checked against a live Zotero window yet.

Project sync matches on exact DOI or PMID and reuses the item you already have. The search record becomes one note in the same collection. A title-plus-year guess is only a candidate. You look at it before it counts as the same paper.

### 🏷️ Tag manager

`zotero_tag_manager` cleans duplicate and unused tags. The actions are `scan`, `plan`, and `apply`. `plan` writes a hashed plan and leaves Zotero and the vocabulary as they are. `apply` dry-runs first. The write runs only after you confirm that plan hash.

A merge folds the old tag into the keeper's aliases. The item edits and the vocabulary land in one receipt. Tags you did not name stay on the item. Priority, Article Type, JCR, and CAS stay put unless the operation names them and you allow it.

### ✍️ Evidence-traced writing

Writing starts from saved `ranked_all.json` and the search record. If those files are missing, the skill stops and offers to search first. The draft comes from those files.

Sentences carry `[EV:n]`, and can carry a PMID or a DOI. A reference audit table sits beside the draft. `references_to_check.md` is written when a citation is weak, abstract-only, or unresolved.

A one-sentence Chinese summary is optional. It is written from the title and the abstract, and only when you ask. It is a navigation line. Conclusions trace back to the ranked evidence or to full text you actually retrieved.

### 📊 The literature-metrics add-on

A separate file for Zotero Desktop. [Download the newest](https://github.com/Frankkk1912/ai4s-literature-workbench/releases/latest/download/literature-metrics.xpi), then Tools → Add-ons → the gear → Install Add-on From File…, and restart. Steps and updates: [Zotero add-on](docs/zotero-xpi.md).

It adds columns for colored **IF / JCR / CAS**, and **Priority** stars. The stars use the same 1 / 2 / 3 reading order as the search. Article Type, Agent Tags, and a one-line AI Summary show up in the same list. The stars, the number keys `1` / `2` / `3`, and the **Set Priority** context menu are the add-on's only write. They change the Priority tags and leave every other field.

The columns show numbers the tools have written onto the items. After you install it, ask for a sync or a refresh. The add-on reads the `Extra` field. Lookup stays with the sync and metrics tools. Keys stay on the setup page.

### 🔑 Keys stay out of chat

Every key is optional. Search, ranking, and drafting need none.

When you want one, the agent calls `open_setup` and opens a page on your computer. The field is masked. You paste there. The agent cannot see the key, and the chat never holds it. The page stores it in a private file on that computer.

A PubMed key (free with an NCBI account) raises the request allowance. A Zotero key (free with a Zotero account) is one way to save. An EasyScholar key adds journal ratings, including CAS. The page links to where you get each one.

## 🗣️ Try saying this

### Find what to read
```text
Retrieve and rank PubMed and OpenAlex evidence on GLP-1 receptor agonists and cardiovascular outcomes. Save the search record for later writing.
```

### Put the project in one collection
```text
Sync this search record and the selected papers into a Zotero collection named "GLP-1 CVD Project". Reuse items that match on DOI or PMID.
```

### Draft a section you can check
```text
Draft an English review section from my saved ranked evidence and search record. Use [EV:n] placeholders and list references that need checking.
```

## 🚀 Quick Start

### What you need
- An agent app: **Claude Desktop**, **Claude Code**, **Codex**, **ChatGPT desktop**, WorkBuddy, CodeBuddy, Trae, or Qoder.
- **Zotero Desktop**, if you want the collection and the journal columns.
- A browser, for the page where optional keys go.

That is all you install yourself. The first search asks once, then downloads a helper of about 15 MB into your user folders, plus Python if the computer has none it can use. No admin rights. No system settings. If the app needs Node.js, the agent says so and where to get it.

### 1. Install (pick your app)

**Claude Desktop** (Zotero tools only. The skills and the full-text tools are not in this file. This route has not been tried in Claude Desktop yet.)

1. Open the [latest release](https://github.com/Frankkk1912/ai4s-literature-workbench/releases/latest) and download `ai4s-literature-zotero-<version>.mcpb`.
2. Double-click it, or drag it onto the Claude Desktop window. Leave the two optional settings as they are. Do not paste a key into chat.

The `.mcpb` is meant to use the Node.js that Claude Desktop ships. Which version that is has not been confirmed. The bundle asks for 22.13 or newer.

**Claude Code, Codex, ChatGPT desktop, WorkBuddy, CodeBuddy**: paste this into the app:

> Please install the plugin from https://github.com/Frankkk1912/ai4s-literature-workbench.git into this app. Follow INSTALL.md exactly, and if you cannot open the repository read https://raw.githubusercontent.com/Frankkk1912/ai4s-literature-workbench/main/INSTALL.md. Do not add steps of your own. When it's done, tell me in plain language what works now and what I need to do myself.

**Trae, Qoder**: use "Other agents & manual install" below.

Your app may ask to reach GitHub or the network. Choose **Allow**. The install stops without it.

> Checked on one Windows 11 PC: WorkBuddy through its MCP file, and ChatGPT desktop through its MCP file. The ChatGPT file route connects the tools and does not load the skills. Not checked yet: WorkBuddy's in-app marketplace, CodeBuddy, ChatGPT desktop on a Mac, Claude Desktop, and the Codex plugin command inside ChatGPT desktop.

### 2. First run

The agent runs the `ai4s-setup` skill and tells you, in plain language, what works now and what needs you.

- **Keys are optional.** Search, ranking, and drafting need none. A key goes on the local page, never into chat.
- **Reading your Zotero library needs no key.** Settings → Advanced → **Allow other applications on this computer to communicate with Zotero**.
- **Saving to Zotero** needs a Zotero key, or Zotero 10 or later. When it asks, choose Always Allow.
- **IF / JCR / CAS columns**: download [the add-on](https://github.com/Frankkk1912/ai4s-literature-workbench/releases/latest/download/literature-metrics.xpi), then Tools → Add-ons → the gear → Install Add-on From File…, and restart. The columns show data written onto the items, so ask for a sync or a refresh after it is installed.

### 3. First prompt

Start with **Find what to read** above. The first search should come back within a few minutes.

### If it breaks

| What you see | What to do |
| --- | --- |
| "My search tools are not connected yet" | Restart the app, then ask it to run the `ai4s-setup` skill. |
| The setup page did not open | Open the address and type the short code. Or double-click `Setup AI4S.bat` (Windows) / `Setup AI4S.command` (Mac) in the extracted release folder. On a Mac, if it is blocked, right-click, choose Open, then Open. |
| It cannot read my Zotero library | Tick **Allow other applications on this computer to communicate with Zotero** under Settings → Advanced. |
| It cannot save to Zotero | Add a Zotero key on the setup page, or use Zotero 10 or later and choose Always Allow. |
| No IF / JCR / CAS columns | Install the add-on, restart Zotero, then ask for a sync or a refresh. |
| The app asks to reach GitHub or the network | Choose Allow. |

More detail: [Getting started](docs/getting-started.md).

### Keys, in short

- A key is a long string that lets the tool call a service as you. It lives in a private file on your computer. Chat never shows it.
- A PubMed key and a Zotero key are free with those accounts. EasyScholar issues its own. Check their terms.
- Search uses public sources, so it runs with no key. A key raises PubMed's allowance, saves into Zotero, or adds journal ratings.

<details>
<summary>Other agents & manual install</summary>

Git and Node.js 22.13 or newer, with npm. Clone, then build once. The first search downloads the search helper. You do not install uv yourself for that path.

```bash
git clone https://github.com/Frankkk1912/ai4s-literature-workbench.git
cd ai4s-literature-workbench
node scripts/bootstrap.mjs
```

On Windows, the same three lines. `node` runs the script. Do not run a `.ps1` or `.sh` wrapper.

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

**ChatGPT desktop.** Paste the prompt above. By hand, use the Codex commands when the `codex` command exists. Otherwise follow the MCP file route in [INSTALL.md](INSTALL.md). That file route does not load the skills. The file route was checked on Windows 11. Mac was not.

**CodeBuddy** (not checked on CodeBuddy yet). Inside the app:

```bash
/plugin marketplace add Frankkk1912/ai4s-literature-workbench
/plugin install ai4s-literature-workbench@ai4s-literature-workbench
```

**Trae / Qoder.** Run this from the checkout. Replace `/path/to/project` with your project folder.

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
├── .codebuddy-plugin/         # CodeBuddy marketplace manifest
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

`install-manifest.json` matches [INSTALL.md](INSTALL.md). Agents follow those two files. This page is the human one.

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

- [Getting started](docs/getting-started.md)
- [Zotero add-on: install, updates, and build](docs/zotero-xpi.md)
- [First-run setup and credentials](docs/dev/onboarding.md)
- [Local configuration status view](docs/dev/local-dashboard.md)
- [Release checklist](docs/dev/release-checklist.md)
- [Security](SECURITY.md)

</details>

## 🤝 Contributing

Issues and pull requests are welcome.

## 📄 License

[MIT](LICENSE) © Frank AI4S Skill contributors.

**No Evidence, No Conclusion.** A scientific claim traces back to saved evidence. The Zotero layer credits Oscar Devos's [Zoteus](https://github.com/oscardvs/zoteus). Component credits are in [third-party notices](THIRD_PARTY_NOTICES.md).

---

<p align="center">
  <sub>📚 AI4S Literature Workbench · Which sentence came from which paper.</sub>
</p>
