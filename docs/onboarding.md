# API onboarding

> This page is for developers. A beginner never opens it: the agent follows
> [`INSTALL.md`](../INSTALL.md) and the `ai4s-setup` skill, which use the
> `setup_status` and `open_setup` tools described below.

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

The credential wizard and MCP do **not** install Zotero Desktop add-ons. The
redacted onboarding status reports the add-on as `zotero_desktop_xpi`, read
from Zotero's own profile records on this machine. It can show that the add-on
is installed and active, and whether it came from this repository. It cannot
prove the add-on loads and works. For build and install steps, see
[`zotero-xpi.md`](zotero-xpi.md). The Agent must remind the user during
first-run onboarding.

## Setup page opened by the tools (Phase 2)

The same wizard can be started from inside the MCP process, so a stdio-only
install (the `.mcpb`, a plugin archive) needs no `--http` server and no code
copied out of a terminal. Two tools in the `workbench` profile:

| Tool | What it does |
| --- | --- |
| `setup_status` | Read-only. Reports capabilities in three groups (works now, needs you, optional) in Chinese and English, Chinese by default. Reads settings on this computer and tests no key. Never returns a key. |
| `open_setup` | Starts the wizard on `127.0.0.1` with a random port and opens the default browser on it. `keys` names the keys to offer, one at a time, each with a reason, a link and Skip. Returns `opened`, a plain `url`, and `fallback_code` only when the browser could not be opened. |

`node runtime/bundle/index.mjs --setup` (the double-click launchers run this)
starts the same page from a desktop window. It prints the address and the typed
code in that window when the browser did not open. `--check` prints and exits;
`--keys zotero,pubmed` limits what is offered. `AI4S_NO_BROWSER=1` stops any
browser launch.

### One-time token in the URL fragment (decision 3 of the plan)

The browser is opened on `http://127.0.0.1:<port>/admin/onboarding/#code=<pairing code>`.
The page redeems the code at once through the same `POST /api/pair`, and
replaces the address with the plain page (`history.replaceState`) before it does
anything else. The typed pairing form remains as a fallback.

What this changes, written down so it is not a surprise:

- A fragment is handled by the browser alone. It is not in the HTTP request, so
  it never reaches the server, a request log, or a `Referer` header (the page
  also sends `Referrer-Policy: no-referrer`, and the script only reads the code
  from the fragment, never a key).
- It **is** visible in three places for a short time: the arguments of the
  launcher process (`open`, `rundll32`, `xdg-open`), which other processes of
  the same user can list; the browser's history entry for the first load; and,
  only when no browser could be opened, the `fallback_code` in the tool result
  (the user types it, as with D12).
- The code is 16 random bytes, single-use, valid for 5 minutes, and rate
  limited. The page serves nothing but itself until it is redeemed. A process
  of the same user that redeemed it first could write a key of its own
  choosing, but it could already read the private key files directly, so no new
  capability is gained. The code does not let anything read a saved key: status
  shows presence and a short mask, as before.
- Host, Origin and CSRF checks, DNS-rebinding protection and the session cookie
  (`HttpOnly`, `SameSite=Strict`, 30 minutes) are unchanged. The launcher only
  opens loopback `http` addresses; it refuses anything else.
- Unlike `onboarding_pairing_code`, which closes its server the moment the code
  is redeemed (so the page can stall before a key is typed), a setup session
  stays up until the user finishes, the session expires, or a newer session
  replaces it. An unused code closes the page after 5 minutes (15 minutes from
  `--setup`).

`open_setup` is not offered when OAuth is enabled: a remote deployment has no
local setup page, and its callers cannot reach this machine's loopback. (The
older `onboarding_pairing_code`, in the `full` profile only, has no such filter.)

Keys are written to the same private files as before; nothing in the tool result,
the page address or the logs contains one. A Zotero key saved while the tools run
takes effect after the app restarts; `setup_status` says so.

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
never enters a URL the server sees or a server log. The session lives in memory and dies when
the process restarts.

### Agent may relay the pairing code (D12)

When an agent starts the `--http` service, it may tell the user the pairing
code it just saw on stderr. Guardrails:

- Relay **only** the pairing code. Keys must **never** enter chat or agent
  output.
- Relay only a code from the service started in this session. Do not write it
  into notes, memory, or any durable file.
- The terminal stderr line remains a parallel channel.
- Keys still follow R12; the pairing code never enters a URL the server sees
  or a server log. (A setup session started by the tools puts it in the URL
  fragment only; see the section above.)

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
retry and exception paths. Pairing codes also never enter a URL the server sees
or a server log; a setup session started by the tools carries one in the URL
fragment only.

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
