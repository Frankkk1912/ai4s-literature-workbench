# Third-Party Notices

This repository aggregates several independently maintained components. Full
third-party license texts are kept alongside each component:

- `runtime/` — source snapshot of the independently named
  `literature-zotero-mcp` derivative. See `runtime/THIRD_PARTY_NOTICES.md` and
  `runtime/licenses/`.
- `fulltext-runtime/` — Fulltext MCP runtime. See its own notices file when
  present.
- `database-browser-runtime/` — Playwright-based database browser MCP broker.
  See its own notices file when present.
- `literature-metrics/` — Zotero desktop plugin (XPI) source. See
  `literature-metrics/THIRD_PARTY_NOTICES.md` and
  `literature-metrics/LICENSE`.

Dependency licenses are recorded in each component's `package-lock.json` and
installed `node_modules/*/package.json` files (not committed to this
repository).
