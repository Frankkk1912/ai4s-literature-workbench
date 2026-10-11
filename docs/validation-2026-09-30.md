# Validation contract execution record — 2026-09-30

## Overview

- Repo: ai4s-literature-workbench (Frankkk1912/ai4s-literature-workbench)
- Branch: feat/standalone-workbench-dashboard
- HEAD: `29c71ea` (M6; T7.0 marketplace files and this record are uncommitted — orchestrator commits)
- Date: 2026-09-30
- Reviewer (自动化): worker + scout + main agent
- Reviewer (人工): Frank
- Draft PR: https://github.com/Frankkk1912/ai4s-literature-workbench/pull/1 — **still Draft** (this round did not call `gh pr ready` or merge)

## T7.0 — marketplace.json (M1 漏项补全)

Worker decision: **Option A** — create `.codex-plugin/marketplace.json` (do **not** create `.agents/plugins/marketplace.json`).

Reasons:

- This repository already owns `.codex-plugin/plugin.json` and has **no** `.agents/` directory.
- Parent `.agents/plugins/marketplace.json` is a multi-plugin catalog with nested `source.path: ./plugins/ai4s-literature-workbench`. This checkout is a single-plugin repo; nesting `./plugins/...` would be wrong.
- Keeping Codex metadata next to `.codex-plugin/plugin.json` matches the new-repo layout. Parent layout is historical.

Claude marketplace: `.claude-plugin/marketplace.json`

- `name`: `ai4s-literature-workbench` (repo identifier; distinct from parent marketplace `frank-ai4s-skills`)
- `owner`: matches `.claude-plugin/plugin.json` `author`
- `plugins[].name`: `ai4s-literature-workbench` (matches plugin.json)
- `plugins[].source`: `"./"` (marketplace root is the plugin root; not `"./plugins/..."`)
- `plugins[].description`: matches plugin.json exactly (no extra “WoS browser jobs” clause; no unverified version field)

Codex marketplace: `.codex-plugin/marketplace.json`

- `name`: `personal` (matches README `ai4s-literature-workbench@personal` and parent Codex catalog name)
- `plugins[].name`: `ai4s-literature-workbench`
- `plugins[].source`: `"./"`
- no `version` field (versions read from plugin manifest)

`codex plugin marketplace add` working path under Option A:

```bash
codex plugin marketplace add /path/to/ai4s-literature-workbench
codex plugin add ai4s-literature-workbench@personal
```

Pass the **repository root** (the directory that contains `.codex-plugin/`). Compatibility vs parent: plugin id stays `ai4s-literature-workbench@personal`. If a given Codex build only discovers `.agents/plugins/marketplace.json`, V13 will fail on that host and Frank can then choose Option B. That check is V13 (Frank), not assumed here.

JSON validity (this round):

```text
python3 -m json.tool < .claude-plugin/marketplace.json  → exit 0
python3 -m json.tool < .codex-plugin/marketplace.json   → exit 0
plugin.json name == marketplace plugins[0].name         → True
plugin.json description == marketplace plugins[0].description → True
owner == plugin.json author                             → True
```

## V1 — onboarding 核心回归

- Command: `node --test tests/*.test.mjs`
- Result: **55/55 PASS** (0 fail, 0 skipped, 0 todo)
- Evidence (tail):

```text
✔ reconfigure can skip after a validation failure without persisting the key (0.917375ms)
ℹ tests 55
ℹ suites 0
ℹ pass 55
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 7234.349584
```

- Exit: 0

## V2 — runtime 静态检查 + 测试

- Command: `cd runtime && npm run typecheck && npm test` (existing `node_modules`; no `npm ci` this round)
- Result: typecheck exit 0; vitest **71 passed | 2 skipped files**; **354 passed | 7 skipped tests** (361 total)
- Evidence:

```text
> literature-zotero-mcp@0.1.0 typecheck
> tsc --noEmit
(exit 0)

Test Files  71 passed | 2 skipped (73)
     Tests  354 passed | 7 skipped (361)
  Duration  3.47s
```

