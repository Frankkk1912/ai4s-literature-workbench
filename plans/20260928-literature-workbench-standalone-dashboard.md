# Plan: AI4S Literature Workbench 独立仓 + 本机网页配置向导与状态看板

- 状态：**rev5 已批准并实施中**（M1–M3 完成、M4 代码完成待 V6 人工验收；任务 ID 与历史保留）
- 日期：2026-09-28（rev1 同日；rev2/rev3/rev4 增量修订）
- 任务来源：用户原话需求（独立 workbench 供多 agent 使用 / 配置进度网页 / Zotero 联动导入历史网页，一步一步来）＋访谈确认决策 (1)–(6)＋rev2 决策 **D7–D9**＋rev3 决策 **D10**＋rev4 新批准决策 **D11**＋rev5 新批准决策 **D12**
  - D7 首次打开本机管理页：终端显示短时一次性配对码，页面输入一次换取短时会话；每次写操作检查 Origin/CSRF；Key/配对码不进 URL（**注：其中“Key 不进 URL”经 D10 精确化——本地/浏览器 URL 绝不含 Key，服务端→PubMed/EasyScholar 官方 HTTPS 校验请求的查询参数为已批准例外；配对码任何情况下不进 URL**）。
  - D8 新仓沿用插件 `skills/runtime/fulltext-runtime/database-browser-runtime` 布局，第一方 `literature-metrics` 置根；父仓正式源码作迁移基线、插件独有内容另核对；新仓不再从父仓自动同步。
  - D9 Windows/macOS/Linux 三平台 CI **全必过**。
  - D10（rev3 批准）PubMed `verifyPubmedKey` 与 EasyScholar `verifyEasyScholarKey` 的**现有服务端→各自官方 HTTPS API 验证请求**允许以 `api_key` / `secretKey` 查询参数携带 Key（保持现状实现）；浏览器/本机管理页 URL/地址栏、管理服务日志/响应/错误/报告/chat 必须不含明文 Key，并有 mock 验证与脱敏测试。
  - D11（rev4 新批准）本机当前 `command -v gitleaks` **无输出（未安装）**；**仅在本 Plan 明确批准后的实施中**安装/启用**固定版本** gitleaks（或等效自动化扫描器，但换用等效扫描器须经用户**明确批准**）。**首次 push 前**必须对新仓待提交/工作区内容自动扫描；**每次后续 push 前**扫描新仓**全部历史＋工作区**；**发现任何命中即停止推送/合并**，先审查/修复或**清洁重建 fresh seed**；**禁止**以手工扫描降级通过。新仓 baseline commit 也须**先扫描后首次 push**；随后 Draft PR 的 CI 同步扫描（必过门禁）。私有 GitHub 仓创建与首次 push 是**不同步骤**：先建私有空仓→本地扫描→再 push。父仓 forge 任何内容不入新仓。
  - D12（rev5 新批准）**允许 agent 向用户转述配对码**（agent 启动 `--http` 服务的场景，从 stderr 通道获知后告知用户，降低“用户面对终端”的门槛）；护栏：①配对码机制不变（≥128-bit、5 分钟 TTL、单次兑换、常数时间比较、限流）；②**只可转述配对码，key 永不进 chat/agent 输出**（R12 不变）；③转述仅限本会话内刚启动的服务、不写入任何持久笔记/备忘；④配对码仍绝不进 URL/服务端日志。stderr 终端显示通道保留为并行信道。
- 证据来源：`plans/explore-20260928-workbench-standalone-onboarding-history.md`（已完整阅读并逐条核对）＋本 Plan 引用的代码/文档行范围（rev3 已精确复核 `scripts/onboard.mjs` 三个验证器）＋调用方提供的外部资料（已标注可信度）＋D11 现状证据（本机 `command -v gitleaks` 无输出，**本次规划未安装任何工具**）
- 输入约束：仅就地增量更新本 Plan 文档；不修改任何其他文件；**不在规划阶段下载/安装任何扫描工具**

---

## 1. Goal

1. 建立 `Frankkk1912/ai4s-literature-workbench` **私有 GitHub 独立仓库**（fresh seed 新历史，绝不 mirror 父仓历史），把文献工作台的技能、MCP 运行时、database-browser-runtime 与第一方 `literature-metrics` XPI 源码迁入，成为**未来唯一维护源**；父仓旧版保持兼容、冻结不动，切换另规划。
2. 提供**本机网页配置向导**作为 CLI 之外的可视化配置入口（**CLI 完整保留**，网页不替代 CLI）：用户在浏览器中输入、校验并保存 Zotero / PubMed / EasyScholar 三个 API key，解决“不知道配了哪些、没配哪些”的体验问题；沿用现有校验器与私有配置文件语义。
3. 提供**本机网页配置状态看板**：一眼看清 3 个凭证的存在性与来源、Zotero/Fulltext MCP 构建产物存在性、Zotero XPI 人工安装提示（本轮不核验安装状态）、以及本机 Claude Code / Codex / WorkBuddy 宿主配置/安装的可观察线索；**只有实测连接证据才显示“已连接”**，否则显示“未知/待人工核验”并展示判断依据。
4. 用户价值与承诺边界：通过**文档化接入路径**让各 agent（含国产 WorkBuddy/CodeBuddy 等）可接入工作台；接入结论以可证实范围为限——Claude Code / Codex 安装路径可测并验证，**WorkBuddy 未实测、不承诺安装或使用成功**；用户通过本机网页清楚知道“缺什么、怎么补、补到什么程度”，且凭证暴露边界按 R12 的**三通路精确承诺**执行（本地/浏览器 URL 与地址栏永不出现明文 Key；日志/响应/错误/报告/chat 不含明文 Key；仅服务端→官方校验请求允许按 D10 例外携 Key）。
5. 首轮明确**不做**导入历史（用户访谈决策 3、6），避免范围蔓延；每一步可独立验证、可回滚；新仓任何一次推送都以**固定版本自动化泄密扫描**为前置门禁（D11）。

## 2. Requirements

来源标记：〔U〕=用户原话需求；〔D#〕=访谈确认决策（D1–D11）；〔C〕=代码/文档证据推导的硬约束；〔H〕=ai4s-harness-project 加载策略（调用方提供）。

### 硬约束（必须满足）

- R1〔D1〕建立私有独立仓库 `Frankkk1912/ai4s-literature-workbench`，迁入技能源码与运行时源码，作为**未来唯一维护源**；父仓旧版暂留兼容且**冻结**，后续另规划切换。
- R2〔D2〕第一方 `literature-metrics` XPI 源码迁入新仓；首轮**只维持构建与手动安装说明**，不扩展 XPI 功能。
- R3〔D3〕首轮范围为“本机网页配置向导＋状态看板”；网页可**输入/校验/保存** Zotero、PubMed、EasyScholar API keys，沿用原有校验逻辑与私有文件；网页是 CLI 之外的**新增 UX 入口**，CLI 向导完整保留（见 E3）；**导入历史明确不做**。
- R4〔D4〕看板必须展示：
  - 3 凭证的存在性及来源（environment / private_config / none）；
  - Zotero MCP 与 Fulltext MCP **构建产物存在性**（不得冒充连通）；
  - XPI **人工安装提示**（明确标注**本轮**安装状态未核验）；
  - 本机 Claude Code / Codex / WorkBuddy **宿主配置/安装的可观察线索**；
  - **仅有实测连接证据才显示“已连接”**；否则“未知/待人工核验”并显示依据。
- R5〔D5＋D7〕网页挂在**现有 Zotero MCP 的 HTTP 模式**上（不新增独立常驻服务），访问与授权模型为**配对码＋短时会话**：
  - 仅本机 loopback 可打开；远程/OAuth 模式下**禁用管理路由**（不注册管理路由、不产生配对码）；
  - 首次打开管理页：终端显示**短时一次性配对码**（≥128-bit 随机、默认 TTL 5 分钟、**仅可兑换一次**、常数时间比较、兑换尝试限流）；页面输入一次即**兑换为短时受限会话**（默认 TTL 30 分钟、HttpOnly＋SameSite=Strict cookie 或等价授权头、仅授权管理路由、服务重启即失效）；
  - 会话建立后可执行**多次操作**；**不允许每请求使用一次性码**；配对码兑换后立即作废，重放/过期均被拒；
  - **全部管理 API（GET 与 POST）都必须在兑换会话后才可访问**：任何未配对读写一律拒绝；**唯一**允许未授权提供的是不含任何状态/密钥的配对页本身；（rev3 修复 rev2 高危漏项：状态读取 GET 等管理读接口不得裸奔）；
  - **Host 与 Origin 检查覆盖管理 GET 与 POST**；**每次写操作**都校验 Origin/CSRF（不只兑换时）；DNS rebinding 防护覆盖管理路由全集；
  - **配对码任何情况下不进 URL、不进日志**；**key 不进任何本地/浏览器 URL/地址栏**（key 进 URL 的唯一例外见 R12/D10：服务端→PubMed/EasyScholar 官方 HTTPS 校验请求的查询参数）；
  - 除三条受控通路（R12）外**不向网络传输原 key**。
- R6〔C〕凭证语义与现状保持一致：脱敏报告只含能力/状态元数据（`scripts/onboard.mjs:98-137`）；私有目录/文件权限与原子写入约定不变（`runtime/scripts/credential-utils.mjs:12-28`）；保存前先校验、无效 key 不落盘、网络失败不覆盖既有设置（`scripts/onboard.mjs:252-338`、`docs/onboarding.md:27-58`）。
- R7〔D＋C〕迁移时**包含插件目录专有的 `database-browser-runtime/`**（`database-browser-runtime/package.json:1-56` 为独立 npm 包）；**父仓 `markets`/`sync` 安装器留旧版兼容，不得破坏**（`.claude-plugin/marketplace.json:1-19`、`.agents/plugins/marketplace.json:1-30` 均指向 `./plugins/ai4s-literature-workbench`）。
- R8〔D〕新仓安全基线**从第一 commit 起包含 `.gitignore` / `.gitattributes`**；新私有仓基于**干净快照、fresh seed 新历史**；**严禁 `git push --mirror` 或任何父仓历史迁移**（父仓含无关私有内容，敏感历史只能以 fresh seed 处理）；**创建远端/推送仅在本 Plan 获批后的实施中进行**；**父仓现存 forge 未跟踪内容（`forge/vpnsci`、`forge/zotero-style` 等）绝对不得进入新仓**（列入迁移排除清单与 V9 核验）。
- R9〔D9＋H〕新仓默认 **private**，具备 Git 防泄漏基线；**Windows、macOS、Linux 三平台 CI 全部必过**；安全扫描范围**包含 `literature-metrics` XPI 源码与 `database-browser-runtime`**（含插件专有内容），不限于技能与 runtime。
- R10〔C〕旧用户配置文件必须继续可用：native 平台路径优先、legacy `~/.config/...` 路径继续读取（`runtime/src/lib/env-files.ts:12-62`、`scripts/onboard.mjs:40-84`）；XPI 的 onboarding 静态路径（`scripts/onboard.mjs:21-28` `ZOTERO_XPI_ONBOARDING.artifact`）在 D8 布局下相对路径语义不变（`literature-metrics/` 置根后 `literature-metrics/dist/literature-metrics-<version>.xpi` 仍成立），迁移时不得破坏既有指引语义。
- R11〔D8〕新仓布局与迁移基线：沿用插件目录布局 `skills/`、`runtime/`、`fulltext-runtime/`、`database-browser-runtime/`，第一方 `literature-metrics/` 置于仓根；**父仓正式源码为迁移基线**（`literature-research/`、`literature-manager/`、`literature-writing/`、`literature-zotero-mcp/`、`literature-fulltext-mcp/`、根级 `literature-metrics/`），迁移期做**一次性** source→destination 哈希对照并留档；**插件独有内容另核对**（`.claude-plugin/`、`.codex-plugin/`、`.mcp.json`、`scripts/onboard.mjs`、`tests/onboarding.test.mjs`、`database-browser-runtime/`、docs 等，逐项核对表）；**新仓不再从父仓自动同步**，独立仓日后的校验以打包产物/manifest/可重建性为准（见 T1.5），不保留任何父仓运行依赖。
- R12〔D7＋D10＋C〕key 的**三通路精确暴露边界承诺**（rev3 系统修正 rev2 的“只经两条路径/不进 URL”绝对表述）：
  1. **浏览器→本机 loopback POST body**：页面向本机管理服务提交 key 仅经 POST body（本地/浏览器 URL、地址栏、管理页链接**永不**含 key）；用户自身 DevTools 可见本机提交 payload 属固有边界；
  2. **Zotero 官方请求 Header**：服务端→`https://api.zotero.org/keys/current` 以 `Zotero-API-Key` Header 携带 key（`scripts/onboard.mjs:238-257`）；
  3. **PubMed 与 EasyScholar 官方 HTTPS 查询 URL（D10 已批准例外）**：服务端→官方校验 API 以 `api_key`（PubMed，`scripts/onboard.mjs:259-275`，`einfo.fcgi?...&api_key=`）/ `secretKey`（EasyScholar，`:277-292`，`getPublicationRank?...&secretKey=`）查询参数携带 key；该 URL **仅服务端可见**，且可能被服务商（NCBI/EasyScholar）按其 API 设计接收/记录——属官方接口固有形态，已获用户批准；
  - 因此承诺与禁止：**本地日志、错误、响应、状态报告、agent chat 一律不含明文 key**，且**不得回显任何含 key 的官方请求 URL**（错误/重试/异常路径同样脱敏）；**本地/浏览器 URL/地址栏永不出现 key**；配对码任何情况下不进 URL/日志；**不承诺“网络面板无 key”**（通路 1 对用户 DevTools 可见、通路 3 对服务商可见均属已知边界）。
