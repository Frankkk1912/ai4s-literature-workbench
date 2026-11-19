# Parallel Database Subagents

Use this pattern when one research question needs multiple independent sources,
such as PubMed, OpenAlex, arXiv, or a user-supplied Web of Science export. The
main agent owns the shared query plan and the relevance review. Subagents only
retrieve source-specific evidence and return concise handoffs.

## When to Split

- Split by independent database/source, not by final conclusion.
- Use subagents when each source requires separate search mechanics or enough
  retrieval work to justify parallelism.
- Do not split tiny searches, dependent screening steps, or tasks where one
  result must change the next query.
- Do not assign a subagent to browse a campus or subscription database.

## Subagent Prompt Rules

- Every prompt must say: load `literature-research` and follow **No Evidence, No
  Conclusion**.
- Tell the subagent to use the API or the user-supplied export. Do not tell it
  to open a browser.
- For Web of Science, the handoff is the official CSV/TSV the user already
  downloaded. The subagent imports that file and does not visit the site.
- Ask for a handoff summary, not a scientific answer.

## Required Handoff

Each subagent should return:

- database/source name,
- exact query used,
- filters, limits, date, and access mode,
- record count and output file paths,
- top 5 candidate records with stable IDs, DOI, PMID, arXiv ID, WoS accession, or URL,
- source-specific limitations or failures.

## Main-Agent Aggregation

1. Wait for every subagent or record a source failure explicitly.
2. Reject unsupported handoffs that lack saved evidence files.
3. Run `merge-rank` on all produced JSON files using the shared query plan or
   explicit keywords.
4. Inspect `score_reasons`, duplicates, source labels, and limitations.
5. Run `render-report`. Leave the search record as written. Judge Priority
   from relevance to the question, then re-render if any paper is Priority 2
   or 3.

## Safety Boundaries

- API sources still use the helper script rate limiters.
- Do not browse campus or subscription databases.
- Do not commit private exports, PDFs, cookies, browser profiles, or
  subscription-derived full text.
