# API onboarding

AI4S Literature Workbench can run its basic literature workflow without API
credentials. The first Agent interaction reports the local configuration
status and offers three optional enhancements:

| Provider | Application page | Enhancement |
| --- | --- | --- |
| Zotero Web API | <https://www.zotero.org/settings/keys> | Cloud library identity and permitted item, tag, note, or file operations |
| PubMed / NCBI | <https://www.ncbi.nlm.nih.gov/datasets/docs/v2/api/api-keys/> | Higher E-utilities allowance and more stable batch retrieval |
| EasyScholar | <https://www.easyscholar.cc/> | Journal rank and metric enrichment; after login use the personal dashboard's `开放接口` entry |

For Zotero, enable library access. Enable write access when the Agent should
create or update items, tags, or notes; enable file access when attachment
upload is required. Group-library permissions are reported separately from the
personal-library capabilities returned by Zotero.

The CLI wizard below remains the complete setup path. The local web wizard is
an additional UX entry on the same validation and private-file semantics; it
does not replace the CLI.

Related documents: [`local-dashboard.md`](local-dashboard.md),
[`zotero-xpi.md`](zotero-xpi.md),
[`migration-from-parent.md`](migration-from-parent.md).

## Zotero Desktop XPI reminder

The credential wizard and MCP do **not** install Zotero Desktop add-ons. This
repository does **not** automatically verify whether the add-on is installed.
To show AI4S metrics, Agent Tags, AI Summary, and the interactive Priority
column, build the separate `literature-metrics` add-on from this checkout,
then in Zotero Desktop choose **Tools → Add-ons → gear menu → Install Add-on
From File…** and select
`literature-metrics/dist/literature-metrics-<version>.xpi`.

The redacted onboarding status reports this as `zotero_desktop_xpi`. The
dashboard label is **本轮未核验** (not “never verify”). See
[`zotero-xpi.md`](zotero-xpi.md). The Agent must remind the user during
first-run onboarding.

## Local web wizard (M4)

Management routes exist only when the Zotero MCP HTTP transport is bound to
loopback **and** OAuth is not enabled. Remote / OAuth mode does not register
the routes and does not print a pairing code.

### Start and URLs

After the runtime is built:

```bash
node runtime/dist/index.js --http --host 127.0.0.1 --port 3939
```

`--port` / `PORT` default to `3939`; `--host` / `HOST` default to `127.0.0.1`
when OAuth is off.

| Page | URL |
| --- | --- |
| Pairing / wizard | `http://127.0.0.1:3939/admin/onboarding/` |

The pairing page is the **only** management document served without a session.
It contains no configuration status and no secrets.

### Pairing code → session

1. On HTTP start, the process writes a one-time pairing code to **stderr**:
   `AI4S local onboarding pairing code: <code>`
2. Open the wizard URL on the same machine.
3. Paste the code into the pairing form and redeem it once.
4. The server sets a 30-minute session cookie
   (`HttpOnly`, `SameSite=Strict`, path `/admin/onboarding`) and a CSRF token.
   The pairing code is consumed immediately and cannot be replayed.

Pairing-code properties (unchanged by D12): 16 random bytes (≥128-bit),
5-minute TTL, single-use, constant-time compare, attempt limiting. The code
never enters a URL or server log. The session lives in memory and dies when
the process restarts.

### Agent may relay the pairing code (D12)

When an agent starts the `--http` service, it may tell the user the pairing
code it just saw on stderr. Guardrails:

- Relay **only** the pairing code. Keys must **never** enter chat or agent
  output.
- Relay only a code from the service started in this session. Do not write it
  into notes, memory, or any durable file.
- The terminal stderr line remains a parallel channel.
- Keys still follow R12; the pairing code still never enters a URL or server
  log.

### All management APIs require a session

After the pairing page, **every** management GET and POST requires the
redeemed session. That includes status reads and the dashboard JSON/HTML
routes. Unpaired reads and writes are rejected. Clearing the session cookie
and then requesting a protected route returns `401` JSON
`{"error":"Pairing required."}` — not a page of configuration state.

Every write also checks Origin / CSRF. Host and Origin checks cover management
GET and POST. DNS-rebinding protection covers the management surface.

## Credential exposure — R12 three paths

There is **no** promise that “the network panel has no key” or that “the key
never enters any URL”. Official 查询参数 exceptions are written here
because they are real (D10).

1. **Path 1 — browser → local POST body.** The wizard submits credentials to
   the loopback management API only in the POST body. Local / browser URLs,
   the address bar, and management links never contain a key. The payload is
   visible in the user’s own DevTools; that is an inherent boundary.
2. **Path 2 — Zotero official Header.** Server-side validation of a Zotero key
   calls `https://api.zotero.org/keys/current` with the key in the
   `Zotero-API-Key` Header.
3. **Path 3 — PubMed / EasyScholar official HTTPS 查询参数 (D10
   approved exception).** Server-side validation keeps the existing official
   API shape:
   - PubMed / NCBI: `api_key` 查询参数 (`einfo.fcgi?...&api_key=`)
   - EasyScholar: `secretKey` 查询参数
     (`getPublicationRank?...&secretKey=`)
   Those URLs are **server-side only**. The provider may receive or log them
   according to its own API design. This repository does not rewrite those
   official query parameters into headers.

### What must never contain a plaintext key

**Local / browser URL, address bar, logs, errors, responses, reports, and
chat must never contain a plaintext key or a key-bearing URL.** That includes
retry and exception paths. Pairing codes also never enter a URL or server log.

Do not paste an API key into Agent chat or pass it as a command argument.

## Safe local CLI setup

From this repository (or the installed plugin directory), run:

```bash
node scripts/onboard.mjs setup --output onboarding-result.json
```

PowerShell uses the same arguments:

```powershell
node .\scripts\onboard.mjs setup --output .\onboarding-result.json
```

The terminal masks input. Each credential is validated once before it replaces
an existing setting. An invalid credential is not saved. A temporary network
failure does not invalidate or overwrite an existing setting. Every provider
can be skipped.

The JSON result contains only configuration and capability status; it never
contains credential values. Reconfigure one provider later with:

```bash
node scripts/onboard.mjs reconfigure --provider zotero --output onboarding-result.json
node scripts/onboard.mjs reconfigure --provider pubmed --output onboarding-result.json
node scripts/onboard.mjs reconfigure --provider easyscholar --output onboarding-result.json
```

Inspect status without making a network request:

```bash
node scripts/onboard.mjs status --output onboarding-status.json
```

Existing native and legacy private files continue to be read; they do not need
to be migrated. See [`migration-from-parent.md`](migration-from-parent.md).