- Exit: typecheck 0, test 0

## V3 — fulltext / database-browser

- Command: `cd fulltext-runtime && npm run build && npm test` then `cd database-browser-runtime && npm run build && npm test` (actual directory name is `database-browser-runtime`; existing `node_modules`; no `npm ci`)
- Result:
  - fulltext-runtime build exit 0; vitest **3 files / 6 tests** passed
  - database-browser-runtime build exit 0; vitest **4 files / 14 tests** passed
- Evidence:

```text
fulltext-runtime: Test Files 3 passed (3); Tests 6 passed (6); Duration 1.21s
database-browser-runtime: Test Files 4 passed (4); Tests 14 passed (14); Duration 4.67s
```

- Combined automated count this round: **20/20 PASS**

## V4 — assemble-plugin check

- Command: `node scripts/assemble-plugin.mjs check`
- Result: exit 0
- Evidence:

```text
Workbench check passed: structure, manifest inventory, build artifacts, lockfiles, and build inputs are rebuildable.
Dist entries are not built by check. Produce them with: cd runtime && npm run build; cd fulltext-runtime && npm run build.
```

## V5 — literature-metrics check + package

- Command: `cd literature-metrics && npm run check && npm run package` (existing `node_modules`; no `npm ci`)
- Result: exit 0; produced `literature-metrics/dist/literature-metrics-0.1.13.xpi`
- Evidence: file size **35258 bytes**; gitignored via `literature-metrics/.gitignore:1:dist/`; package version `0.1.13` from `literature-metrics/package.json` (not a new unverified version)

```text
Success! Literature Metrics add-on structure and JavaScript syntax are valid.
Success! Literature Metrics XPI written to: .../literature-metrics/dist/literature-metrics-0.1.13.xpi
```

## V6 — 网页向导人工验证 (macOS + Windows)

- Status: **人工验收** — Frank
- Evidence: M4 commit history `55dc4d2` + `deffea2` + `5385dc7` + `20edf96` + `12a20ca` 收尾；`tests/admin-http.test.mjs` 706 行；CI run **36430299675** 三平台 + secret-scan 全绿. Plan §7 T4.4 remains `[ ]` until Frank signs V6.
- Frank sign-off: **pending**

## V7 — 看板语义人工核对

- Status: **人工验收** — Frank
- Evidence: M5 commit `6a4606a` 收尾；`tests/dashboard-semantics.test.mjs` 535 行覆盖 §4 D 方案硬约束（未配对/过期/XSS 注入/凭证 URL 脱敏/长路径/键盘焦点/窄屏）
- Frank sign-off: **pending**

## V8 — 安全专项

- Status: **自动化 PASS**（M4 + M5 自动化用例）
- Evidence: `tests/admin-http.test.mjs` **706** 行 + `tests/dashboard-semantics.test.mjs` **535** 行（合计 1241 行）. Covered in V1 (55/55) this round: Host/Origin 伪造跨站、裸前缀尾斜杠 302、未配对 401 body 不含状态、会话过期内存清除、XSS 注入串文本转义.
- Manual browser portion of V8 remains with V6/V7 (Frank).

## V9 — 泄密扫描门禁（gitleaks 固定版本 v8.30.1）

- Command (v8.30.1 CLI; `--source` is **not** a flag on this version — CI uses positional path):

```text
gitleaks git . --no-banner
gitleaks dir . --report-path /tmp/gl-final-dir.json --no-banner
```

- Gitleaks version: **v8.30.1**
- Local binary SHA256: `ba52fb1bfabbcde42f032afad3d6e0b19dff8ed105229a16e7caa338bbc0e84f` (`/opt/homebrew/bin/gitleaks`)
- CI linux tarball pin (workflow): `gitleaks_8.30.1_linux_x64.tar.gz` SHA256 `551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb`
- Result: **0 hits** on git history (19 commits scanned, ~4.48 MB) and working tree (~5.49 MB after this record was written, including T7.0 untracked marketplace JSON). Report `/tmp/gl-final-dir.json` is `[]`.
- Evidence:

