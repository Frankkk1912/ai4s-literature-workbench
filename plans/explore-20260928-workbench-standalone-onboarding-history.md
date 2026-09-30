# Explore: workbench 独立使用、配置可视化与 Zotero 导入历史

原始需求（原样保留）：我想把当前的 workbench 独立出来，便于给各个 agent 使用，如国产的 workbuddy 等，现在的配置过程不够直观，用户不知道哪些配了哪些没有配，你觉得该怎么做，做一个网页显示配置进度怎么样，或者做一个网页与 zotero 联动的，便于记录每次用户导入的哪些文献？让我们一步一步来

范围：只读代码库调研，未验证 WorkBuddy 的外部接入规范，未决定产品范围或实施顺序。以下路径均相对于 `plugins/ai4s-literature-workbench/`；当前工作区属于上级仓库 `Frank_AI4S_Skill`。报告日期：2026-09-28。

## 1. Implementation map

- **源码与分发**：本目录已携带 `skills/`、`runtime/`、`fulltext-runtime/` 和 Claude/Codex 清单；但 `scripts/assemble-plugin.mjs:L18-L27,L135-L173` 从上级仓库的五个源目录同步、校验 bundle，`bundle-manifest.json:L1-L28` 记录 `source_root: ../..`。`README.md:L19-L47` 还记载了 opencode / Antigravity / others 的安装途径及 Node/bootstrap。故“完全只支持 Claude/Codex”不成立；**源码所有权/组装流程依赖上级仓库**才是拆分时需解决的问题。是否独立仓库还是独立可安装包尚未定义。
- **Agent 接入**：`.codex-plugin/plugin.json:L1-L30` 声明技能目录和 MCP；`.claude-plugin/plugin.json:L1-L18` 提供 Claude 清单；`.mcp.json:L1-L17` 启动 Zotero 与 Fulltext 的 stdio MCP。`runtime/src/index.ts:L27-L77` 另有 HTTP 模式；`runtime/src/transports/http.ts:L57-L73,L147-L210` 已承载 `/mcp` 和健康接口，非 loopback 绑定默认禁止无 OAuth。WorkBuddy 的插件、skill、MCP 传输/路径/权限能力尚未通过产品资料或实机验证。
- **入门配置**：`scripts/onboard.mjs:L21-L84` 定义 Zotero / PubMed / EasyScholar 和跨平台路径；`L98-L137` 的 `redactedStatus` 报告**本地凭证存在性及来源**、初次引导标记和 XPI 安装提醒；`L201-L250` 提供独立联网验证器，`L252-L338` 用 TTY 掩码输入、验证后写私有文件；`L367-L413` 提供 status/setup/reconfigure 并输出脱敏 JSON。`docs/onboarding.md:L1-L60` 明确凭证可选、Zotero Desktop XPI 必须手动安装。现有状态**不等同于实时连通/读写权限或 XPI 已安装检测**。
- **检索→入库**：技能检索生成 evidence/report，MCP `zotero_sync_literature_project` 经 `runtime/src/features/project-sync/sync.ts:L215-L385` 选择 evidence、查匹配、组装哈希 plan、dry-run、apply、更新 Zotero collection/report note 和本地同步 state。`runtime/src/features/project-sync/state.ts:L5-L53` 在 dataDir 下按 library/project 保存绑定状态及按 plan hash 命名的 receipt；`runtime/src/lib/paths.ts:L5-L23` 定义与凭证目录**不同**的数据目录。
- **另一条导入路径**：`runtime/src/tools/apply-import-plan.ts:L11-L37` 接受用户指定 plan_path、receipt_path、批准哈希后执行；`runtime/src/features/import-plan/apply.ts:L292-L420,L430-L533` 中途及末尾持久化收据、支持局部恢复。`runtime/src/features/import-plan/contract.ts:L5-L69` 显示 receipt 含时间、证据 ID、结果、Zotero key、汇总，但不直接含完整文献标题/DOI；要展示“每次导入哪些文献”需关联原 plan/evidence 或查询 Zotero，且用户自选 receipt 不一定落入 project-sync 目录。Zotero 云端库和本地收据不是同一个历史索引。

## 2. Key files and symbols