- R13〔D11〕**固定版本自动化泄密扫描是推送/合并的前置门禁**：
  - 本机当前 `command -v gitleaks` 无输出（未安装）；**仅在本 Plan 获批后的实施中**安装/启用**固定版本** gitleaks（或等效自动化扫描器——**换用等效扫描器必须经用户明确批准**）；安装前须确认**固定版本来源**与**跨平台方案**（Windows/macOS/Linux）；**本次规划不得安装任何工具**；
  - **首次 push 前**：对新仓**待提交/工作区内容**自动扫描（新仓 baseline commit 也适用：**先扫描、后首次 push**）；
  - **每次后续 push 前**：扫描新仓**全部历史（每个 commit）＋工作区**；
  - **任何命中即停止推送/合并**：先人工审查/修复，或**清洁重建 fresh seed**；不得带命中推送；
  - **禁止**以手工扫描降级通过（无“手工补救＋书面豁免＝通过”路径）；
  - Draft PR 的 CI **同步运行**同规格扫描并作为**必过门禁**（与三平台 CI 一样阻塞合并，关联 G2）；
  - 私有远端仓**创建**与首次 **push** 是不同步骤：先创建私有空仓→本地完成扫描→再 push；
  - 父仓 forge 任何内容（`forge/vpnsci`、`forge/zotero-style` 等）不入新仓。

### 期望行为（应满足，允许降级实现并记录）

- E1〔U〕多宿主接入以文档为准：Claude Code / Codex 沿用现有清单与 marketplace 安装路径（`.claude-plugin/plugin.json`、`.codex-plugin/plugin.json`、`.mcp.json:1-17`）并在本轮**实测验证**；WorkBuddy/CodeBuddy 给出接入路径文档并**统一标注“未实测/待人工核验”**，不作成功承诺（R4/G3、Q2）。
- E2〔U〕看板让“配了哪些、没配哪些”一目了然，区分四个层级：已保存 / 已在线校验 / 构建产物存在 / 实测连接。
- E3〔C〕网页向导与 CLI 向导能力对等（`status|setup|reconfigure` 语义，`scripts/onboard.mjs:367-413`）；**CLI 不删除、不弱化**，网页只是 UX 入口；两入口共用同一核心（T3.1）与同一落盘语义。
- E4〔D9〕三平台 CI（Windows/macOS/Linux）全部为必过门禁；现有 Claude Code / Codex 安装路径在新仓继续可安装并纳入回归（V13）。

## 3. Non-goals

- N1〔D6〕**不做 Zotero 导入历史**：不展示 receipt/plan/文献清单，不做“每次导入了哪些文献”页面（原需求第三个设想在本轮明确排除）。
- N2〔D6〕**不做远程共享网页**：无远程访问、无公网部署、无多用户。
- N3〔D6〕**不做 WorkBuddy 一键安装**（未实测）；只提供文档与可观察线索，不承诺安装成功率。
- N4〔D2〕**不扩展 XPI 功能**：只迁源码、维持 `npm run check`/`package` 构建链与手动安装说明（`literature-metrics/package.json:8-14`）。
- N5〔D〕**不改父仓**：`marketplace.json`×2、`sync/`、父仓 `plugins/ai4s-literature-workbench/` 旧版、`scripts/assemble-plugin.mjs` 的父仓侧语义全部不动、不切换流量。
- N6〔D〕**不迁移/不镜像父仓 Git 历史**；不做 `git push --mirror`；敏感历史只以 fresh seed 处理；不把父仓无关私有内容（含 forge 未跟踪目录）带入新仓。
- N7〔D5〕**不新增独立常驻 Web 服务**；不做 Docker/系统服务化。
- N8〔C〕**不做“连通性冒充”**：不以构建产物存在或凭证存在推断“已连接”；**本轮不做 XPI 安装状态核验**（`scripts/onboard.mjs:21-28` 现状即人工安装指引），看板显示“本轮未核验”而非“永不核验”——未来是否引入核验属 Q3。
- N9〔C〕不改动现有 MCP 工具契约（17 个工作台工具）、不改变 Zotero 写入的 plan-hash 审批模型。
- N10〔D〕不在本轮处理“父仓→新仓切换/停更计划”（另规划，Q4）。
- N11〔Q1 范围决策未决〕**本轮不在新仓新增/重写多 agent 安装脚本**（`sync/install.*` 类）：Claude Code / Codex 以现有清单＋marketplace 路径验证可安装（V13）；新仓是否自带安装脚本属影响范围的产品决策（原 P6），留待用户在后续“多 agent 分发”范围规划时批准（Q1），**不阻塞本轮审批**。
- N12〔D11〕**不在本次规划阶段安装/下载任何扫描工具**；**不接受“手工补救＋书面豁免＝通过”**的泄密扫描降级路径；不因扫描器未安装而放宽任何 push 门禁。

## 4. Research summary

### 4.1 代码库现状（已核对；rev3 精确复核三个验证器）

| 结论 | 证据 |
| --- | --- |
| 插件分发快照由**上级仓库组装**，`source_root: ../..`，5 组 bundle（3 技能＋zotero runtime＋fulltext runtime）同步并做 tree-hash drift 校验 | `scripts/assemble-plugin.mjs:18-27,135-173`；`bundle-manifest.json` |
| 父仓两个 marketplace 都指向子目录 `./plugins/ai4s-literature-workbench`；`sync/install.*` 是父仓安装面 | `.claude-plugin/marketplace.json:1-19`；`.agents/plugins/marketplace.json:1-30` |
| onboarding 已有：3 凭证跨平台路径＋legacy 路径、脱敏状态（存在性＋来源）、3 个联网校验器、TTY 掩码输入、私有文件写入、`status/setup/reconfigure` CLI | `scripts/onboard.mjs:21-84,98-137,201-250,252-338,367-413` |
| **（rev3/D10 证据）** 三个验证器的 key 通路：Zotero 走 **Header** `Zotero-API-Key`（`scripts/onboard.mjs:238-257`）；PubMed `verifyPubmedKey` 以 **`api_key` 查询参数**进官方 HTTPS URL（`:259-275`，`einfo.fcgi?db=pubmed&retmode=json&api_key=`）；EasyScholar `verifyEasyScholarKey` 以 **`secretKey` 查询参数**进官方 HTTPS URL（`:277-292`，`getPublicationRank?publicationName=Nature&secretKey=`）。（调用方 D10 引用 L226-L249 为同一验证器代码块；行号以当前文件精确读取为准） | `scripts/onboard.mjs:238-292` |
| `fetchJson` 重试循环与错误信息只含 provider 名与固定文案（当前不回显 URL），rev3 需为含 key 的官方请求 URL 增加显式脱敏测试（含错误/重试/异常路径） | `scripts/onboard.mjs:207-236` |
| `redactedStatus` **只报存在性**，不作实时连通/权限核验；`zotero_desktop_xpi` 是**静态人工安装提醒**，恒为 `manual_install_required` | `scripts/onboard.mjs:98-137,21-28`；`tests/onboarding.test.mjs` |
| MCP HTTP 模式已存在：`--http/--host/--port`、`PORT/HOST`；默认 loopback，非 loopback 无 OAuth 直接拒绝；路由仅 `/mcp`、`/healthz`、`/readyz`、可选 `/metrics` | `runtime/src/index.ts:27-77`；`runtime/src/transports/http.ts:57-73,147-210` |
| DNS rebinding 防护目前**仅 OAuth 模式开启**（`enableDnsRebindingProtection: Boolean(oauth)`）；`cors()` 只挂在 MCP path；**无任何管理/表单路由、无 CSRF 防护、无会话/配对机制** | `runtime/src/transports/http.ts:77-90,147-210` |
| 凭证文件 native 路径优先、legacy 兼容、`LITERATURE_ZOTERO_MCP_ENV_FILE` 显式覆盖；与收据数据目录（`runtime/src/lib/paths.ts:5-23`）分离 | `runtime/src/lib/env-files.ts:12-62` |
| `database-browser-runtime` 是插件目录专有 npm 包（Playwright MCP broker） | `database-browser-runtime/package.json:1-56` |
| XPI 源码在父仓根 `literature-metrics/`（v0.1.13，`check`/`package` 脚本，`dist/literature-metrics-<version>.xpi` 产物） | `literature-metrics/package.json:1-22`；`README.md:14-17` |
| 父仓**唯一 CI** 是 molecular-modeling（paths 全部为 molecular 相关目录），literature 侧无 CI | `.github/workflows/molecular-modeling-workbench-ci.yml:1-58` |
| 技术栈：Node ≥20.19、ESM/TS、Express 5、MCP SDK、Zod、Vitest；onboarding 测试用 `node:test`＋mock fetch | `runtime/package.json:26-70`；`tests/onboarding.test.mjs:1-6,75-124` |
| **（rev4/D11 证据）** 本机 `command -v gitleaks` **无输出**：自动化扫描器未安装；现状**不存在**可用的自动化泄密扫描门禁，须在获批实施中以固定版本补齐 | 调用方访谈确认（2026-09-28，D11） |

### 4.2 外部资料（调用方/研究员提供，**可信度受限**）

