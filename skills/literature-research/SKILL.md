---
name: literature-research
description: >-
  Retrieve, deduplicate, and rank PubMed and OpenAlex literature into auditable
  files, including a search record. Use when the user asks to search PubMed,
  OpenAlex, arXiv, or a user-supplied Web of Science export; rank papers; or
  prepare evidence before Zotero or scientific prose. Do not use for Zotero-only
  operations, campus-database browsing, or evidence-traced manuscript writing.
---

# Academic Research

## Step 0: Check Your Tools

Before the first search in a conversation, call `setup_status` (from the
`ai4s-literature-zotero` server). Pass `language` (`zh` or `en`) to match the
user.

If `setup_status` is not in your tool list, stop. Do not claim that search
works, do not try to build or install anything, and do not improvise another
retrieval route. Tell the user, in the language they write in and without
component names: "My search tools are not connected yet." Then give one next
action: use the `ai4s-setup` skill, which connects them (and if that skill is
missing too, follow the route for their app in `INSTALL.md` in the plugin root).
Re-check afterwards and continue only if `setup_status` answers.

If it answers, look at the `search` item. If it is under Needs you with the
action `install_helper`, stop and say in plain words that search needs a small
helper tool (about 15 MB, plus about 30 MB of Python if the computer has none
it can use), downloaded into folders in their user account, with no admin
rights and no system settings changed. After a yes, call
`install_search_helper`; call it again while it says `downloading` or
`preparing_python`, then call `setup_status` again. Only if it reports `failed`
or `unsupported`, or the action is `ask_to_install`, offer the official
installer from <https://docs.astral.sh/uv/getting-started/installation/> after
the user approves. Otherwise continue with the task without reciting the
status.

Every `uv run` in this skill stands for the command in `setup_status`'s
`search_helper.run`: use `run.posix` in bash or zsh and `run.powershell` in
PowerShell, then the rest of the line. It is a quoted full path when the
workbench downloaded the helper itself, and plain `uv run` when the computer
already had one. Do not add the helper to PATH or install another copy.

TLS is verified by default. If a request fails with a certificate error, the
script's message already carries the fix: export the organization's root
certificate as a PEM file and set `SSL_CERT_FILE` or `REQUESTS_CA_BUNDLE` (the
optional `truststore` package additionally uses the system certificate store).
Never suggest disabling verification; `LITERATURE_TLS_INSECURE=1` exists only
as an explicit, loudly warned override for trusted-network troubleshooting.
If the handshake itself is cut off (`UNEXPECTED_EOF`, common behind gateways
that drop large TLS 1.3 handshakes), the script retries on its own with a
smaller handshake and then TLS 1.2, with verification unchanged; do not write
an `OPENSSL_CONF` workaround. `AI4S_TLS_COMPAT=1` starts in that mode.

Show the three groups from `rendered` only when the user asks what works, or when a key they asked for is missing.

Keep it short for a simple ask. One paper lookup is one search call plus a
one-sentence answer with the title and source; do not recite the whole
workflow, and never paste a long results table or the full contents of an
output file into the conversation — the files are already saved on disk, so
name them instead. If the `rendered` Network check shows a required endpoint
failed, say search is not available right now and give the fix line from the
status; do not fall back to claiming basics work.

Never ask for a key in chat. If the user wants PubMed speed or journal ratings
and has no key, use the `ai4s-setup` skill to open the masked page; missing keys
never block a search.

## Overview

Use this skill for retrieval and ranking only. The default `review` command
searches PubMed and OpenAlex, then writes four auditable files:
`search_plan.json`, `ranked_all.json`, `ranked_all.csv`, and `report.md`.
`report.md` is a search record the script writes. It is not a review and it
does not answer the question. It also matches journals against the bundled
reviewed 2025 JCR/IF table by ISSN unless the user requests
`--no-journal-metrics`; this enriches evidence but neither filters results nor
writes Zotero. A project already bound to Zotero may hand `report.md` and its
selected ranked evidence to `literature-manager` so the papers and one current
search-record Note stay together in the same collection.

