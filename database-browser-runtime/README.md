# Literature Database Browser MCP

This is a separate, optional MCP runtime for visible, persistent browser work
against subscription literature databases. It is intentionally isolated from
the Zotero runtime so a browser crash, campus-network requirement, or browser
dependency cannot affect Zotero, PubMed, arXiv, or writing workflows.

The first implementation phase provides the complete `database_*` MCP contract,
durable asynchronous job state, request-id idempotency, receipts, download
validation, and a test adapter. The WoS production adapter must be calibrated
only with user-authorized, visible-browser campus-network live tests; no hidden
browser, credential import, API replay, DOM-record scraping, or access-control
bypass is implemented.

The workbench plugin currently uses `chrome-cdp` mode to reuse an explicitly
user-authorized Chrome login session at `http://127.0.0.1:9222`. The MCP always
creates and owns a new tab; it does not navigate or close pre-existing user
tabs. Isolated `chromium` and `chrome` persistent-profile modes remain available
for environments where their WoS sessions are reliable.

## Live validation status

On 2026-07-22, an authorized visible-browser smoke test from a non-campus home
network reached the Clarivate sign-in page and returned `AUTH_REQUIRED`. This
confirms that the runtime launches the browser, detects the authentication
boundary, and stops without submitting a query or attempting an export. It
does not establish campus access.

The next live test must be performed on an authorized campus network (or an
institution-approved access route) and must first return `session_state:
"ready"` on the WoS Core Collection Advanced Search page. Only then may the
search and official-export page contracts be inspected and calibrated with
explicit user authorization. Do not use personal credentials, VPN automation,
or access-control workarounds to make this test pass.

Install with Node.js 22.13+:

```bash
npm ci
npm run build
```

The runtime uses a platform-private application-data directory by default. Set
`LITERATURE_DATABASE_BROWSER_DATA_DIR` only to another private directory; do
not store profiles, exports, receipts, or diagnostics in this repository.

## Browser download on first use

Installing this runtime does not download a browser. The default `chromium` mode
needs Playwright's Chromium (a one-time download of a few hundred MB, 350 to 540 MB on disk on macOS), and
the first `database_session_open` stops with `BROWSER_NOT_INSTALLED` instead of
failing inside Playwright. The agent must then ask the user, and only after a
yes call `database_browser_install` with `consent: true`. The download takes
minutes, longer than a tool call may run, so that call only starts it
(`playwright install chromium`, run from the copy of Playwright in
`node_modules`) and returns; poll `database_browser_install_status`, which
reports `not_installed`, `downloading`, `installed` or `failed`. Nothing is
downloaded until the install tool is called.

Set `PLAYWRIGHT_BROWSERS_PATH` to change where the browser is stored. The
`chrome` and `chrome-cdp` channels use the user's own Chrome and need no
download. Chromium may still need system libraries on Linux (`npx playwright
install-deps chromium`, which asks for administrator rights); that step is not
automated.

This runtime is not shipped as a prebuilt bundle: it needs Playwright's files on
disk to download the browser, so it is only available from the source route.