- WorkBuddy 官方文档 A（plugins-reference）：CodeBuddy CLI 插件与 `.claude-plugin` 布局兼容 → 支持“清单级兼容”的**文档性**接入路径。
- WorkBuddy 官方文档 B（MCP-Guide）：WorkBuddy 桌面端支持 URL 形式 MCP；**本地插件加载仍未核实**。
- GitHub Security Blog《localhost dangers: CORS and DNS rebinding》（2025-04-03）：localhost 服务必须校验 Host/Origin、收紧 CORS、防 DNS rebinding → 直接支撑 R5 的安全设计。
- ⚠️ 研究员回报中“2026-03-30 查询 2026-08-02 版本”**时间自相矛盾**：本 Plan **不复述任何版本号**、不采信镜像 push 建议；上述 WorkBuddy 结论一律按**未标注日期的资料快照**处理，实施时需人工重新核对（Q2）。

### 4.3 推荐方案（含取舍）

- **A. 独立仓＋fresh seed 迁移（采纳，D1/D2/D8）**：新仓自为 source-of-truth；`assemble-plugin.mjs` 的“父仓 source_root”模型取消（D8：不再自动同步），迁移期一次性基线哈希对照（R11），此后只验证打包产物/manifest/可重建性。代价：一次性迁移＋CI 成本；收益：唯一维护源、独立发版、供多 agent 消费。
- **B. 网页挂在 Zotero MCP HTTP 模式＋配对码会话（采纳，D5/D7）**：复用 `startHttp` 的 Express 应用与生命周期/限流/日志，新增 **loopback-only 管理路由**；授权模型为“终端一次性配对码→短时受限会话”，**全部管理 API（GET/POST）会话后才可读写**，每次写操作校验 Origin/CSRF。取舍：比独立服务少一个常驻进程；会话状态在内存、重启失效符合本机单用户场景；需把现有“仅 MCP path CORS、DNS rebinding 仅 OAuth 开启”的安全面补强（`runtime/src/transports/http.ts:77-90,147-210`）。
- **C. 复用 `onboard.mjs` 核心（采纳，R6/E3）**：把 `redactedStatus` / `verify*Key` / `save*Key` / 私有写入抽成可 import 的共享模块，CLI 与网页共用同一校验与落盘语义；网页是入口扩展而非替代（修正 rev1 “替代 CLI”表述）。
- **D. 看板“证据分级”（采纳，R4）**：`存在(来源) → 在线校验通过 → 构建产物存在 → 实测连接` 四级标签，连接级只允许实测证据驱动；XPI 本轮显示“人工安装、未核验”（修正 rev1 “永不核验”绝对化表述）。
- **E. key 暴露边界三通路精确断言（rev3 依 D10 修正 rev2）**：浏览器→本机 POST payload 对用户 DevTools 可见、Zotero 走 Header、PubMed/EasyScholar 官方校验 URL 含 key 查询参数（仅服务端可见、服务商可能接收）均为**已知且获准**边界；承诺收敛为 R12 的精确表述，测试与文档一致。
- **F. 推送前固定版本自动化扫描门禁（rev4/D11）**：自动化扫描器（固定版本 gitleaks，等效工具须用户批准）是每次 push/merge 的前置条件；命中即停、审查/修复或 fresh seed 重建；手工扫描**不构成**通过路径。取舍：实施期增加一次安装与 CI 步骤成本，换来“敏感历史绝不外泄”的硬门禁；本机当前未安装（`command -v gitleaks` 无输出），安装只在获批后进行。
- 曾比较的替代路径（explore §4）：保留父仓所有权只改分发包（否决：D1 要求唯一维护源）；独立常驻 dashboard 服务（否决：D5）；导入历史视图（否决：D3/D6）；每请求一次性凭证（否决：D7 明确一次性码只用于兑换会话，见 R5）；改为 Header 携带 PubMed/EasyScholar key（不采纳：现有官方 API 以查询参数为设计形态，D10 批准保持现状，避免改协议引入兼容风险）；手工扫描＋书面豁免兜底（否决：D11 明确禁止）。

## 5. Gap analysis

| ID | 功能缺口 | 现状 | 影响 | 补齐任务 |
| --- | --- | --- | --- | --- |
| G1 | 无独立源码主权：新仓不存在，源码由父仓组装（`source_root: ../..`） | `scripts/assemble-plugin.mjs:18-27,135-173` | 无法独立发版/供多 agent 消费；双重源码风险 | T1.2, T1.3, T1.5, T6.3 |
| G2 | 无独立仓 Git 安全基线（fresh seed 干净历史、防泄漏，扫描须覆盖 XPI 源码与 DB runtime；forge 未跟踪内容严禁随迁）；**且无自动化泄密扫描门禁**（rev4：`command -v gitleaks` 无输出） | 父仓含无关私有内容（含 `forge/vpnsci`、`forge/zotero-style` 未跟踪目录）；尚无新仓；本机无扫描器 | 泄密风险（高）；无扫描即推送等于无门禁 | T1.1, T7.1, T2.1, T2.2 |
| G3 | 多宿主（WorkBuddy/CodeBuddy）接入证据与文档缺失 | 仅 Claude/Codex/opencode 说明（`README.md:19-27`）；WorkBuddy 本地插件加载未核实 | 国产宿主接入不可预期 | T6.1 |
| G4 | 配置“进度”语义缺口：存在≠校验≠连通；XPI 恒报提醒；无宿主线索/连接证据概念 | `scripts/onboard.mjs:98-137,21-28` | 看板会误导用户 | T3.2, T5.1, T5.2, T5.3 |
| G5 | 无网页配置向导（输入/校验/保存 keys 只有 CLI） | `scripts/onboard.mjs:252-338,367-413` 仅 TTY | 配置过程不直观（用户核心痛点） | T3.1, T4.3, T4.4 |
| G6 | 网页安全边界缺口（rev3 扩展至**读接口**）：管理 GET/POST 无统一授权门禁（Host/Origin/CSRF/rebinding）、无配对码＋短时会话模型；**状态读取等管理读接口若未设会话门禁即为高危泄漏**（rev2 漏项） | `runtime/src/transports/http.ts:77-90,147-210`；DNS rebinding 防护仅 OAuth；无会话机制 | 未配对进程/页面可读取配置状态；凭证/状态被网页/局域网攻击面窃取（高） | T4.1, T4.2, T4.5, T5.1 |
| G7 | literature 侧无三平台必过 CI | 父仓唯一 CI 是 molecular（`.github/workflows/molecular-modeling-workbench-ci.yml`） | 迁移/网页改动无回归保障 | T2.1, T2.2 |
| G8 | XPI 源码归属与 onboarding 静态路径迁移、旧用户配置文件复用未定义 | `scripts/onboard.mjs:21-28,40-84`；`runtime/src/lib/env-files.ts:12-62`；`literature-metrics/` 在父仓根 | 迁移后指引失效或旧凭证“丢失” | T1.4, T1.6, T6.2, T6.3 |

自查记录见文末附录 B：**无孤立缺口**（含 rev3/rev4 反向映射更新）。

## 6. Milestone 表格

| Milestone | Status | Dependencies | Validation | Notes |
| --- | --- | --- | --- | --- |
| M1 新仓 bootstrap 与源码迁入（含 XPI、database-browser-runtime） | [x] | Plan 获批 | 迁移基线一次性哈希对照留档＋插件独有内容核对表；`node scripts/onboard.mjs status` 与 runtime 测试本地通过；**baseline commit 先自动扫描后才可首次 push**（R13） | fresh seed 新历史；首 commit 含 .gitignore/.gitattributes；forge 未跟踪内容排除清单生效（R8）；Draft PR 就绪后**尽早开启**（见 9.5） |
| M2 跨平台 CI 基线 | [x] | M1 | Windows＋macOS＋Linux 三平台**全必过**（D9）；**CI 泄密扫描 job 必过（关联 G2，R13）** | node:test＋vitest＋typecheck＋产物/manifest 校验＋XPI check/package＋固定版本扫描 |
| M3 配置核心复用层（状态/校验/私有写入抽包＋证据分级语义） | [x] | M1 | 新增/扩展单测全绿（含 D10 通路 mock 验证与脱敏测试）；`redactedStatus` schema 只增不改（additive，见 9.4 已决约束） | CLI 行为不变；网页与 CLI 共用核心 |
| M4 本机网页配置向导（HTTP 管理路由＋配对码会话＋安全＋保存 keys） | [ ] | M3 | 安全测试（配对码单次兑换、会话过期/重启失效、**GET/POST 全部会话门禁**、每次写操作 Origin/CSRF、日志/错误脱敏）＋保存流程测试全绿；人工浏览器验证通过 | loopback-only；OAuth/远程模式管理路由禁用 |
| M5 配置状态看板（证据分级 UI） | [x] | M3 | 语义测试：无实测证据绝不显示“已连接”；**状态 API 未配对不可读**；人工核对看板与实际一致 | 显示依据来源 |
| M6 文档、安装与兼容（多宿主＋XPI＋旧配置复用＋父仓不改声明） | [x] | M1, M4, M5 | 文档评审（隐私边界按 R12 三通路表述）；WorkBuddy 部分带“未实测”标注；Claude/Codex 安装路径回归（V13） | 父仓基线 diff 白名单验证（V10） |
| M7 收尾验证与 Draft PR 转 Ready | [ ] | M2–M6 | Validation contract 全项执行并留记录；自查/待决清单随 PR 提交 | **Draft PR 自 M1/M2 起持续更新，M7 只收尾**（修正 rev1 推迟开 PR 的错误） |

## 7. 分 milestone 的 To-do checkbox 清单

### M1 新仓 bootstrap 与源码迁入

- [x] T1.1 创建私有空仓 `Frankkk1912/ai4s-literature-workbench` 并落安全基线首 commit（rev4：**先扫描后首次 push**）
  - 文件：新仓根 `README.md`（占位）、`.gitignore`、`.gitattributes`、`LICENSE`、`THIRD_PARTY_NOTICES.md`
  - 修改：新建仓首个 commit **只含**安全基线与法律文件（fresh seed）；确认 private；不带入任何父仓 `.git` 历史；**迁移排除清单显式包含父仓 forge 未跟踪内容（`forge/vpnsci`、`forge/zotero-style`）**（R8）；**步骤分离**（D11/R13）：先创建私有空仓（远端创建）→在本地落 baseline commit→**用获批安装的固定版本扫描器扫描待提交/工作区**→**扫描零命中后才执行首次 push**；扫描命中则审查/修复或清洁重建 fresh seed，**禁止带命中 push、禁止手工扫描替代**
  - 验收：仓可见性为 private；`.gitignore` 覆盖 `node_modules/`、`dist/`、`.env*`、凭证/数据目录、pytest/coverage 缓存；`.gitattributes` 固定文本/换行策略；git log 仅 1 个全新 commit；无父仓无关文件、无 forge 内容；**首次 push 前的自动扫描报告（固定版本、命令、零命中）留档**
  - 依赖：Plan 获批（R8/R13；远端创建、扫描器安装与 push 均属获批后实施动作）