After `review`, judge relevance to the search question and write one compact
`priority_recommendations.json` sidecar. This is not a second per-paper audit:
selected papers default to Priority 1, and the agent records only papers
promoted to Priority 2 or 3 with terse reason codes. Then re-run `render-report`
so the Priority column matches. Priority means personal reading/use priority
for the named project, not evidence quality.

When Frank enables Agent Tags for the retrieved batch, use that same relevance
review to write `semantic_tag_candidates.json` following
[semantic-tag-recommendations.md](references/semantic-tag-recommendations.md).
It contains compact English candidates keyed by stable evidence ID; final
reuse/new decisions wait for the current Zotero library vocabulary.

Answers and manuscript prose belong in `literature-writing`. Write a separate
summary only when the user explicitly asks for one, and do not put it in
`report.md`.

**No Evidence, No Conclusion:** do not make scientific claims until saved
retrieval and ranked evidence support them.

## Route Boundaries

- Retrieval and ranking: `literature-research`.
- Zotero matching, import plans, duplicate review, collections, and tags:
  `literature-manager`.
- Evidence-traced review, proposal, introduction, discussion, or DOCX prose:
  `literature-writing`.

Do not introduce an umbrella coordinator. Hand off the saved files directly to
the next narrow skill when the user's request crosses a boundary.

## Quick Start

For the usual literature search, use the single PubMed-and-OpenAlex command:

```bash
uv run literature-research/scripts/literature_search.py review \
  --question "EXAMPLE-GENE 在心血管疾病中的作用" \
  --pubmed-query "(EXAMPLE-GENE) AND (cardiovascular disease OR heart failure)" \
  --limit 50 \
  --top-n 30 \
  --output literature_run
```

On Windows PowerShell, use PowerShell backticks for continuation:

```powershell
uv run literature-research/scripts/literature_search.py review `
  --question "EXAMPLE-GENE 在心血管疾病中的作用" `
  --pubmed-query "(EXAMPLE-GENE) AND (cardiovascular disease OR heart failure)" `
  --limit 50 `
  --top-n 30 `
  --output literature_run