```text
19 commits scanned.
scanned ~4481190 bytes (4.48 MB) in 370ms
no leaks found

scanned ~5476559 bytes (5.48 MB) in 178ms
no leaks found
```

- CI equivalent: secret-scan job on run **36683160992** (push `29c71ea`) 全绿. Same job on PR run **36683167700** 全绿.
- Forge exclusion: this repo has no `forge/` directory; `git ls-files` reports 0 `forge/` paths.

## V10 — 父仓本轮无代码改动（基线 diff + 白名单）

- Command: `cd /Users/example/Documents/GitHub/Frank_AI4S_Skill && git status --porcelain && git diff --stat HEAD`
- Result: **0 rows** status; **0 rows** diff
- Parent HEAD: `9b70c30` (`9b70c30e79efd7352727d46dcb877cc968fc2e74`)
- This round did not write any file under the parent tree.

## V11 — CI 矩阵三平台全绿 + 扫描 job 必过

- Latest committed HEAD (`29c71ea`, M6):
  - push run **36683160992** success — jobs: `test (ubuntu-latest)`, `test (macos-latest)`, `test (windows-latest)`, `secret-scan`
  - PR run **36683167700** success — same four jobs
- M7 commit has **not** been created yet (no git write this round). After the orchestrator commits T7.0–T7.2, Frank should wait for that run to go green before merging.
- Cumulative key runs since M2:

| Milestone | SHA | Run | Event | Result |
| --- | --- | --- | --- | --- |
| M2 first full green | `1a27f5f` | 36399473070 / 36399477570 | push / PR | success (3 OS + secret-scan) |
| M3 | `d09b50b` | 36410518246 / 36410522665 | push / PR | success |
| M4 (after Windows npm.cmd fix) | `20edf96` | 36430299675 | PR | success |
| M5 | `6a4606a` | 36679723091 push | push | **failure** (`test (windows-latest)` only; ubuntu/macOS/secret-scan success) |
| M5 | `6a4606a` | 36679730947 | PR | success (3 OS + secret-scan) |
| M6 | `29c71ea` | 36683160992 / 36683167700 | push / PR | success (3 OS + secret-scan) |

- Current merge-gate evidence: latest PR head `29c71ea` is all-green. Historical Windows flakes on earlier SHAs were fixed before M6.

## V12 — WorkBuddy 文档核对

- Status: **人工验收** — Frank
- Evidence: M6 README + `docs/onboarding.md` WorkBuddy 段落全“未实测”标注；M6 scout 验证 0 过度承诺（commit `29c71ea`)
- Frank sign-off: **pending**

## V13 — Claude Code / Codex 安装路径回归

- Status: **待 Frank 实测**（依赖 T7.0 marketplace.json 补全； files exist in the worktree, not yet on origin until orchestrator commit/push）
- Evidence: T7.0 completed locally. Suggested Frank commands after the M7 commit is on the branch:

```text
/plugin marketplace add Frankkk1912/ai4s-literature-workbench
claude plugin install ai4s-literature-workbench@ai4s-literature-workbench

codex plugin marketplace add /path/to/ai4s-literature-workbench
codex plugin add ai4s-literature-workbench@personal
```

- Note: README still documents `claude plugin install ai4s-literature-workbench@frank-ai4s-skills` (parent marketplace name). This round did **not** edit README (M6 freeze). Marketplace `name` in this repo is `ai4s-literature-workbench` so the install suffix is `@ai4s-literature-workbench`. Frank should use the marketplace.json name, not the parent suffix, unless a later README fix is approved.
- Frank sign-off: **pending**

## V14 (Frank 自主验收) — 视觉核对与截图留档

- Status: **人工验收** — Frank
- 截图清单：
  - v6-mac-wizard.png — 配对后向导页
  - v7-mac-desktop-mixed.png — 看板桌面 1280px 混合状态
  - v7-mac-narrow.png — 看板 360px 窄屏
  - v7-mac-401-body.png — 未配对 401 body curl 输出
