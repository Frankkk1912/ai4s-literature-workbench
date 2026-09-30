# Local configuration status dashboard

The dashboard is a loopback-only, session-gated status page. It answers “what
is configured on this machine, and how strongly do we know that?” It does
**not** run connection tests, 自动轮询, or 自动连接测试.

Wizard and pairing details: [`onboarding.md`](onboarding.md). XPI install:
[`zotero-xpi.md`](zotero-xpi.md). Visual constraints summarized from D-scheme
§1: `plans/m5-dashboard-visual-options-20260930.md` (review draft; do not copy
its historical example data).

## Access URL

```text
http://127.0.0.1:3939/admin/onboarding/dashboard
```

Start the Zotero MCP with `--http` on loopback, no OAuth, then redeem a
pairing session from `http://127.0.0.1:3939/admin/onboarding/` first. The
dashboard document and `/api/dashboard` JSON are management routes: they
require that session.

## Five sections

| Section | What it shows | What it does not show |
| --- | --- | --- |
| 凭证 | Zotero / PubMed / EasyScholar existence and source (`environment` / `private_config` / `none`) | Online validation history, connectivity |
| MCP 构建产物 | `runtime/dist/index.js` and `fulltext-runtime/dist/index.js` existence | That an MCP is running or connected |
| Zotero Desktop XPI | Manual install reminder; status **本轮未核验** | Installed / enabled in Zotero Desktop |
| 宿主线索 | Observable Claude Code / Codex / WorkBuddy clues | Host installed, or MCP connected |
| 连接证据 | Measured connection rows only | “已连接” without measured evidence |

WorkBuddy / CodeBuddy clues on this page remain **未实测 / 待人工核验** unless
a later measured observation exists. This round does not display them as
connected.

## Four evidence kinds (honest archive)

These are kinds of evidence on **different objects**, not one four-step ladder
and not a completion percentage. D-scheme §1 (“诚实档案”) keeps the visual
weight on short evidence text so “exists” cannot be skimmed as “connected”.

| Kind | Meaning | Typical objects |
| --- | --- | --- |
| 存在 | A file or key was detected. Not validated, not connected. | 凭证 `configured: true` → UI **凭证存在** |
| 校验 | An online verify succeeded. This round’s dashboard does **not** invent a “已校验” credential row; the current status payload has no stored validation timestamp. | Explained in copy, not faked as a success record |
| 产物 | A build artifact exists. Existence is not connectivity. | Runtime / Fulltext → **构建文件存在** / **未找到构建文件** |
| 连接 | A measured connection observation for that object only. | 连接证据 → **已连接（实测）** only when `level` is `verified` with evidence |

`verified` on a host means host availability was measured. It must not be
translated as “MCP 已连接”.

## Row structure

Each row is:

1. **Object + status + action** — name, status pill, optional control
   (管理凭证 / 前往配置 / 查看路径 / 查看安装步骤 / 查看接入说明)
2. **Short evidence sentence** — always visible; generated from returned
   fields only
3. **`<details>`** — full path, command, and technical fields, collapsed

The page prints a **状态读取时间** when a protected read succeeds. That clock
is the moment the page read JSON. It is not a connection-test time.

## Hard display rules

- 未实测 does **not** display as 已连接.
- XPI does **not** display as 已安装. The label is **本轮未核验** (this round
  did not inspect Zotero Desktop). That is not a promise to never verify.
- A build artifact must not impersonate connectivity. Copy stays
  “已找到构建产物；未据此判断连接状态.”
- Unknown, missing, and 待人工核验 are valid states. They are not blank and
  not default-success.
- The page does not fabricate evidence, source line numbers, probe times, or
  last-configured times.
- Credentials and key-bearing URLs are never rendered.

## Session expiry and 401 JSON

The dashboard is not a second pairing UI.

| Situation | Behavior |
| --- | --- |
| No session / expired session / cookie cleared | Protected routes return **401 JSON** `{"error":"Pairing required."}` — not configuration state |
| Dashboard JS sees 401/403 on `./api/dashboard` | Stops showing protected status and points back to the wizard pairing page |
| Process restart | In-memory session is gone; pair again |

Do not treat a 401 body as a dashboard screenshot of “all unconfigured”.

## D-scheme §1 constraint index

Source: `plans/m5-dashboard-visual-options-20260930.md` §1 (and §4 as the
implementation direction). Historical A/B/C examples in that file are not
data.

1. Five sections as in T5.2 (凭证 / MCP 构建产物 / XPI / 宿主线索 / 连接证据).
2. Four evidence kinds are visually distinct by section name, object label,
   and evidence sentence — not a four-color ladder and not a 3/3 score.
3. Every row has short evidence; paths belong in `<details>`.
4. Continue the T4 visual language; do not introduce a second brand system.
5. Use only returned fields or facts derived from those fields.
6. Generated clocks are 状态读取时间 only.
7. No measured evidence ⇒ no 已连接.
8. Host `verified` ≠ MCP connected; artifact exists ≠ connected; XPI is 本轮未核验.

## Screenshots (optional; not produced in M6)

Suggested Frank follow-up, no secrets in frame:

1. Desktop width with mixed real status
2. Narrow width, wrapping name / status / action
3. 401 JSON body after clearing the session cookie

This documentation task does not require those screenshots.