| 路径与定位 | 符号/配置节点 | 与需求关系 |
| --- | --- | --- |
| `scripts/assemble-plugin.mjs:L18-L27,L135-L173` | `repoRoot`, `bundles`, `sync/check` | 上级仓库作为 source of truth 与校验入口 |
| `bundle-manifest.json:L1-L28` | `source_root`, `bundles` | 当前打包快照与源依赖 |
| `README.md:L19-L47,L68-L99` | Installation / First-time setup | 已有多 Agent 安装描述、Node bootstrap 与私有凭证流程 |
| `.codex-plugin/plugin.json:L1-L30`; `.claude-plugin/plugin.json:L1-L18`; `.mcp.json:L1-L17` | 插件清单、`mcpServers` | 现有宿主适配及 stdio 启动契约 |
| `runtime/src/server.ts:L35-L61` | `WORKBENCH_TOOL_NAMES`, `selectActiveTools` | Workbench Profile 的工具可见性 |
| `runtime/src/index.ts:L27-L77`; `runtime/src/transports/http.ts:L57-L73,L147-L210` | `main`, `startHttp` | HTTP/MCP 模式及现有 Express 路由、安全边界 |
| `scripts/onboard.mjs:L40-L84,L98-L137,L201-L250,L367-L413` | `onboardingPaths`, `redactedStatus`, `verify*Key`, `main` | 本地配置检测、网络校验与 CLI 入口 |
| `runtime/scripts/credential-utils.mjs:L12-L28,L62-L118` | `writePrivateFile`, `maskedPrompt` | 原子私有文件与终端输入安全约定 |
| `runtime/src/lib/env-files.ts:L12-L62`; `runtime/src/lib/paths.ts:L5-L23` | env 文件级联、`defaultDataDir` | 凭证路径与收据数据路径的分离 |
| `runtime/src/features/project-sync/sync.ts:L215-L385`; `runtime/src/features/project-sync/state.ts:L5-L53` | `syncLiteratureProject`, `projectReceiptPath` | 自动同步与按项目收据 |
| `runtime/src/tools/apply-import-plan.ts:L11-L37`; `runtime/src/features/import-plan/contract.ts:L5-L69`; `runtime/src/features/import-plan/apply.ts:L208-L215,L292-L420` | `applyImportPlanTool`, `ImportReceipt`, `persistReceipt` | 手动批准导入与历史的数据/来源限制 |
| `tests/onboarding.test.mjs:L1-L140` | Node `test(...)` | 配置检测脱敏、跨平台路径、mock 验证测试 |

## 3. Existing patterns and conventions

- 分发快照来自上级仓库，`assemble-plugin` 同步后校验哈希，bootstrap 从锁文件安装构建：`scripts/assemble-plugin.mjs:L18-L27,L135-L173`；`README.md:L35-L58`。不要把本插件目录当作既定的唯一源码归属。
- Node ≥20.19、ESM/TypeScript、Express 5 与 MCP SDK、Zod schema、Vitest：`runtime/package.json:L1-L8,L25-L74`；插件 onboarding 用 `node:test` 和 mock fetch：`tests/onboarding.test.mjs:L1-L6,L75-L124`。技能脚本走 Python CLI：`skills/literature-manager/scripts/zotero_literature_manager.py:L1-L37`。
- 配置只返回脱敏的 configured/source；凭证绝不进入 Agent chat、命令参数与公开产物：`scripts/onboard.mjs:L98-L137`；`docs/onboarding.md:L27-L58`；私有目录/文件权限及原子写入：`runtime/scripts/credential-utils.mjs:L12-L28`。`redactedStatus` 不作实时能力核验，XPI 字段是静态提醒。
- Zotero Desktop Local API 只读；入库写走 Web API、显式 plan hash 审批，receipt 支持 partial/blocked/complete 与逐项 outcome：`runtime/src/registry/registry.ts:L69-L95`；`runtime/src/tools/apply-import-plan.ts:L11-L37`；`runtime/src/features/import-plan/contract.ts:L50-L69`；`runtime/src/features/import-plan/apply.ts:L292-L311`。自动 project sync 保留预检/大批量确认：`runtime/src/features/project-sync/sync.ts:L323-L367`。
- HTTP 目前有 `/mcp`、`/healthz`、`/readyz`、可选 `/metrics`，默认无 OAuth 仅 loopback：`runtime/src/transports/http.ts:L57-L73,L164-L210`。现有 MCP CORS/鉴权不能直接证明新增配置 REST API 或浏览器表单安全，需单独设计 origin、CSRF、DNS rebinding 与远程访问边界。

## 4. Candidate implementation paths

以下仅比较可能路径，不选择、不承诺改动。