- Frank sign-off: **pending**

## Overall status

| 项目 | 自动化 | 人工 |
| --- | --- | --- |
| V1 onboarding 核心回归 | PASS (55/55) | — |
| V2 runtime 静态 + 测试 | PASS (typecheck 0; 354 tests) | — |
| V3 fulltext / db-browser | PASS (6 + 14) | — |
| V4 assemble-plugin | PASS | — |
| V5 literature-metrics package | PASS (0.1.13.xpi 35258 B) | — |
| V6 向导人工验证 | — | 待 Frank |
| V7 看板人工核对 | — | 待 Frank |
| V8 安全专项 | PASS (automated) | 待 Frank 浏览器部分 |
| V9 泄密扫描门禁 | PASS (0 hits) | — |
| V10 父仓无改动 | PASS | — |
| V11 CI 矩阵 | PASS on HEAD `29c71ea` | 待 M7 commit 后 CI |
| V12 WorkBuddy 文档 | — | 待 Frank |
| V13 安装路径回归 | T7.0 files ready | 待 Frank |
| V14 视觉核对 + 截图 | — | 待 Frank |

## 附录 B 自查

Plan 附录 B（rev4 规划期自查）存在于 `plans/20260928-literature-workbench-standalone-dashboard.md`。M7 按清单重核：

| 附录 B 项 | M7 结论 |
| --- | --- |
| 9 段结构齐全且顺序固定（Goal → … → Git 策略） | 通过 — 结构未改 |
| Milestone 数量 ≤10（目标 ≤7） | 通过 — 仍为 7 个（M1–M7） |
| 每个功能缺口至少映射一个 To-do；无孤儿任务 | 通过 — 映射表仍在附录 B；本轮未增任务 ID |
| 每个任务都有文件/修改/验收/依赖 | 通过 |
| 任务 ID／Milestone ID／V 序号／Changelog 历史保留 | 通过 — rev1–rev5 changelog 原文仍在 |
| 真正产品待决收敛为 Q1–Q4 | 通过 — 见下表；Q5 仍为已决 D11 |
| 规划期“输出仅写入本 Plan / 未安装工具” | 不适用（那是规划期约束；实施期已安装固定版本 gitleaks v8.30.1） |
| §6 M4 / M7 checkbox | 本轮已勾选 `[x]`（M4 代码+自动化完成；V6 人工仍 pending，T4.4 保持 `[ ]`） |
| §7 T7.1 / T7.2 checkbox | 本轮已勾选 `[x]` |
| 不得自动 Draft→Ready / 合并 | 通过 — PR #1 仍为 Draft |

## Q1–Q4 当前状态

Plan §9.4 真实待决。本轮**不修改**该表，仅汇总：

| 待决 | 描述 | 当前状态 | 处理时机 |
| --- | --- | --- | --- |
| Q1 | 多 agent 安装脚本 | M6 未实现（N11 排除） | 后续 |
| Q2 | WorkBuddy 实测 | M6 文档标注“未实测”；V12 待 Frank | M7 收尾后由 Frank |
| Q3 | XPI 安装状态核验 | M5 看板“本轮未核验”；M6 `docs/zotero-xpi.md` 文档化手动步骤 | 后续 |
| Q4 | 父仓→新仓切换规划 | M6 `docs/migration-from-parent.md` 明确“切换另规划” | 后续 |

## 迁移对照表（T7.2）

`docs/migration-from-parent.md` **already contains** the parent-path → new-path tables, one-time tree/file SHA-256 archive, plugin-only table, intentional diffs, and forge exclusion list (`forge/vpnsci`, `forge/zotero-style`, other `forge/**`). T7.2 does not duplicate that file.

T7.0 marketplace JSON files are **new-repo-only** (not copied from parent). Parent marketplaces stay frozen and still point at `./plugins/ai4s-literature-workbench`.

## Draft PR 收尾报告