- [x] T1.2 迁入技能源码与宿主清单（D8：插件布局，父仓正式源码为基线）
  - 文件：新仓 `skills/literature-research/`、`skills/literature-manager/`、`skills/literature-writing/`、`.claude-plugin/plugin.json`、`.codex-plugin/plugin.json`、`.mcp.json`
  - 修改：按 D8 布局迁入（新仓 `skills/*`）；**迁移期一次性** source→destination 哈希对照（基线：父仓正式源码 `literature-research/`、`literature-manager/`、`literature-writing/`，沿用 `scripts/assemble-plugin.mjs:96-116` 的 hash 方法）并留档到迁移对照表；**插件独有内容另核对**（清单文件逐项核对表）；不改技能行为
  - 验收：迁移对照表记录一次性基线哈希（迁移期专用，非日常门禁）；`.mcp.json:1-17` 的 stdio 启动命令在新仓布局下可解析
  - 依赖：T1.1
- [x] T1.3 迁入三套运行时源码（含锁文件）
  - 文件：新仓 `runtime/`、`fulltext-runtime/`、`database-browser-runtime/`
  - 修改：按 D8 布局（`runtime/`、`fulltext-runtime/` 目录名沿用插件命名，内容基线为父仓正式源码 `literature-zotero-mcp/`、`literature-fulltext-mcp/`；`database-browser-runtime/` 为插件独有内容另核对）；迁入 `src/`、`package.json`、`package-lock.json`、`tsconfig.json`、`scripts/`、`.env.example`；不迁 `node_modules/`、`dist/`、`data/`；**迁移期一次性**哈希对照留档（排除生成物）
  - 验收：三包 `npm ci && npm run typecheck`（有则）与 `npm test` 本地通过；`runtime/package.json:23-44` 脚本语义不变；`database-browser-runtime/package.json:28-44` 的 build/test 可跑；迁移对照表含一次性基线哈希＋插件独有内容核对结论
  - 依赖：T1.1
- [x] T1.4 迁入 `literature-metrics` XPI 源码（仅构建维持）
  - 文件：新仓根 `literature-metrics/`（`manifest.json`、`src/`、`scripts/`、`package.json`、`update.json`、`LICENSE`、`THIRD_PARTY_NOTICES.md`）
  - 修改：整目录迁入仓根（D8）；基线为父仓根 `literature-metrics/`，迁移期一次性哈希对照留档；**不改任何 XPI 功能代码**（N4）
  - 验收：`npm ci && npm run check && npm run package` 产出 `literature-metrics/dist/literature-metrics-<version>.xpi`（`literature-metrics/package.json:8-14`）；产物仅供手动安装；XPI 源码纳入安全扫描范围（R9/R13）
  - 依赖：T1.1
- [x] T1.5 重组自检脚本：产物/manifest/可重建性校验（修正 rev1 “树 hash 自比对报 drift”错误）
  - 文件：新仓 `scripts/assemble-plugin.mjs`（改造为仓内自检或替代 `scripts/verify-bundle.mjs`）、`bundle-manifest.json`
  - 修改：**删除父仓同步模型与固定源哈希自比对**（`scripts/assemble-plugin.mjs:18-27` 的 `repoRoot=../..` 不复存在；D8：不再从父仓自动同步）；日常自检对象改为**打包产物存在性＋manifest 记录＋可重建可复现**（如 `npm ci`＋build 后产物可复现、锁文件完整、XPI `check`/`package` 通过）；迁移期基线哈希对照是一次性留档（T1.2/T1.3/T1.4），**不进入日常门禁**，避免固定源哈希误报；保留排除规则 `:30-45` 的适用语义
  - 验收：`check` 在新仓内全绿且**不引用父仓路径、不产生父仓运行依赖**；破坏锁文件/构建输入导致不可重建时校验失败；正常源码演进**不会**因固定源哈希产生误报（对照 rev1 错误验收项已移除）
  - 依赖：T1.2, T1.3
- [x] T1.6 XPI 静态路径迁移与旧用户配置文件复用验证
  - 文件：新仓 `scripts/onboard.mjs`（`ZOTERO_XPI_ONBOARDING:21-28`、`onboardingPaths:40-84`）、`runtime/src/lib/env-files.ts:12-62`、`tests/onboarding.test.mjs`
  - 修改：D8 布局下 XPI 文案/路径语义不变（`literature-metrics/` 置根后 `literature-metrics/dist/...` 相对新仓根仍正确，R10）；**保持** native＋legacy 路径读取与 `LITERATURE_ZOTERO_MCP_ENV_FILE`/`AI4S_*_FILE` 覆盖语义不变
  - 验收：新增测试证明：既有 legacy `~/.config/ai4s-literature-workbench/zotero.env` 与 native 路径配置仍被识别（`scripts/onboard.mjs:105-109`、`env-files.ts:55-62`）；XPI 提示文本指向存在的构建产物路径
  - 依赖：T1.4, T1.5

### M2 跨平台 CI 基线

- [x] T2.1 CI：Windows ＋ macOS（D9 必过）＋泄密扫描 job（rev4/D11，关联 G2）
  - 文件：新仓 `.github/workflows/workbench-ci.yml`
  - 修改：新建 workflow；矩阵 `windows-latest`＋`macos-latest`；步骤：`node --test tests/*.test.mjs`、runtime `npm ci && npm run typecheck && npm test`、fulltext/database-browser `npm ci && npm run build/test`、`npm run check`＋`npm run package`（XPI）、仓内产物/manifest 校验（T1.5）；**新增固定版本 gitleaks 扫描 job（扫全部历史＋工作区），作为必过门禁**（D11/R13；等效扫描器须用户批准）；`permissions: contents: read`（参照 `.github/workflows/molecular-modeling-workbench-ci.yml:30-32`）
  - 验收：两平台 job 全绿且为**必过门禁**；**扫描 job 零命中且阻塞合并**（命中即红、不得合并）；Node ≥20.19（`runtime/package.json:25`）；无 secret 依赖、无外网凭证请求（校验器测试用 mock fetch，`tests/onboarding.test.mjs:75-124`）
  - 依赖：M1
- [x] T2.2 CI：Linux（D9 必过）＋扫描门禁一致性
  - 文件：新仓 `.github/workflows/workbench-ci.yml`
  - 修改：追加 `ubuntu-latest` job（同 T2.1 步骤，**含同一固定版本扫描**），**同为必过门禁**（D9 已决：三平台全必过，rev1 的“尽量覆盖/见 P7”作废）
  - 验收：ubuntu job 全绿且阻塞合并；三平台扫描 job 版本与规则一致
  - 依赖：T2.1

### M3 配置核心复用层

- [x] T3.1 抽出共享配置核心模块
  - 文件：新仓 `runtime/src/lib/onboarding-core.ts`（新建）或 `scripts/onboarding-core.mjs`（新建）、`scripts/onboard.mjs:98-338`
  - 修改：把 `redactedStatus`、`academicKeyConfigured`、`verifyZoteroKey/verifyPubmedKey/verifyEasyScholarKey`、`saveZoteroKey/saveAcademicKey`、`fetchJson` 抽为可复用模块；CLI `onboard.mjs` 改为薄封装；网页向导复用同一核心（E3）；**输出格式与键名不变**；三个验证器**保持现有 key 通路**（Zotero Header／PubMed `api_key` 查询参数／EasyScholar `secretKey` 查询参数，D10）
  - 验收：`node scripts/onboard.mjs status|setup|reconfigure` 行为与现状一致（含 maskedPrompt、重试、skip、`--mark-offered`）；现有 `tests/onboarding.test.mjs` 全绿
  - 依赖：M1
- [x] T3.2 状态语义扩展（证据分级）
  - 文件：新仓 `runtime/src/lib/onboarding-core.ts`（或等价）、`scripts/onboard.mjs`、`tests/onboarding.test.mjs`
  - 修改：在脱敏状态中**只增字段**（不删改现有键，schema additive）：`build_artifacts`（`runtime/dist/index.js`、fulltext 产物存在性）、`hosts`（Claude Code/Codex/WorkBuddy 可观察线索数组，每条含 `evidence` 文本与 `level: unknown|pending_manual|verified`）、`connections`（仅实测证据可置 `verified`）；XPI 字段标注“**本轮**安装状态未核验”（不写“永不”，N8/Q3）
  - 验收：schema 测试断言：无实测输入时任何 host/connection **不可能**输出 `verified`；构建产物字段只表达“存在”，措辞含“非连通证明”；旧消费者读旧字段不受影响
  - 依赖：T3.1
- [x] T3.3 核心层测试补强（含 D10 mock 验证与脱敏测试）
  - 文件：新仓 `tests/onboarding.test.mjs`（扩展）＋新增 `tests/onboarding-core.test.mjs`
  - 修改：mock fetch 校验器用例（**断言 Zotero 走 Header、PubMed/EasyScholar 走官方查询参数通路，与 D10 一致**）、跨平台路径（win32/darwin/linux 分支 `scripts/onboard.mjs:45-84`）、legacy 复用、保存原子性/权限约定、证据分级断言、**脱敏测试**（`fetchJson` 的错误/重试/异常路径与任何日志/报告输出不含明文 key、不回显含 key 的官方请求 URL，`scripts/onboard.mjs:207-236`）
  - 验收：`node --test tests/*.test.mjs` 全绿；覆盖 T3.1/T3.2 每个新分支；HTTP 错误（4xx/5xx/429）、重试、网络异常三类路径均有“输出无 key/无含 key URL”断言
  - 依赖：T3.1, T3.2

### M4 本机网页配置向导

- [x] T4.1 管理路由挂载与模式门禁
  - 文件：新仓 `runtime/src/transports/http.ts:147-210`、`runtime/src/index.ts:27-77`、`runtime/src/server.ts`（如需注入配置）
  - 修改：在既有 Express 应用上新增管理路由前缀（默认 `/admin/onboarding`，端口沿用 `--port`/`PORT` 默认 3939——实现细节约束，见 9.4）；**OAuth 或非 loopback 模式下管理路由整体 403/404、不注册读写端点、不产生配对码**（对照 `:57-73` 的 loopback 拒绝逻辑）
  - 验收：测试证明 OAuth 模式（`opts.oauth` 存在）与非 loopback host 下管理路由不可达；loopback 无 OAuth 下可达；`/mcp`、`/healthz`、`/readyz`、`/metrics` 行为不变
  - 依赖：M3
- [x] T4.2 配对码＋短时会话授权与安全中间件（D7；rev3 扩展至 GET 读接口）
  - 文件：新仓 `runtime/src/transports/admin.ts`（新建 admin 子模块）、`runtime/scripts/credential-utils.mjs`（仅复用，不改语义）
  - 修改：
  - 配对码：启动时（或首次访问时）在**终端**显示一次性配对码（≥128-bit 随机、默认 TTL 5 分钟、**仅可兑换一次**、常数时间比较、兑换尝试限流）；兑换成功立即作废；重放/过期/超限均被拒；配对码不进 URL、不进日志；
  - 会话：兑换后下发**短时受限会话**（默认 TTL 30 分钟、HttpOnly＋SameSite=Strict cookie 或等价授权头、仅授权管理路由）；会话支持**多次操作**；服务重启即失效；**不允许每请求使用一次性码**；
  - **授权覆盖全部管理 API（GET 与 POST）**：状态读取等管理读接口必须携带有效会话，**任何未配对读写一律拒绝（401/403）**；**唯一**允许未授权提供的是不含任何状态/密钥的配对页本身（rev3 修复 rev2 仅偏写操作的高危漏项）；
  - **Host 与 Origin 检查覆盖管理 GET 与 POST**；**每一次写操作**校验 Origin/CSRF token＋Host/Origin 白名单（`127.0.0.1/localhost/[::1]`＋实际端口，参照 `runtime/src/transports/http.ts:42` LOOPBACK 集合）；管理路由全集启用 DNS rebinding 防护（现状仅 OAuth 开启，`runtime/src/index.ts:57`、`http.ts:77-90`）；管理路由**不**使用宽松 `cors()`
  - 验收：安全测试覆盖：配对码重放被拒、过期码被拒、会话过期/重启后失效、**未配对 GET 状态与任意管理读端点被拒**、未配对写操作被拒、**每一次**写操作缺 Origin/CSRF 均被拒、GET 与 POST 均受 Host/Origin 检查（伪造 Host/Origin 被拒）、rebinding 主机名被拒、配对码出现在 URL/日志则测试失败；GitHub 博客（2025-04-03）三类攻击均有对应用例
  - 依赖：T4.1