1. **保留上游源码归属，改善可独立安装的分发包**：依托 `scripts/assemble-plugin.mjs:L18-L27,L135-L173`、现有 bundle 和 `.mcp.json:L1-L17`；影响组装/发布/适配文档而不是迁移全部技能源码。代价相对低，但须定义如何从上级仓库构建、升级、验收以及 WorkBuddy 实际协议；适合“独立供多 Agent 使用”重于“另立 Git 源码仓库”时。配置页面、历史查询可在同一分发物后续考虑；维护单一 source of truth，但发布链条仍耦合父仓库。
2. **迁移源码所有权到真正独立仓库**：依托当前 `skills/`、`runtime/`、`fulltext-runtime/` 及两种插件清单（`README.md:L1-L25`、`scripts/assemble-plugin.mjs:L18-L27`）；需明确五组源组件与外部 Zotero XPI 的归属、父仓库兼容/同步/发布关系。迁移、CI、测试和回滚成本高，既有用户安装路径会变；适合要求独立版本、独立开发和维护时，不能仅“复制目录”而留下双重源码。
3. **本地只读 dashboard 作为可选体验层**：依托 `scripts/onboard.mjs:L98-L137` 的脱敏状态、`runtime/src/transports/http.ts:L164-L210` 的服务能力、`runtime/src/features/project-sync/state.ts:L5-L53` 与 `ImportReceipt` 契约；可选择在既有 Express 旁挂只读界面或按需单独进程，先区分“已配置/已验证/可用/人工 XPI 未核验”，只覆盖能证明来源的历史。前端和安全测试有中等成本；只读时无需改变现有写入审批，但不同路径的收据关联、标题/DOI、权限隔离和本机/远程模式仍是维护成本。适合配置可见性优先、并愿接受历史覆盖边界时。若允许网页保存 API Key，则是**另一个安全等级的方案**，不能视为既有 MCP HTTP 的简单静态页面扩展。

## 5. Preliminary gap analysis

- **独立性定义未定**：当前是有自包含分发快照、但由父仓库组装的插件；并非“没有现成包”，缺的是独立源码所有权或独立发行契约的明确选择（`scripts/assemble-plugin.mjs:L18-L27,L135-L173`；`README.md:L19-L47`）。
- **WorkBuddy 可用性证据不足**：有 stdio 与 HTTP MCP、多个 Agent 的安装说明；尚未找到 WorkBuddy 专用清单或实机验证，未知 skill 加载/环境配置/授权格式（`.mcp.json:L1-L17`；`runtime/src/index.ts:L27-L77`；`README.md:L19-L27`）。
- **配置“进度”的语义缺口**：现有脱敏状态只判定凭证存在，不代表验证通过；XPI 恒报人工安装提醒，不可宣称已检测是否安装；缺少明确的 Agent MCP 连接/运行时 bootstrap 状态定义（`scripts/onboard.mjs:L21-L38,L98-L137`；`tests/onboarding.test.mjs:L27-L74`）。
- **历史视图缺口**：自动同步的收据按库/项目存在，手动导入收据可任意路径，receipt 没有标题/DOI；只扫描 `project-sync` 会漏掉手动批次和 Agent 之外 Zotero 导入，后者是否入范围未知（`runtime/src/features/project-sync/state.ts:L25-L33`；`runtime/src/tools/apply-import-plan.ts:L19-L27`；`runtime/src/features/import-plan/contract.ts:L50-L69`）。
- **网页安全与操作边界缺口**：Express 当前是 MCP/ops 服务，不存在 onboarding/history REST 端点；默认 loopback 不等于可以安全开放网页写凭证或暴露文献元数据（`runtime/src/transports/http.ts:L57-L73,L164-L210`；`docs/onboarding.md:L27-L58`）。

## 6. Open questions

进入 `/feature-plan` 前请确认：

1. “独立”指**单独 Git 仓库并转移源码主权**，还是**保持单仓 source of truth、独立可安装/发布**？现有用户与 XPI 的兼容范围是什么？
2. 第一轮最重要的是多 Agent 接入、配置状态可视化，还是导入历史？一次只做其中哪一块、哪些明确不做？
3. WorkBuddy 的目标版本/平台以及它支持的 skill、stdio/HTTP MCP 接入形式是什么？可否提供已知配置示例供验证？
4. 配置页只读显示状态和操作指引，还是要输入/保存 API Key？“配置完成”应以凭证存在、在线验证、MCP 连接、XPI 安装的哪几个条件衡量？
5. 导入历史要只覆盖本 workbench 自动同步，还是也包含经批准的手动 plan，以及**用户直接在 Zotero Desktop 导入**的项目？是否必须展示标题/DOI、失败批次和跳转 Zotero？
6. 网页仅本机按需打开，还是长期运行/远程共享？可接受的隐私、鉴权与数据留存边界是什么？

## 7. Persisted report

本报告路径：`plugins/ai4s-literature-workbench/plans/explore-20260928-workbench-standalone-onboarding-history.md`（相对于上级仓库）；可直接作为 `/feature-plan` 的输入。此阶段没有正式 Plan，也未修改项目代码、配置、测试或脚本。
