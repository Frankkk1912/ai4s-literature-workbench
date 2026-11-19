# PubMed Database Pattern

## Access Mode
- Use `literature_search.py search-pubmed` through NCBI E-utilities.
- Do not browse PubMed. The API record is the evidence.

## Effective Pattern
1. Build a query plan and review synonyms, MeSH-style terms, organism constraints, article types, and exclusions.
2. Run `search-pubmed` with an explicit `--limit` and save JSON output.
3. If journal-quality filters matter, generate an ISSN filter audit from a local metrics CSV, but keep the broad PubMed records as the primary retrieval output.
4. Merge and rank saved JSON records, then use `enrich-journal-metrics --filter-to-matches` for local CAS/JCR/IF filtering by ISSN.
5. Use a PubMed ISSN second pass only when the broad result set is too large to download and the ISSN query is short enough for NCBI.
6. Inspect `score_reasons` and `journal_metrics_filter` during the relevance review. Do not write the answer into `report.md`.

## Evidence Files
- Query plan JSON.
- PubMed records JSON.
- Optional ISSN filter audit JSON/Markdown.
- Optional local journal-filtered ranked JSON/CSV.
- Ranked JSON/CSV and the search record `report.md`.

## Known Traps
- A capped `--limit` result is not exhaustive.
- Very long ISSN filters can trigger NCBI request failures; prefer local filtering for large Q/IF journal sets.
- PubMed queries may miss publisher-ahead-of-print or non-indexed records.
- Do not infer full-text findings from abstract metadata without saying so.
