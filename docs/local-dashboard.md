# Local configuration status view

The status view lives on the same loopback onboarding page as the pairing
form and credential wizard. It answers “what is configured on this machine,
and how strongly do we know that?” It does **not** run connection tests,
自动轮询, or 自动连接测试.

Wizard and pairing details: [`onboarding.md`](onboarding.md). XPI install:
[`zotero-xpi.md`](zotero-xpi.md). Visual constraints for the dashboard are listed in the section below.

## Where it appears

There is no separate dashboard URL. After pairing at
`http://127.0.0.1:3939/admin/onboarding/`, the page itself shows:

- the credential wizard, while any of Zotero / PubMed / EasyScholar is still
  unconfigured
- only the status view, once every provider reports `configured: true`

Start the Zotero MCP with `--http` on loopback, no OAuth, then redeem a
pairing session first. `/api/dashboard` JSON is a management route: it
requires that session. The onboarding HTML is the pairing page; protected
status data is filled in by script after a paired read.

## Five sections

| Section | What it shows | What it does not show |
| --- | --- | --- |
| 凭证 | Zotero / PubMed / EasyScholar existence and source (`environment` / `private_config` / `none`) | Online validation history, connectivity |
| 工作台核心 | `runtime/dist/index.js` and `fulltext-runtime/dist/index.js` existence | That an MCP is running or connected |
| Zotero 插件 | Manual install reminder; status **需要手动安装**, with a GitHub Releases download link | Installed / enabled in Zotero Desktop |
| 客户端工具 | Observable Claude Code / Codex / WorkBuddy clues | Host installed, or MCP connected |
| agent 连接 | Measured connection rows only | “已连接” without measured evidence |

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
| 校验 | An online verify succeeded. This round’s status view does **not** invent a “已校验” credential row; the current status payload has no stored validation timestamp. | Explained in copy, not faked as a success record |
| 产物 | A build artifact exists. Existence is not connectivity. | Runtime / Fulltext → **构建文件存在** / **未找到构建文件** |
| 连接 | A measured connection observation for that object only. | agent 连接 → **已连接（实测）** only when `level` is `verified` with evidence |

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
- XPI does **not** display as 已安装. The label is **需要手动安装**. Download
  from GitHub Releases and load the XPI in Zotero Desktop.
- A build artifact must not impersonate connectivity. Copy stays
  “已找到构建产物.”
- Unknown, missing, and 待人工核验 are valid states. They are not blank and
  not default-success.
- The page does not fabricate evidence, source line numbers, probe times, or
  last-configured times.
- Credentials and key-bearing URLs are never rendered.

## Session expiry and 401 JSON

The status view is not a second pairing UI.

| Situation | Behavior |
| --- | --- |
| No session / expired session / cookie cleared | Protected routes return **401 JSON** `{"error":"Pairing required."}` — not configuration state |
| Onboarding JS sees 401/403 on `./api/dashboard` | Hides the status view and returns to the pairing form |
| Process restart | In-memory session is gone; pair again |

Do not treat a 401 body as a screenshot of “all unconfigured”.

## Dashboard constraint index

The constraints are maintained in the code and tests
(`tests/admin-http.test.mjs`, `tests/onboarding-status.test.mjs`), not in a separate planning document.

1. Five sections as in T5.2 (凭证 / 工作台核心 / Zotero 插件 / 客户端工具 / agent 连接).
2. Four evidence kinds are visually distinct by section name, object label,
   and evidence sentence — not a four-color ladder and not a 3/3 score.
3. Every row has short evidence; paths belong in `<details>`.
4. Continue the T4 visual language; do not introduce a second brand system.
5. Use only returned fields or facts derived from those fields.
6. Generated clocks are 状态读取时间 only.
7. No measured evidence ⇒ no 已连接.
8. Host `verified` ≠ MCP connected; artifact exists ≠ connected; XPI is 需要手动安装.

## Screenshots (optional; not produced in M6)

Suggested Frank follow-up, no secrets in frame:

1. Desktop width of the onboarding page with the status view at the bottom
2. Narrow width, wrapping name / status / action, pairing input and button
   still on one row
3. 401 JSON body after clearing the session cookie

This documentation task does not require those screenshots.
