# Advanced Retrieval Recipes

Read this reference only when the user explicitly needs an advanced or
diagnostic path beyond the default `review` command. Keep every result file
auditable and avoid adding a second default workflow.

The default `review` command already searches PubMed and OpenAlex, deduplicates
by DOI and PMID, matches the bundled journal table, and writes the search
record. Pass `--no-openalex` only when the user wants PubMed alone.

## Choose the Smallest Explicit Extension

| Need | Use | Read first |
|---|---|---|
| Skip OpenAlex | `review --no-openalex` | `database-patterns/openalex.md` |
| Set the OpenAlex search string yourself | `review --openalex-query "..."` | `database-patterns/openalex.md` |
| Add preprints | `review --arxiv` | `database-patterns/arxiv.md` |
| Add a user-supplied Web of Science export | `review --wos-export <official.csv>` | `database-patterns/webofscience.md` |
| Add point-in-time citation counts | `review --citation-provider auto` | `source-policy.md` |
| Filter by JCR/IF data | explicit filter flags on `review` | `query-planning.md` |
| Inspect or revise query semantics | `plan`; use `expand-query` only for an explicit LLM-assisted expansion | `query-planning.md` |
| Custom source pipeline or recovery | low-level retrieval/ranking commands | `workflow-contract.md` |
| Independent, separable source work | `subagent-plan` only when a complete source handoff is useful | `parallel-subagents.md` |
| Answer the question or write prose | `literature-writing`, or a separate summary the user asked for | `report-template.md` |

## Advanced Commands Are Not the Default Surface

The following remain available for explicit troubleshooting, reproducibility,
or unusual source requirements. They must not become automatic agent steps:

- Planning/routing: `workflow-plan`, `pubmed-review-workflow`, `plan`,
  `database-route`, `subagent-plan`.
- Query scaffolds: `expand-query`, `journal-filter-query`,
  `compose-pubmed-query`.
- Source transforms: `search-pubmed`, `search-openalex`, `search-arxiv`,
  `import-wos-export`, `merge-rank`, `render-report`.
- Enrichment: `enrich-journal-metrics`, `enrich-citations`,
  `extract-conclusions`.

For a custom pipeline, preserve the saved query, source route, limits, filters,
retrieval date, and score reasons. The result must still converge on
`ranked_all.json`, `ranked_all.csv`, and one search-record `report.md` unless
the user explicitly requests a distinct artifact.

## Explicit Fallbacks

- Use an ISSN-filtered second PubMed pass only when the broad result is too
  large to retrieve and the generated filter is short enough for NCBI.
- Use LLM query expansion only after the user or agent has identified a real
  synonym, MeSH, CJK segmentation, organism, or exclusion gap worth auditing.
- Web of Science enters only as an official CSV/TSV the user downloaded. Do
  not browse the site.
- Use citation enrichment as a time-stamped ranking aid, not as a scientific
  quality verdict.
- Europe PMC is not wired in. See `source-policy.md`.

## References

- `query-planning.md`: query-plan schema, local metric filters, second-pass and
  LLM-expansion contracts.
- `source-policy.md`: API, authorization, and database policy.
- `ranking.md`: score interpretation and limitations.
- `workflow-contract.md`: custom pipeline, agent, and downstream-skill
  boundaries.
- `parallel-subagents.md`: the narrow conditions for parallel source work.
- `report-template.md`: the search record, and where synthesis goes.