- [x] T4.3 向导 API：输入/校验/保存 3 keys（暴露边界按 R12 三通路真实断言，D10）
  - 文件：新仓 `runtime/src/transports/admin.ts`（或 `runtime/src/features/onboarding/http-api.ts` 新建）
  - 修改：POST 校验/保存端点（zotero|pubmed|easyscholar）：**浏览器→本机管理 API 中 key 仅经 POST body**（本地/浏览器 URL/地址栏禁止出现 key）；复用 `verify*Key`＋`save*Key`（`scripts/onboard.mjs:201-250,252-338` 语义：先校验后写、失败不落盘、网络失败不覆盖）；**服务端→官方校验请求保持三通路**（Zotero Header；PubMed `api_key`／EasyScholar `secretKey` 查询参数——D10 已批准例外）；响应只回脱敏状态，不回显 key；**日志/错误/响应过滤 key 与含 key 的官方请求 URL**（`runtime/src/lib/logger.ts` 确认无 body 记录、无完整请求 URL 回显）
  - 验收：测试断言：成功保存后 `redactedStatus` 显示 `private_config`/`environment` 来源；非法 key 不写文件；**本地/浏览器 URL/地址栏、响应、日志、错误、状态报告无明文 key**；mock fetch 断言出网 URL 集合**仅** Zotero/NCBI/EasyScholar 官方校验端点，且 PubMed/EasyScholar 请求 URL 含 key 查询参数属预期（D10）；断言中**不**要求“浏览器网络面板无 key”——通路 1（DevTools 可见本机 POST payload）与通路 3（服务商可能接收官方请求 URL）均为 R12/D10 已知边界；**HTTP 错误/重试/异常路径的任何输出不含 key、不含含 key URL**
  - 依赖：T3.1, T4.2
- [ ] T4.4 配置向导前端页面（含首次配对流程）（代码与自动化断言已完成，**待 V6 人工浏览器验收（Frank）后勾选**）
  - 文件：新仓 `runtime/src/public/onboarding/`（HTML/CSS/JS 静态资源，由管理路由提供服务）
  - 修改：首次打开引导用户从终端取一次性配对码并兑换会话；三凭证表单（申请链接沿用 `scripts/onboard.mjs:41-62` `PROVIDERS.apply_url`）、校验按钮、保存结果区、XPI 人工安装提示、跳转看板入口；**不回显**已存 key，只显示存在性/来源；页面提交仅 POST body，**页面/链接/地址栏永不构造含 key 的 URL**
  - 验收：人工浏览器验证（macOS＋Windows，见 V6）：配对→兑换→全流程可完成、刷新后状态正确；**页面源码、本地/浏览器 URL/地址栏与服务端响应无 key 明文**；文档与页面注明 R12 三通路边界（DevTools 可见本机提交 payload、官方校验 URL 含 key 查询参数属预期）；非 loopback 或 OAuth 模式打开返回 403/404 页面
  - 依赖：T4.3
- [x] T4.5 向导安全与行为测试（本地全绿；CI run 36430299675 三平台＋secret-scan 全绿，含 Windows npm.cmd EINVAL 修复 `20edf96`）
  - 文件：新仓 `tests/admin-http.test.mjs`（新建）
  - 修改：覆盖 T4.1–T4.4 全部安全与行为断言（含配对码/会话生命周期、**GET/POST 全部会话门禁**、每次写操作 Origin/CSRF、GET/POST Host/Origin、限流复用、`express.json` 大小限制沿用 `http.ts:203`、**HTTP 错误/重试/异常/日志从不泄密**）
  - 验收：`node --test tests/*.test.mjs` 全绿并在 CI（T2.1/T2.2）中执行
  - 依赖：T4.2, T4.3, T4.4

### M5 配置状态看板

- [x] T5.1 看板状态 API（rev3：**必须会话门禁**）
  - 文件：新仓 `runtime/src/transports/admin.ts`（GET 状态端点）
  - 修改：聚合 T3.2 脱敏状态＋构建产物存在性＋XPI 提示＋宿主线索＋连接证据；每项输出 `level` 与 `evidence`（依据文本/文件路径/探测时间）；**该 GET 端点与所有管理 API 一样必须在兑换会话后才可读取**，Host/Origin 检查覆盖此 GET；**唯一**未授权可提供的是不含状态/密钥的配对页
  - 验收：API 单测断言字段齐全且无敏感值；**未配对 GET 状态返回 401/403 且响应体不含任何状态内容**；无实测证据时 `connections` 全部为 `unknown`/`pending_manual`
  - 依赖：T3.2, T4.1, T4.2
- [x] T5.2 看板 UI
  - 文件：新仓 `runtime/src/public/onboarding/dashboard.html`（或同目录 SPA 页）
  - 修改：分区展示：凭证（3 项，存在性＋来源）、MCP 构建产物（Zotero/Fulltext，标注“产物存在≠已连接”）、XPI（人工安装步骤＋“**本轮**未核验安装状态”）、宿主线索（Claude Code/Codex/WorkBuddy）、连接状态（仅实测显示“已连接”，余为未知/待人工核验＋依据）
  - 验收：人工核对（V7）：每一行都带依据；四层级（存在/校验/产物/连接）视觉可区分；截图留档于 PR 描述
  - 依赖：T5.1
- [x] T5.3 看板语义测试
  - 文件：新仓 `tests/dashboard-semantics.test.mjs`（新建）
  - 修改：断言“无实测证据不得显示已连接”、XPI 不显示已安装、构建产物不冒充连通、**未配对不可读状态**（与 T5.1 门禁联动断言）
  - 验收：测试全绿并进入 CI 必跑集合
  - 依赖：T5.1, T5.2

### M6 文档、安装与兼容

- [x] T6.1 新仓 README／多宿主安装说明（可证实范围表述）
  - 文件：新仓 `README.md`（重写安装章节，参照 `README.md:19-47`）
  - 修改：Claude Code（`/plugin marketplace add Frankkk1912/ai4s-literature-workbench`）、Codex（`codex plugin marketplace/add`）为**实测可装**路径；opencode/Antigravity/others 沿用文档化接入路径（本轮不新增安装脚本，N11）；WorkBuddy/CodeBuddy 独立小节：按外部文档 A 说明 `.claude-plugin` 布局兼容的接入路径、URL-MCP 形式（文档 B），**统一标注“未实测/待人工核验”、不作成功承诺**（N3、R4、Q2）
  - 验收：文档评审；所有 WorkBuddy 结论带未实测标注；不出现未核实版本号；安装结论以可证实范围为限（修正 rev1 “任何 agent 都能安装”）
  - 依赖：M1
- [x] T6.2 网页向导/看板与 XPI 使用文档（含 R12 三通路真实边界，D10）
  - 文件：新仓 `docs/onboarding.md`（扩展）、`docs/local-dashboard.md`（新建）、`docs/zotero-xpi.md`（新建）
  - 修改：向导/看板访问方式（loopback URL、终端配对码→会话兑换流程、**agent 启动服务时可向用户转述配对码（D12；仅限配对码，key 永不进 chat）**、全部管理 API 需会话）、四层级语义、隐私边界**按 R12 三通路精确表述**（通路 1 浏览器→本机 POST body：DevTools 可见属固有边界；通路 2 Zotero Header；通路 3 PubMed/EasyScholar 官方 HTTPS 查询 URL 含 key 查询参数——仅服务端可见、服务商可能接收，D10 已批准）；**本地/浏览器 URL/地址栏、日志、错误、响应、报告、chat 永不含明文 key 与含 key URL**；XPI：构建命令＋Tools → Add-ons 手动安装步骤＋“**本轮**未核验安装状态”（沿用 `docs/onboarding.md:17-24`）
  - 验收：与实现行为逐条对齐；人工按文档走通一次；不出现“网络面板无 key”“key 绝不进任何 URL”类过度承诺（官方查询参数例外须写明）
  - 依赖：M4, M5
- [x] T6.3 兼容与迁移说明（父仓边界＋D8 迁移基线）
  - 文件：新仓 `docs/migration-from-parent.md`（新建）
  - 修改：写明 D8 迁移基线机制（父仓正式源码一次性哈希对照＋插件独有内容核对表，留档于迁移对照表）；父仓 `markets`/`sync` 旧版**继续可用且冻结不动**（`.claude-plugin/marketplace.json:1-19`、`.agents/plugins/marketplace.json:1-30`）；旧用户配置文件（native＋legacy 路径，`env-files.ts:12-62`）无需迁移、新仓代码继续读取；**新仓不再从父仓自动同步**；**迁移排除清单含父仓 forge 未跟踪内容（`forge/vpnsci`、`forge/zotero-style`）**；父仓→新仓切换另规划（Q4）；**不修改父仓任何文件**
  - 验收：父仓改动核验按 V10 基线 diff＋路径白名单（不要求 `git status` 空——父仓原有 untracked 如 `forge/vpnsci`、`forge/zotero-style`、既有 explore/Plan 文档属既有状态）；迁移说明经人工复核
  - 依赖：T1.6, T6.1
- [x] T6.4 新仓 CHANGELOG 初版
  - 文件：新仓 `CHANGELOG.md`
  - 修改：按 Keep a Changelog 格式（参照 `CHANGELOG.md:1-8`）记录独立仓首版内容、非目标与支持矩阵初稿
  - 验收：格式与范围和本 Plan Non-goals 一致
  - 依赖：M1, M4, M5

### M7 收尾验证与 Draft PR 转 Ready

- [ ] T7.1 全量验证执行与留痕
  - 文件：新仓 `docs/validation-2026XXXX.md`（验证记录，随 PR）
  - 修改：执行第 8 节 Validation contract 全部条目，记录命令输出摘要、CI 三平台链接、人工验证结论（含 macOS/Windows 浏览器验证、**Git 防泄漏自动扫描记录——固定版本、来源、命令、扫描范围（全部历史＋工作区，含 `literature-metrics` XPI 源码与 `database-browser-runtime`）与结论**）；**手工扫描不作为通过依据（D11）**；命中处置（审查/修复或 fresh seed 清洁重建）全程留痕
  - 验收：V1–V13 全部通过；**V9 只有自动扫描零命中才算通过**；任何豁免/降级路径不存在（D11 明确禁止）
  - 依赖：M2–M6
- [ ] T7.2 Draft PR 收尾（Draft PR 自 M1/M2 起持续更新，此处只收尾）
  - 文件：新仓 PR 描述（见第 9 节草稿）
  - 修改：汇总自 M1/M2 早期开启、随每个 milestone 持续更新的 Draft PR；补齐迁移对照表（父仓路径→新仓路径＋一次性基线哈希留档＋forge 排除清单）、剩余真实待决 Q1–Q4 状态与决策时机；确认单 PR（用户决策）
  - 验收：PR 为 Draft 起于 M1/M2、内容随 milestone 更新（非推迟到最后开立，修正 rev1 错误）；单分支 `feat/<slug>`；本 Plan 附录 B 自查随 PR 附上；M7 仅做收尾与转 Ready
  - 依赖：T7.1