```

Inspect `search_plan.json` for the exact PubMed and OpenAlex queries, sources,
limits, and filters. Inspect ranking reasons in `ranked_all.json`. Leave
`report.md` as the script-written search record. A capped search is never
comprehensive. OpenAlex needs no API key. If a contact email is already in
`academic-research.json` (`email`), `OPENALEX_MAILTO`, or `CROSSREF_MAILTO`,
the request uses OpenAlex's polite pool and the address is not written into
the plan or the search record.
If OpenAlex answers HTTP 429 or fails, `review` prints a warning, keeps the
PubMed results, and records the skip under `source_routing.degraded` in
`search_plan.json`; tell the user the run is PubMed-only instead of re-running.

## Default Workflow

1. Clarify only ambiguity that changes the biological target or inclusion
   criteria. Otherwise proceed without a planning-only loop.
2. Run `review` with explicit `--limit`, `--top-n`, and output directory.
   PubMed and OpenAlex both run unless the user asks for `--no-openalex`.
3. Keep the four script-produced canonical artifacts. Journal metrics are matched by default
   from the bundled reviewed table; use `--journal-metrics` only for an audited
   override, or `--no-journal-metrics` to opt out.
4. Do not create raw copies, renamed result
   files, a second topical report, or ad hoc helper scripts by default.
5. Review the selected records for relevance to the search question. Note the
   score reasons, database coverage, result cap, and abstract-level limit.
6. Write `priority_recommendations.json` following
   [priority-recommendations.md](references/priority-recommendations.md). Do not
   start another LLM pass or write prose reasons per paper. Re-run
   `render-report` so `report.md` shows Priority 2 and 3.
7. If Agent Tags are enabled, write `semantic_tag_candidates.json` in the same
   pass. Use zero to four English tags per paper, or at most two without an
   abstract; never force dimensions or tag a narrow entity that is not a
   principal study subject.
8. Hand `ranked_all.json`, `report.md`, `priority_recommendations.json`, and
   any enabled `semantic_tag_candidates.json` to `literature-manager` for
   Zotero work. Hand ranked evidence to `literature-writing` when the user
   wants an answer or manuscript prose. Do not expose plan paths, hashes, or
   receipts during the ordinary exact-ID path.

When the request includes a new Zotero import, EasyScholar enrichment is a
default handoff action after the final selection exists. Run
`enrich-easyscholar --selection-json selection.json` so only selected journal
records are queried; the command skips preprints, deduplicates journal calls,
uses the persistent cache and rate limiter, and never saves the API key. If the
key/API is unavailable, it writes an `unavailable` enrichment summary and
preserves the evidence so bibliographic import can continue with missing
metrics reported. Pass the enriched JSON to `literature-manager`. Do not use
this default to refresh an existing Zotero collection; backfill requires an
explicit user request.

The standalone `review --easyscholar` option remains available for an
explicit all-ranked enrichment, but is not the efficient Zotero import path.
PubMed and EasyScholar keys are read from `academic-research.json` in the
same private directory as the Zotero env file (`ai4s-literature-workbench`).
`PUBMED_API_KEY` and `EASYSCHOLAR_SECRET_KEY` override that file. An older
file under `frank-ai4s` (`%LOCALAPPDATA%\frank-ai4s` on Windows, or
`~/.config/frank-ai4s`) is still read when the workbench file is absent, and
`config` copies it into the workbench directory on the next write. The
EasyScholar cache uses the workbench cache directory and falls back to the
old `frank-ai4s` cache.

## Hard Safety Rules

- Source-database retrieval precedes Zotero; Zotero presence never proves
  search completeness.
- Label abstract-level evidence and preprints. Do not imply full-text review,
  peer review, impact factor, or citation counts that were not retrieved.
- Do not browse campus-network or subscription databases. Web of Science is
  supported only as an official CSV/TSV export the user downloaded themselves.
  Import it with `review --wos-export` or `import-wos-export`. Do not drive a
  browser, reuse a campus session, or work around CAPTCHAs, logins, licenses,
  or export limits.
- Do not commit Web of Science exports, subscription PDFs, cookies, browser
  profiles, private or unlicensed replacement journal-metric tables, or
  unpublished research data.

## Advanced Recipes

Advanced source routing, query expansion, journal filters, citation enrichment,
subagent work, and low-level commands are intentionally outside the default
path. Read [advanced-recipes.md](references/advanced-recipes.md) only when the
user explicitly requests one of them. Use the linked source, query-planning,
ranking, and workflow-contract references for the applicable constraints.
The bundled `references/jcr_journals_2025.csv` is the default IF/JCR lookup
source. It is versioned 2025 data and does not supply CAS zones; do not label
it as 2026 metrics. A newer audited CSV can be supplied explicitly through
`--journal-metrics`.

## Common Mistakes

- Do not claim the capped default search is exhaustive.
- Do not rewrite `report.md` into a mini-review. Synthesis goes to
  `literature-writing`, or to a separate file only when the user asks for a
  summary.
- Do not add arXiv, a Web of Science export, or citation enrichment unless the
  question requires them. OpenAlex is already part of the default search.
- Do not browse Web of Science or another campus database. Ask for an official
  export file instead.
- Do not equate deterministic search `rank`/`score` with Priority or evidence
  quality. Promote Priority 2 or 3 only from relevance to the search question.
- Do not copy PubMed keywords into Agent Tags or treat semantic tags as claim
  evidence. Reconcile candidates against the persistent Zotero vocabulary.
- Do not query EasyScholar for every raw hit when only a selected subset will
  enter Zotero, and do not fail the bibliographic import solely because journal
  metrics are unavailable.
