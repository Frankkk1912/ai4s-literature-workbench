# Relevance Priority Recommendations

During the relevance review of the selected records, write
`priority_recommendations.json`. Do not launch a separate paper-by-paper audit,
and do not write this judgment into `report.md`. After the file exists, re-run
`render-report` so the search record's Priority column matches.

Priority is a personal reading/use priority for one project, judged by
relevance to the search question:

- `1`: selected, but not a primary match for the question. This is the default.
- `2`: clearly relevant support: an important mechanism, method, dataset,
  review, or contrasting result for this question.
- `3`: directly addresses the search question. A must-read for this question.

Priority is not evidence quality, risk of bias, journal prestige, citation
count, or a reusable ranking across research questions. `rank` and
`score_reasons` may inform the decision but must not be converted mechanically
into stars.

## Compact Contract

```json
{
  "schema_version": "1.0",
  "artifact_type": "literature-priority-recommendations",
  "scope": "example-gene-cvd",
  "review_depth": "abstract",
  "default_for_selected": 1,
  "recommendations": {
    "doi:10.1000/core": {
      "priority": 3,
      "reason_codes": ["direct-question-match"]
    },
    "pmid:12345678": {
      "priority": 2,
      "reason_codes": ["important-mechanism"]
    }
  }
}
```

Use stable evidence IDs exactly as defined in ranked evidence. `scope` is the
project slug. `review_depth` is one of `metadata`, `abstract`, `mixed`, or
`full-text`. `default_for_selected` is always `1`.

Only Priority 2 and 3 overrides belong in `recommendations`; omitting Priority
1 papers keeps the artifact compact. Reason codes must be lower-kebab-case and
should normally come from this vocabulary:

- `direct-question-match`
- `essential-for-question`
- `important-mechanism`
- `important-method`
- `important-evidence`
- `high-value-review`
- `contrasting-evidence`
- `user-selected`

`direct-question-match` and `essential-for-question` are for Priority 3. The
others are for Priority 2, except `user-selected`, which records an explicit
user promotion. Do not add natural-language mini-reviews. The Zotero tag
contract is unchanged: `AI4S:Priority:1`, `AI4S:Priority:2`, and
`AI4S:Priority:3`.
