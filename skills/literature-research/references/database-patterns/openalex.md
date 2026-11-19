# OpenAlex Database Pattern

## Access Mode

- Use `literature_search.py search-openalex` or the default `review` command.
- OpenAlex is a free public API. Do not add an API key.
- When a contact email is already configured (`academic-research.json` field
  `email`, `OPENALEX_MAILTO`, or `CROSSREF_MAILTO`), the request adds `mailto`
  for the polite pool. The address is not written into `search_plan.json` or
  `report.md`. Without an address, the same search still runs.

## Effective Pattern

1. Record the exact OpenAlex search string in `search_plan.json` as
   `openalex_query`. The default is the PubMed query with field tags removed.
2. If the PubMed query contains a `"YYYY:YYYY"[dp]` limit, send that range as
   `publication_year` and record it under `openalex_filters`.
3. Run the search with an explicit `--limit`. The saved JSON stores the query,
   the filter, the reported hit count, and the retrieved records.
4. Merge with PubMed by DOI, then PMID. The stable evidence ID stays `doi:…`
   or `pmid:…`. Journal ISSNs from OpenAlex fill gaps so the bundled JCR table
   can still match.
5. Leave `report.md` as the script-written search record.

## Evidence Files

- Query plan JSON containing `openalex_query` and `openalex_filters`.
- OpenAlex records JSON from `search-openalex`.
- Ranked JSON/CSV after `merge-rank`.
- Search record `report.md`.

## Known Traps

- A capped `--limit` result is not exhaustive. OpenAlex hit counts and PubMed
  hit counts are not the same number.
- OpenAlex abstracts are rebuilt from the inverted index and can be incomplete.
- Do not treat an OpenAlex `type` of `preprint` as a peer-reviewed article.