## 8. Validation contract

| # | 检查项 | 方式/命令 | 预期结果 | 通过标准 |
| --- | --- | --- | --- | --- |
| V1 | onboarding 核心回归 | `node --test tests/*.test.mjs`（新仓） | 全绿；含 legacy/native 路径、校验器 mock 用例、**D10 三通路断言与脱敏测试** | 0 失败 |
| V2 | runtime 静态检查＋测试 | `cd runtime && npm ci && npm run typecheck && npm test` | 全绿 | 0 失败 |
| V3 | fulltext/database-browser 构建与测试 | 各自 `npm ci && npm run build && npm test` | 全绿（Playwright 仅装依赖不启动浏览器，除非既有测试需要） | 0 失败 |
| V4 | 仓内自检（产物/manifest/可重建性，修正 rev1 drift 表述） | `node scripts/assemble-plugin.mjs check`（或替代命令） | 打包产物存在＋manifest 完整＋`npm ci`＋build 可重建复现；破坏锁文件/构建输入时失败；正常源码演进无固定哈希误报 | 不引用父仓路径、无父仓运行依赖 |
| V5 | XPI 构建维持 | `cd literature-metrics && npm ci && npm run check && npm run package` | 产出 `dist/literature-metrics-<version>.xpi` | 产物生成、check 通过、无功能 diff |
| V6 | 网页向导人工验证（macOS＋Windows 各一次） | 浏览器打开 loopback 页面→终端配对码兑换会话→完成 3 key 的输入→校验→保存；再以 OAuth/远程模式启动确认管理路由禁用；观察浏览器 DevTools 与本地日志/错误输出 | 配对码仅一次有效、会话支持多操作、**未配对时状态/管理 API 均不可读写**；保存后 CLI `status` 一致；**本地/浏览器 URL/地址栏、响应、日志、错误、报告无明文 key、无含 key URL**；loopback POST payload 在 DevTools 可见属预期（R12 通路 1，**不**作为失败）；出网仅三条受控通路（R12），PubMed/EasyScholar 官方请求 URL 含 key 查询参数属预期（D10）；远程模式 403/404 | 人工验收签字（责任人：Frank）；不能执行时标注原因 |
| V7 | 看板语义人工核对 | 对照真实机器状态逐行核对看板 | 无实测证据的行显示未知/待人工核验＋依据；XPI 显示“本轮未核验安装状态” | 人工验收签字（责任人：Frank） |
| V8 | 安全专项 | 自动化用例＋人工：伪造 Host/Origin（**GET 与 POST 均测**）、CSRF 跨源 POST（**对每一次写操作**）、DNS rebinding 主机名、配对码重放/过期、会话过期与重启失效、**未配对 GET 状态/任意管理读端点与未配对写操作**、**HTTP 错误/重试/异常/日志脱敏路径** | 全部被拒或无泄漏；配对码单次兑换、会话多操作模型行为正确；管理 GET/POST 门禁一致 | 0 绕过、0 泄密（依据 GitHub Security Blog 2025-04-03＋D7＋D10） |
| V9 | Git 防泄漏自动化扫描门禁（rev4/D11 重写，关联 G2） | **固定版本 gitleaks（或经用户明确批准的等效扫描器）**：①**首次 push 前**扫新仓**待提交/工作区**（baseline commit 同样适用：先扫描后 push）；②**每次后续 push 前**扫**全部历史（每个 commit）＋工作区**；③Draft PR **CI 同步扫描**（必过门禁）；扫描范围含 `literature-metrics` XPI 源码与 `database-browser-runtime`；核对迁移排除清单：**父仓 forge（`forge/vpnsci`、`forge/zotero-style`）绝对未进入新仓**；确认无 `git push --mirror`/历史迁移。工具下载/安装**仅在本 Plan 获批后**进行，并记录固定版本与来源 | 自动扫描**零命中**；单一 root commit、只含快照内容 | **仅自动扫描零命中＝通过**；**任何命中＝停止推送/合并**，审查/修复或清洁重建 fresh seed 后重扫；**禁止手工扫描降级/书面豁免通过**（D11）；扫描器未安装时**不得 push** |
| V10 | 父仓本轮无代码改动（基线 diff＋白名单，修正 rev1 “git status 空”错误） | 开工前记录父仓 `git status --porcelain` 基线快照；结束时对比 diff；允许写入路径白名单＝`plugins/ai4s-literature-workbench/plans/20260928-literature-workbench-standalone-dashboard.md` | 相对基线**零新增改动**（父仓既有 untracked，如 `forge/vpnsci`、`forge/zotero-style`、既有 explore/Plan 文档，属既有状态不计） | 0 个白名单外新增/修改/删除 |
| V11 | CI 矩阵（D9＋D11） | GitHub Actions `workbench-ci.yml` | Windows＋macOS＋Linux 三平台**全绿且全部阻塞合并**；**泄密扫描 job 同为必过门禁（关联 G2）** | 与 T2.1/T2.2 一致 |
| V12 | WorkBuddy 文档核对 | 人工访问外部文档 A/B 复核（Q2） | 文档表述与当期官方资料一致或标注差异；结论均带“未实测” | 责任人：Frank；本轮允许标注“未实测”通过 |
| V13 | 现有 Claude Code / Codex 安装路径回归 | 按新仓 README 的 marketplace/清单路径做安装冒烟（清单解析＋bootstrap 干跑/`scripts/bootstrap-runtime.sh` 或 `-ps1`） | 两宿主安装路径可走通；清单与 `.mcp.json` 解析正确 | 0 失败；未新增安装脚本（N11）亦不影响 |

不可执行的验证必须在验证记录中写明原因与责任人（例如：无 WorkBuddy 实机环境时 V12 降级为文档核对）。**V9 不存在降级路径**：扫描器未安装即不得 push（D11）。

## 9. 文件级修改范围 + 风险 / 回滚 / 待决事项 + Git 策略

### 9.1 文件级修改范围

**新仓 `Frankkk1912/ai4s-literature-workbench`（全部为新建/迁入；布局已由 D8 决定）**

| 路径（新仓） | 动作 | 来源/说明 |
| --- | --- | --- |
| `.gitignore`、`.gitattributes` | 新建 | 首 commit 安全基线（R8、fresh seed） |
| `README.md`、`LICENSE`、`THIRD_PARTY_NOTICES.md` | 新建/迁入 | T1.1/T6.1 |
| `skills/literature-research/`、`skills/literature-manager/`、`skills/literature-writing/` | 迁入 | 基线：父仓正式源码（R11、T1.2）；一次性哈希对照留档 |
| `runtime/` | 迁入＋修改 | D8 布局（目录名沿用插件命名）；内容基线：父仓 `literature-zotero-mcp/`；修改 `src/transports/http.ts`、`src/index.ts`、新增 `src/transports/admin.ts`、`src/lib/onboarding-core.ts`、`src/public/onboarding/**`（T3.1/T4.x/T5.x） |
| `fulltext-runtime/` | 迁入 | 基线：父仓 `literature-fulltext-mcp/`；不改行为（T1.3） |
| `database-browser-runtime/` | 迁入 | 插件独有内容，另核对（R7/R11、T1.3）；纳入安全扫描（R9/R13） |
| `literature-metrics/`（仓根） | 迁入 | XPI 源码，仅构建维持（T1.4、N4、D8 置根）；纳入安全扫描（R9/R13） |
| `scripts/onboard.mjs` | 迁入＋修改 | 抽核心后为薄封装；三个验证器 key 通路保持现状（D10）；XPI 文案/路径语义不变（T1.6/T3.1） |
| `scripts/assemble-plugin.mjs` | 迁入＋修改 | 去父仓同步模型，改产物/manifest/可重建性自检（T1.5） |
| `scripts/bootstrap-runtime.sh/.ps1`、`scripts/verify-*.mjs`、`scripts/windows-acceptance.ps1` | 迁入＋必要路径修正 | 保持脚本语义 |
| `.claude-plugin/plugin.json`、`.codex-plugin/plugin.json`、`.mcp.json` | 迁入＋路径自洽修正 | 插件独有内容，另核对（T1.2） |
| `.claude-plugin/marketplace.json`、`.agents/plugins/marketplace.json` | **新建** | 新仓自身的 marketplace 声明（供 `/plugin marketplace add`），与父仓文件无关 |
| `tests/onboarding.test.mjs` | 迁入＋扩展 | 插件独有内容；T1.6/T3.3（含 D10 mock 与脱敏测试） |
| `tests/onboarding-core.test.mjs`、`tests/admin-http.test.mjs`、`tests/dashboard-semantics.test.mjs` | 新建 | T3.3/T4.5/T5.3 |
| `.github/workflows/workbench-ci.yml` | 新建 | T2.1/T2.2（三平台必过＋**固定版本泄密扫描 job 必过**，D11） |
| `docs/onboarding.md`、`docs/windows-acceptance.md` | 迁入＋扩展 | T6.2 |
| `docs/local-dashboard.md`、`docs/zotero-xpi.md`、`docs/migration-from-parent.md`、`docs/validation-*.md` | 新建 | T6.2/T6.3/T7.1 |
| `CHANGELOG.md` | 新建 | T6.4 |

**明确不迁入（排除清单，V9 核验）**：父仓 `.git/`、`forge/**`（尤其 `forge/vpnsci`、`forge/zotero-style` 未跟踪内容）、`.pytest_cache/`、`.ruff_cache/`、`node_modules/`、任何 `.env*`、凭证/数据目录、父仓无关文档与私有材料。

**父仓 `Frank_AI4S_Skill`（本轮明确不修改；核验方式为基线 diff＋白名单，V10）**

- 不修改：`.claude-plugin/marketplace.json`、`.agents/plugins/marketplace.json`、`sync/**`、`literature-research/`、`literature-manager/`、`literature-writing/`、`literature-zotero-mcp/`、`literature-fulltext-mcp/`、`literature-metrics/`、`.github/workflows/molecular-modeling-workbench-ci.yml`、`plugins/ai4s-literature-workbench/**`（除本文件）。
- 唯一允许写入：本 Plan 文档 `plugins/ai4s-literature-workbench/plans/20260928-literature-workbench-standalone-dashboard.md`。
- 父仓既有 untracked（`forge/vpnsci`、`forge/zotero-style`、`plans/explore-*.md`、本 Plan 文档等）属**既有状态**，以开工基线快照为准，不计为本轮改动（修正 rev1 “git status 零改动”错误）。

### 9.2 风险