PR: https://github.com/Frankkk1912/ai4s-literature-workbench/pull/1

- Draft → Ready 由 Frank 在自动化全部 PASS + V6/V7/V12/V13/V14 人工验收完成后自行执行
- 本任务**没有**调用 `gh pr ready` 或 merge
- 累计 commits（M1–M6 on origin; M7 not committed by this worker）:

```text
214ad91 chore: add security baseline for fresh seed repository
936b3cb feat(migration): complete M1 — skills, runtimes, XPI migration with one-time hash baseline (T1.2-T1.6)
7170d83 ci(m2): add three-platform workbench CI with pinned gitleaks scan gate (T2.1, T2.2)
3be68ce ci(m2): install Playwright chromium from lockfile before db-browser tests; widen fulltext waitFor budget (T2.1)
e490fec fix(check): resolve npm.cmd on Windows in assemble-plugin check (T1.5 cross-platform)
4321225 fix(db-browser): bounded retry for Windows write-lock errors in writeJson; widen test budgets (T2.1)
9212df7 fix(fulltext): vitest testTimeout 15s + waitFor 10s budget for Windows CI (T2.1)
15fb697 fix(check): run npm through cmd.exe on Windows (EINVAL on npm.cmd without shell)
1a27f5f fix(store): 5s deadline replace-rename retry + early-failure waitFor diagnostics (T2.1)
d09b50b feat(onboarding): shared config core + evidence-graded status schema (M3)
402c9be docs(plan): move approved dashboard plan into workbench repo (M1-M3 checked)
55dc4d2 feat(admin): local onboarding wizard — pairing-code session, guarded management routes, key save API (T4.1-T4.3, T4.5)
20edf96 fix(test): run npm.cmd through shell on Windows (CVE-2024-27980 EINVAL, T4.5)
12a20ca docs(plan): check T4.5 with CI evidence (run 36430299675)
5385dc7 fix(admin): redirect bare prefix to trailing slash so relative wizard assets resolve (T4.4)
deffea2 fix(admin): trim pairing code on both ends (terminal copy-paste whitespace, T4.4)
49654c4 docs(plan): rev5 — D12 approved, agent may relay pairing code (keys never enter chat)
6a4606a feat(admin): local status dashboard with evidence-graded 4-tier semantics (T5.1-T5.3, M5)
29c71ea docs: standalone repo install matrix, onboarding/dashboard/XPI/migration docs, Keep a Changelog first release (T6.1-T6.4, M6)
```

- 累计 tracked 文件（HEAD `29c71ea`）: **406**（runtime 269 / tests 5 / docs 5 / `.claude-plugin` 1 / `.codex-plugin` 1 / skills 41 / literature-metrics 24 / database-browser-runtime 20 / fulltext-runtime 20 / scripts 9 / plans 2 / .github 1 / root 8）
- After orchestrator commit, expect +`.claude-plugin/marketplace.json` +`.codex-plugin/marketplace.json` +`docs/validation-2026-09-30.md` and the Plan checkbox edit
- 累计 diff at HEAD: **403 files changed, +77401 / −6** (vs root commit `214ad91`)
- 累计 CI: latest M6 runs 36683160992 / 36683167700 all success. M7 CI pending orchestrator push.

## Frank 待办

1. 转 Ready PR（点击 GitHub UI）— **仅在**下列项完成后
2. V6 向导浏览器验证 + 截图
3. V7 看板浏览器视觉核对 + 截图
4. V12 WorkBuddy 文档走查
5. V13 Claude Code / Codex 安装实测（依赖 T7.0 marketplace.json；Claude 插件后缀用 `@ai4s-literature-workbench`）
6. V14 视觉截图（v6-wizard.png + v7-desktop-mixed.png + v7-narrow.png + v7-401-body.png）
7. M7 commit 后的 CI run 全部 success 后，正式合并
8. （可选）README 仍写 `@frank-ai4s-skills`；是否改成 `@ai4s-literature-workbench` 留给后续文档修正，本轮未改 README
