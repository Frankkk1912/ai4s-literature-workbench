# Web of Science Database Pattern

## Access Mode

The agent does not browse Web of Science. There is no campus-browser path in
this workbench. The supported path is an official CSV or TSV export the user
downloaded themselves.

Normalize that file with `literature_search.py import-wos-export`, or pass it
to `review --wos-export`.

## Effective Pattern

1. Tell the user which Topic query to run, using `wos_query` from the plan.
   They apply year, document type, collection, and language filters in Web of
   Science themselves.
2. Ask them for the official CSV or tab-delimited export. Prefer full-record
   fields. Do not open the site, drive a browser, or scrape the page.
3. Keep the raw export outside this repository, then run `import-wos-export`.
4. Merge and rank the normalized JSON with the PubMed and OpenAlex JSON.
5. State in the search record that Web of Science was a user-supplied export,
   and do not treat its hit count as comparable to PubMed or OpenAlex.

## Evidence Files

- Query plan JSON containing `wos_query` and the filters the user applied.
- Official WoS CSV/TSV export, kept outside the repository.
- Normalized WoS records JSON.
- Ranked JSON/CSV and the search record `report.md`.

## Known Traps

- Do not bypass CAPTCHA, institutional login, license limits, or export controls.
- Do not automate a campus session, headless or visible.
- XLSX exports should be converted to CSV/TSV before import.
- WoS result counts and PubMed or OpenAlex result counts index different records.