| 风险 | 等级 | 触发条件 | 缓解 |
| --- | --- | --- | --- |
| 父仓私有内容/forge 未跟踪内容泄入新历史 | 高 | 盲目目录迁移、宽泛 glob 拷贝或镜像 push | fresh seed 单 root commit、首 commit `.gitignore/.gitattributes`、**禁止 mirror/历史迁移**（N6）、**排除清单显式含 forge**（9.1）、**每次 push 前固定版本自动扫描（D11/R13、V9）**、扫描范围含 XPI 源码与 `database-browser-runtime`（R9）、远端创建仅在获批后（R8） |
| 扫描器缺失/未安装导致无门禁推送 | 高（rev4 已修正） | `command -v gitleaks` 无输出（现状） | R13：**扫描器未安装即不得 push**；安装仅获批后、固定版本、来源与跨平台方案先确认；禁止手工扫描顶替 |
| 命中被“手工补救＋书面豁免”放行 | 高（rev4 明确禁止） | 走捷径心态 | D11/N12：**无豁免路径**；命中→停推送/合并→审查/修复或 fresh seed 清洁重建→重扫零命中才继续 |
| 网页管理面引入窃取面（DNS rebinding/CSRF/局域网/配对码重放/未授权读取） | 高 | 管理路由（含 GET 读接口）暴露或校验不足 | loopback-only＋**GET/POST 全会话门禁**（仅配对页未授权）＋Host/Origin 全覆盖＋配对码单次兑换＋短时受限会话＋**每次写操作** Origin/CSRF＋管理路由独立 rebinding 防护＋OAuth/远程禁用（R5、T4.2、T5.1、V8） |
| key 泄漏进本地/浏览器 URL、地址栏、日志、错误、响应、报告、chat | 高 | 实现疏忽（如错误信息回显官方请求 URL） | key 本地仅走 POST body；本地/浏览器 URL 永不含 key；日志/错误过滤 key 与**含 key 的官方请求 URL**（含 HTTP 错误/重试/异常路径）；脱敏测试断言（T3.3/T4.3、V1/V6/V8、R12） |
| “key 绝不进任何 URL”类过度承诺被 D10 例外推翻 | 中（rev3 已修正） | PubMed/EasyScholar 官方 API 以查询参数携 key（现有实现） | R12 三通路精确表述；D10 已批准例外并写入文档/测试；本地 URL 仍绝对禁止 |
| 状态看板误导（把“存在”当“已连接”） | 中 | 字段语义含糊 | 证据分级 schema＋语义测试＋人工核对（T3.2/T5.3/V7） |
| XPI 静态路径/旧配置文件迁移破坏既有用户 | 中 | 路径改写不兼容 | D8 置根后相对路径语义不变（R10）＋legacy 读取语义保留（`env-files.ts:12-62`）＋专门测试（T1.6）＋迁移文档（T6.3） |
| 固定源哈希自比对误报/父仓运行依赖残留 | 中（rev1 已修正） | 沿用“树 hash 与自己比对报 drift”模型 | 迁移基线哈希对照只做一次性留档；日常自检＝产物/manifest/可重建性（T1.5、V4） |
| 扫描器版本漂移/来源不明 | 中 | 安装浮动版本或非官方来源 | R13：固定版本＋来源确认＋跨平台方案确认，仅获批后安装；CI 使用同一固定版本 |
| WorkBuddy 文档结论不可靠（时间戳矛盾、本地加载未核实） | 中 | 按文档承诺功能 | 全部标注“未实测”、N3 非目标、Q2 人工复核（V12） |
| CI 三平台必过带来的稳定性成本（Windows Node/PowerShell 差异、macOS runner 成本） | 低-中 | 平台差异失败 | 矩阵步骤最小化、mock 网络、bootstrap 已有 Windows 验证路径（`scripts/windows-acceptance.ps1`）；D9 已决必过，失败即门禁 |
| 单 PR 体量过大难审 | 低-中 | M1–M7 全在一个 PR | 按 milestone 线性分 commit、Draft PR 早期开启持续更新、PR 描述附迁移对照表（9.5） |

### 9.3 回滚

1. 新仓是**新增资产**，父仓零改动（V10 基线 diff 验证）→ 回滚不涉及父仓数据。
2. 若实施中发现问题：直接删除 feature 分支或 reset 到首 commit；未合并前不发布任何安装指令；**任何命中未清零前不得 push**（R13）。
3. 若合并后需撤回：将新仓置为 archived/private-only 并恢复父仓安装路径为唯一入口（父仓从未改动，天然可用）。
4. 数据兼容性：网页保存沿用现有私有文件与键名（`zotero.env` 的 `ZOTERO_API_KEY`、`academic-research.json` 的 `pubmed_api_key`/`easyscholar_secret_key`，`scripts/onboard.mjs:150-171`）→ 回滚网页不丢失凭证，CLI 向导继续可读写；状态 schema 只增不删（T3.2），旧消费者无迁移负担；会话/配对码仅存内存，回滚无残留数据。
5. 明令禁止的恢复方式：任何形式的父仓历史/镜像同步来“恢复”新仓（N6；敏感历史只能 fresh seed；forge 内容永不随迁）；**以“手工扫描通过”为由恢复推送**（D11 禁止）。

### 9.4 待决事项

**已决并落为可验证约束（不再作为审批先决，rev1 的 P1/P2/P7 及实现细节项清除）：**

| rev 编号 | 决议 | 落点 |
| --- | --- | --- |
| P1（布局） | 已决（D8）：插件 `skills/runtime/fulltext-runtime/database-browser-runtime` 布局＋`literature-metrics` 置根 | R11、T1.2–T1.4 |
| P2（一次性凭证交付） | 已决（D7）：终端短时一次性配对码→短时受限会话 | R5、T4.2 |
| P3（管理路由/端口） | 实现细节约束：默认前缀 `/admin/onboarding`、端口沿用 3939 | T4.1 |
| P5（XPI 路径细则） | 已决（D8 置根后路径语义不变）＋旧配置文件继续读取 | R10、T1.6 |
| P7（Linux CI） | 已决（D9）：三平台全必过 | R9、T2.2、V11 |
| P10（schema 演进） | 实现细节约束：additive、不删改现有键；仅不兼容变更才递增 schema_version | T3.2 |
| D10（官方校验请求 key 通路） | 已批准例外：PubMed `api_key`／EasyScholar `secretKey` 查询参数、Zotero Header 保持现状；本地 URL/日志/响应/错误/报告/chat 仍绝对禁止明文 key | R12、T3.1/T3.3/T4.3/T6.2、V1/V6/V8 |
| **Q5（泄密扫描门禁）＝已决（D11）** | **固定版本自动化扫描为唯一通过标准；禁止“手工补救＋书面豁免＝通过”**；等效扫描器须用户明确批准；安装仅获批后、固定版本、确认来源与跨平台方案 | R13、N12、T1.1/T2.1/T2.2/T7.1、V9/V11、9.5 Git 策略 |

**真正产品待决（不阻塞 rev4 审批；注明需要用户批准的时机）：**

| ID | 事项 | 需用户批准的时机 | 本轮处理 |
| --- | --- | --- | --- |
| Q1（原 P6） | 新仓是否自带多 agent 安装脚本（`sync/install.*` 类） | 后续“多 agent 分发”范围规划时 | 非目标（N11）；Claude/Codex 安装路径照测（V13） |
| Q2（原 P4/P8） | WorkBuddy/CodeBuddy 实测接入验证与支持等级定稿 | 有实机环境时，或 M6 文档定稿前 | 文档统一标注“未实测”、不作成功承诺（V12） |
| Q3（原 N8 延伸） | XPI 安装状态核验、自动连接探测器扩展 | 未来看板增强范围规划时 | 本轮不做，显示“本轮未核验” |
| Q4（原 N10） | 父仓→新仓切换/停更 | 新仓稳定运行后 | 本轮不处理 |

**rev5 新增已决：**

| 编号 | 决议 | 落点 |
| --- | --- | --- |
| D12（agent 转述配对码） | 已决（2026-09-28 用户批准）：**允许** agent 把配对码告知用户（UX 门槛考虑：用户可能不熟悉终端）；**护栏**：码机制不变（5 分钟/单次/常数时间/限流）、**key 永不进 chat/agent 输出**（R12 不动）、仅限本会话刚启动的服务且不写入持久记录、码仍不进 URL/服务端日志 | 决策区 D12、T6.2 文档措辞；V6 人工验收可覆盖“agent 启动→转述码→兑换”路径 |

（rev3 的 Q5 已由 D11 决断并移入上表“已决”区；**不再存在“降级/豁免可过”选项**。）

### 9.5 Git 策略

- **分支名**：`feat/standalone-workbench-dashboard`（单分支、单 PR）。
- **bootstrap 先后（获批后严格执行；rev4 依 D11 调整推送前扫描顺序）**：
  1. 本 Plan 获批（rev4 无规划期先决动作；Q1–Q4 为未来范围决策，不阻塞）；
  2. **安装固定版本扫描器**（gitleaks，或经用户明确批准的等效工具）：仅此刻下载/安装；先确认**固定版本、来源、跨平台方案**（Windows/macOS/Linux）并留档；
  3. **创建私有空仓** `Frankkk1912/ai4s-literature-workbench`（远端创建属实施动作，**与首次 push 是不同步骤**，R8/R13）；
  4. 本地 `main` 第一个 commit：**仅** `.gitignore`/`.gitattributes`＋LICENSE/NOTICE＋占位 README（fresh seed 安全基线，单 root commit）；
  5. **首次 push 前扫描**：对 baseline commit 的**待提交/工作区内容**自动扫描（固定版本）；**零命中才允许首次 push**；命中→审查/修复或清洁重建 fresh seed→重扫；
  6. 从 `main` 切 `feat/standalone-workbench-dashboard`；
  7. **尽早开 Draft PR（M1/M2 期间）**：`main ← feat/standalone-workbench-dashboard`，随实施持续更新 PR 描述勾选；**Draft PR 的 CI 同步运行同规格扫描（必过门禁）**；
  8. M1→M7 按 milestone 顺序提交（commit message 带任务 ID），**每次 push 前扫描全部历史＋工作区，零命中才 push**；命中即停推送/合并；**每个 milestone 完成即更新 Draft PR**（迁移对照表、验证进展、待决状态）；
  9. M7 收尾：V1–V13 全过（**V9 只认自动扫描零命中**）、自查/迁移对照齐备 → Draft 转 Ready 合并；此后才把安装指令切到新仓文档。
- **Draft PR 标题**：`Draft: Standalone AI4S Literature Workbench — migration + local config wizard & status dashboard`
- **PR 描述草稿**：
  > ## Summary
  > - 将文献工作台以 fresh seed 迁入独立私有仓（D8 布局：`skills/runtime/fulltext-runtime/database-browser-runtime`＋仓根 `literature-metrics/`；父仓正式源码为迁移基线、插件独有内容另核对；无父仓历史迁移、无自动同步；forge 未跟踪内容排除），作为未来唯一维护源；父仓旧版保持兼容并冻结。
  > - 新增本机网页配置向导（CLI 完整保留）：Zotero/PubMed/EasyScholar key 的输入、在线校验与私有保存；首次访问以终端一次性配对码兑换短时受限会话；**全部管理 API（GET/POST）会话后才可读写**，每次写操作校验 Origin/CSRF。
  > - 新增本机网页配置状态看板：凭证存在性与来源、MCP 构建产物存在性（非连通证明）、XPI 人工安装提示（本轮未核验安装状态）、宿主可观察线索；仅实测证据显示“已连接”。
  > - 隐私边界（三通路精确承诺，D10）：①浏览器→本机 loopback POST body（本地/浏览器 URL/地址栏永不出现 key，用户 DevTools 可见属固有边界）；②Zotero 官方请求 Header；③PubMed/EasyScholar 官方 HTTPS 校验请求以 `api_key`/`secretKey` 查询参数携 key（仅服务端可见、服务商可能接收，已批准例外）；本地日志/错误/响应/报告/chat 不含明文 key、不回显含 key URL。
  > - 泄密扫描门禁（D11）：固定版本 gitleaks 自动扫描——首次 push 前扫待提交/工作区、每次 push 前扫全部历史＋工作区、CI 同步扫描必过；命中即停推送/合并，审查/修复或 fresh seed 清洁重建；**手工扫描不作为通过依据**。
  > - Windows/macOS/Linux 三平台 CI 全必过（D9）。
  > ## Non-goals（本轮）
  > Zotero 导入历史、远程共享网页、WorkBuddy 一键安装、XPI 功能扩展、多 agent 安装脚本（Q1）、XPI 安装状态核验（Q3）、父仓切换（Q4）。
  > ## Migration map
  > （父仓路径→新仓路径对照表＋一次性基线哈希留档＋forge 排除清单，随 T1.2–T1.4/T7.2 提交）
  > ## Validation
  > V1–V13 结果链接；macOS/Windows 人工浏览器验证截图；V9 自动扫描记录（固定版本、来源、范围、零命中结论）。
  > ## Open decisions
  > Q1–Q4 状态与决策时机。
