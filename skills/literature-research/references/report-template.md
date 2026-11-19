# Literature Search Record

`report.md` is the search record. `render-report` writes it from the ranked
JSON and the query plan. Do not add prose, an evidence map, footnotes, or an
answer. `literature-manager` imports this file as the Zotero Note.

```markdown
# Literature search record

## Question
[the question as asked]

## Search
- Date: YYYY-MM-DD
- Databases: PubMed, OpenAlex
- PubMed query: `exact query`
- OpenAlex query: `exact query`
- Limits: 50 records per database; 30 selected after ranking
- Filters: none

## Counts
- PubMed: 120 hits, 50 retrieved
- OpenAlex: 84 hits, 50 retrieved
- Combined before deduplication: 100
- After DOI/PMID deduplication: 73
- Selected: 30

## Selected papers
| Rank | Title | Journal | Year | PMID | DOI | Priority |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | Title | Journal | 2024 | 12345678 | 10.1000/example | 1 |

## Limitations
Capped search, abstract-level.
```

The limitations line is fixed. Priority is 1 unless
`priority_recommendations.json` promotes the stable evidence ID to 2 or 3.
After writing that sidecar, re-run `render-report` before project sync so the
Note matches the tags.

Web of Science, when used, appears because the user supplied an official
CSV/TSV export. The record does not claim the agent searched the campus site.

## Where answers go

Scientific synthesis is not part of this file. Use `literature-writing` for a
review, proposal, or manuscript section. If the user explicitly asks for a
short summary of the retrieved set and does not want that skill, write a
separate `summary.md`. Leave `report.md` unchanged.
