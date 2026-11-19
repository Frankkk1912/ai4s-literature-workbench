# Source Policy

## Default Sources

- PubMed through NCBI E-utilities.
- OpenAlex works API. Free, no key. A configured contact email is sent as
  `mailto` for the polite pool and is omitted from saved artifacts. The search
  still runs when no email is configured.
- Versioned bundled `jcr_journals_2025.csv` for ISSN, JCR zone, and
  impact-factor matching. A user-provided reviewed CSV is an explicit override,
  not a prerequisite. The bundled table does not supply CAS zones.

## Optional Sources

- arXiv through the public arXiv API, only when the user wants preprints.
- Web of Science through an official CSV/TSV export the user downloaded. The
  agent does not browse Web of Science or any other campus-network database.
- Citation counts from Crossref. Rate limit follows Crossref's polite pool
  when `email` or `CROSSREF_MAILTO` is set. Citation enrichment is not part of
  the default search and does not change scores unless `merge-rank` is run
  with `--citation-weight`.

## Campus And Subscription Databases

- This workbench does not browse campus-network or subscription sites.
- A generic web search is not a substitute for PubMed or OpenAlex, and it is
  not assumed to have institutional access.
- For Web of Science, ask the user for the official export and import it with
  `import-wos-export`. Do not scrape the site or automate a login.
- Do not store cookies, browser profiles, private exported records, or
  full-text PDFs inside this repository.

## Deferred Sources

- Europe PMC. It is free and needs no key, but its core MEDLINE overlap with
  PubMed is large and its query dialect is a separate parser. Leave it as a
  follow-up rather than a third default source.
- Sources that require an API key, including Semantic Scholar as a retrieval
  database. Semantic Scholar remains an optional citation-enrichment provider
  only when a key is already configured outside chat.
- Google Scholar. It is not retrieved from this skill.
- Zotero is the library layer in `literature-manager`, not a discovery source.

## Rate-Limit References

- NCBI E-utilities documentation:
  `https://www.ncbi.nlm.nih.gov/books/NBK25497/`
- OpenAlex API:
  `https://docs.openalex.org/`
- arXiv API user manual:
  `https://info.arxiv.org/help/api/user-manual.html`
- Crossref API etiquette:
  `https://github.com/CrossRef/rest-api-doc#etiquette`