- **PR 拆分决策**：**不拆分，单 PR**（用户访谈决策“单 feat/<slug> Draft PR”）。依据：迁移需要原子一致性（源码迁移＋自检重组＋CI 同时成立，拆分会出现中间不可验证状态）；网页向导/看板依赖同一核心抽包（T3.1）。若 diff 超出可审范围，按 milestone **分 commit** 保持可审性，而非拆 PR。
- **合并顺序**：M1→M2→M3→M4→M5→M6→M7 线性（commit 顺序即依赖顺序）；Draft PR 早期开启、持续更新、单次合并进 `main`；**合并前最后一次全历史＋工作区扫描零命中**；合并后新仓 `main` 为唯一维护源，父仓零改动（N5、V10）。

---

## 附录 A：Plan Changelog

- **rev1（2026-09-28，初始待批准）**：基于 explore 报告与代码证据初拟；范围按访谈决策锁定为“独立私有仓迁移＋本机网页配置向导＋状态看板”，导入历史明确排除；确定网页挂载于 Zotero MCP HTTP 模式、证据分级显示规则、干净快照新历史与禁 mirror 约束、Windows/macOS 必备 CI、单 `feat/<slug>` Draft PR 策略；记录待决 P1–P10。
- **rev2（2026-09-28，增量修订，待批准）**：
  - 纳入新访谈决策 **D7**（终端一次性配对码→短时受限会话、每次写操作 Origin/CSRF、key/配对码不进 URL）、**D8**（插件布局＋`literature-metrics` 置根、父仓正式源码为迁移基线＋插件独有内容另核对、不再从父仓自动同步）、**D9**（三平台 CI 全必过）。
  - 修复 rev1 错误/矛盾：(a) 撤回“网络面板无 key”承诺，改为 R12 精确暴露边界（官方校验端点＋浏览器→本机 loopback POST；响应/URL/日志/报告/chat 无明文；DevTools/浏览器内存可见属固有边界，测试按真实断言）；(b) 明确配对码单次兑换成会话、会话多操作、过期/重启失效、不允许每请求一次性码；(c) 撤销 T1.5“树 hash 自比对报 drift”模型，迁移基线哈希对照限一次性留档，日常校验改为产物/manifest/可重建性，无父仓运行依赖；(d) Draft PR 改为 M1/M2 早期开启并随 milestone 持续更新，M7 仅收尾；(e) V10 改为基线 diff＋路径白名单（父仓既有 untracked 不计）；(f) Goal 改为文档接入与可证实范围，WorkBuddy 不作成功承诺；(g) 网页明确定位为 CLI 之外的 UX 入口（CLI 保留），XPI 改述为“本轮未核验”而非“永不”。
  - 清除已决待决：P1/P2/P7 已决，P3/P5/P10 落为可验证约束；真正产品待决收敛为 Q1–Q4 并注明批准时机；新增 N11（本轮不新增安装脚本）。
  - 安全扫描范围扩展至 XPI 源码与 `database-browser-runtime`；敏感历史明确 fresh seed-only；任务 ID、M1–M7、V 序号与全部 checkbox 状态（均未完成）保留。
- **rev3（2026-09-28，增量修订，待批准）**：
  - 纳入新批准决策 **D10**：PubMed `verifyPubmedKey`（`scripts/onboard.mjs:259-275`，`api_key` 查询参数）与 EasyScholar `verifyEasyScholarKey`（`:277-292`，`secretKey` 查询参数）的服务端→官方 HTTPS 校验请求允许以查询参数携 Key（保持现状）；Zotero 走 Header（`:238-257`）。本地/浏览器 URL/地址栏、管理服务日志/响应/错误/报告/chat 绝不含明文 Key，配 mock 验证与脱敏测试。
  - 系统修正 rev2 与 D10 冲突的绝对承诺：删除“key/配对码均不进 URL”“只经两条路径”类表述，改为 **R12 三通路精确边界**（浏览器→loopback POST body／Zotero Header／PubMed·EasyScholar 官方查询 URL 例外）；配对码仍绝对不进 URL/日志；官方请求 URL 不得在本地日志/错误中回显；安全测试覆盖 HTTP 错误/重试/异常/日志从不泄密。
  - 修复 rev2 高危漏项：**管理 GET（T5.1 状态读取）与全部管理 API 必须兑换会话后才可读写**，未配对读写一律拒绝，唯一未授权可提供的是不含状态/密钥的配对页；Host/Origin 检查覆盖管理 GET 与 POST；同步更新 R5/T4.2/T4.5/T5.1/T5.3/V8。
  - 移除 Goal 中无验收的“10 分钟内”时限表述。
  - V9 强化：gitleaks 可用时扫描新仓**全部历史＋待提交/工作区文件**；不可用时手工补救并显式标注降级，**不把手工扫描等同通过**（新增 Q5 记录替代门禁决策时机）；父仓 forge 未跟踪内容（`forge/vpnsci`、`forge/zotero-style`）列入排除清单，绝对不入新仓。
  - 任务 ID、M1–M7、V 序号与全部 checkbox 状态（均未完成）保留；rev1/rev2 Changelog 原文保留。
- **rev4（2026-09-28，增量修订，待批准）**：
  - 纳入新批准决策 **D11**（访谈确认）：本机 `command -v gitleaks` **无输出**（扫描器未安装）；**仅在本 Plan 获批后的实施中**安装/启用**固定版本** gitleaks（或等效自动化扫描器——换用等效工具须用户**明确批准**），安装前确认固定版本来源与跨平台方案；**本次规划不安装任何工具**。
  - 推送门禁硬化：**首次 push 前**自动扫描待提交/工作区（baseline commit 先扫描后 push）；**每次后续 push 前**扫描全部历史＋工作区；**任何命中停止推送/合并**，审查/修复或 fresh seed 清洁重建；Draft PR CI 同步扫描并为必过门禁（关联 G2）。私有远端仓**创建**与首次 **push** 分步骤：先建私有空仓→本地扫描→再 push；父仓 forge 任何内容不入新仓。
  - **Q5 标记已决**：V9 重写为“仅固定版本自动扫描零命中＝通过”，**禁止“手工补救＋书面豁免＝通过”**；rev3 的“手工扫描降级记录”路径删除（N12 非目标）；同步更新 R13（新增）、G2、M1/M2、T1.1/T2.1/T2.2/T7.1、V9/V11、9.2 风险、9.3 回滚、9.4 已决表、9.5 Git 策略步骤与 PR 草稿。
  - 任务 ID、M1–M7、V 序号与全部 checkbox 状态（均未完成）保留；rev1–rev3 Changelog 原文保留。
- **rev5（2026-09-28，增量修订，已批准）**：
  - 纳入新批准决策 **D12**（用户批准）：**允许 agent 向用户转述配对码**（UX：用户可能不熟悉终端）；护栏四条：①码机制不变（≥128-bit/5 分钟 TTL/单次兑换/常数时间比较/限流）；②**key 永不进 chat/agent 输出**（R12 三通路边界不动）；③仅限本会话刚启动的服务、不写入持久记录；④码仍绝不进 URL/服务端日志；stderr 终端显示保留为并行信道。
  - 落点：决策区 D12、9.4 已决表新增 rev5 行、T6.2 文档措辞；开放产品待决仍为 Q1–Q4。
  - 与 rev1–rev4 无矛盾：D7「终端显示」未被改写，D12 仅新增并行信道；R12/R5/V8 各项不变。

## 附录 B：完成前自查（rev4，含前后修订一致性核对）

- 9 段结构齐全且顺序固定：**通过**（Goal → Requirements → Non-goals → Research summary → Gap analysis → Milestone 表 → 分 milestone To-do → Validation contract → 文件级修改范围/风险/回滚/待决/Git 策略）。
- Milestone 数量 ≤10（目标 ≤7）：**通过（7 个）**。
- 每个功能缺口至少映射一个 To-do 任务 ID：**无孤立缺口**
  - G1→T1.2/T1.3/T1.5/T6.3；G2→T1.1/T7.1/T2.1/T2.2（rev4：CI 扫描门禁）；G3→T6.1；G4→T3.2/T5.1/T5.2/T5.3；G5→T3.1/T4.3/T4.4；G6→T4.1/T4.2/T4.5/T5.1；G7→T2.1/T2.2；G8→T1.4/T1.6/T6.2/T6.3。
  - 反向核对（无孤儿任务）：T1.1→G2；T1.2/T1.3/T1.5→G1；T1.4/T1.6→G8；T2.1/T2.2→G7＋G2（扫描门禁）；T3.1→G5；T3.2→G4；T3.3→横切支撑 G4/G5＋D10 脱敏；T4.1/T4.2/T4.5→G6；T4.3/T4.4→G5；T5.1→G4/G6；T5.2/T5.3→G4；T6.1→G3；T6.2→G8；T6.3→G8/G1；T6.4→横切（支撑全部缺口的发布记录）；T7.1/T7.2→横切验收（支撑 G2 防泄漏核验与全部缺口的验证留痕）。
- 每个任务都有文件/修改/验收/依赖：**通过**。
- 任务 ID／Milestone ID／V 序号／Changelog 历史（rev1–rev3 原文保留）／未完成 checkbox 状态保留：**通过**（rev1–rev3 全部任务仍为 `[ ]`）。
- **rev4 与 rev1–rev3 前后矛盾清查：通过**
  - D11 与 rev3 “gitleaks 可用时…手工补救降级”路径冲突：已删除降级路径，V9 改为“仅固定版本自动扫描零命中＝通过；扫描器未安装即不得 push”（N12 明确禁止豁免）；
  - Q5 从“待决”改判“已决（D11）”：9.4 已决表新增 Q5 行，开放待决仅余 Q1–Q4；
  - “私有仓创建＝push”混淆：9.5 步骤已拆分为“创建私有空仓（步骤 3）→baseline commit（4）→扫描（5）→首次 push（5）”，与 T1.1 验收一致；
  - CI 扫描门禁与 G2 关联：G2 补齐任务加入 T2.1/T2.2，V11/M2 同步标注，自查反向映射更新；
  - baseline commit 扫描时点：T1.1/9.5/V9 三处一致（先扫描后首次 push）；
  - 与既有承诺无回归：R12 三通路、R5 全 API 会话门禁、D8/D9/D10 各项在 rev4 中未被改写，仅扫描门禁强化。
- 真正产品待决收敛为 Q1–Q4 且注明批准时机；Q5 已决并禁止降级：**通过**。
- 输出仅写入本 Plan 文档（同一路径就地更新），未创建或覆盖任何代码/配置/测试/脚本，**未下载/安装任何工具**：**通过**。
