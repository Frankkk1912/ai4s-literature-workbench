<h1 align="center">📚 AI4S Literature Workbench</h1>

<p align="center">
  <strong>基于 Zotero 和 Agent 驱动的一站式可溯源文献管理工作台</strong><br>
  <em>写综述和开题报告的时候，不用再费劲找引文出处</em>
</p>

<p align="center">
  🔎 自然语言检索 · 📚 Zotero 文献工作台 · ✍️ 可溯源引文插入
</p>
<p align="center">
  <a href="https://github.com/Frankkk1912/ai4s-literature-workbench/releases">📥 发布页</a> ·
  <a href="README.md">🇬🇧 English</a> ·
  <a href="#-快速开始">🚀 快速开始</a> ·
  <a href="docs/getting-started_CN.md">📖 入门</a>
</p>

---

## 🤔 为什么要做这个？

> 🎓 还有一周就要提交开题报告，现在你在 PubMed 里翻页，一篇篇查影响因子和分区后再手动导入 Zotero，打上一堆混乱的标签。综述写到某一句，不知道引用哪一篇，哪句话出自哪篇也找不到了。
>
> **要是只跟 Agent 说一句话，就能自动得到一份高质量文献清单、自动检索文献分区 IF、自动加入Zotero 打上tag分类，还有一份已经插好文献的初稿呢？**

这是一套直接接入现有 AI Agent 的文献工作流工具。你可以像平时讨论课题一样用自然语言下达指令：它会自动在多个数据库进行联合检索和去重，生成可复核的检索记录，并将筛选后的文献与记录同步到 Zotero 的同一个分类中；到了写作阶段，每句论述都附带溯源标记，你只需要专注于阅读和把关。

### 😩 传统流程的痛点

| 环节 | 手动处理的日常 |
| --- | --- |
| 🔁 跨库检索 | 在 PubMed 里逐页翻找，换一个数据库还得重来一遍 |
| 📊 期刊指标 | 影响因子、JCR、中科院分区需要逐篇手动查询核对 |
| 📥 文献入库 | 逐条导入 Zotero，重复条目往往整理到一半才发现 |
| 📝 综述写作 | 写到某句论断时，想不起对应哪篇文献，出处难以回溯 |

### 💡 工作台的三步闭环

| 阶段 | 输出结果 |
| --- | --- |
| 🔎 **联合检索与排序** | 同步检索 PubMed 和 OpenAlex，按 DOI / PMID 自动去重并留存完整检索记录，通过 Priority 1–3 标出优先阅读顺序 |
| 📚 **Zotero 同步入库** | 按 DOI / PMID 自动匹配复用库内已有条目，避免重复；检索记录与入选文献归档至同一 Zotero 分类 |
| ✍️ **可溯源起草** | 初稿句末标注 `[EV:n]` 指向具体证据；仅基于摘要或存在匹配存疑的文献，自动单独列出待核查清单 |

<!-- GIF: 一句话检索到 Zotero 分类 -->
<!-- GIF: Zotero 里的 IF、JCR、中科院分区列和 Priority 星星 -->
<!-- GIF: 综述段落里的 [EV:n]，旁边是待查参考文献 -->

## ⚔️ 方案对比

| | AI4S Literature Workbench | 纯手动整理 | 直接问通用聊天机器人 |
| --- | --- | --- | --- |
| 📄 **文献来源** | 实时检索 PubMed 与 OpenAlex，按 DOI / PMID 合并去重 | 人工在各数据库网页逐页筛选 | 依赖模型记忆生成，容易出现幻觉和虚构文献 |
| 📝 **检索记录** | 自动生成 `report.md`，记录研究问题、日期、数据库、原始检索式及命中/去重/入选数量 | 依赖个人笔记，难以保持格式统一与完整 | 对话结束后不留存可复现的课题检索记录 |
| 📚 **Zotero 联动** | 零配置读取本地 Zotero 库；配置 Zotero API Key 或在 Zotero 10+ 授权后即可直接写入 | 手动逐条导入与分类 | 无法读取或写入你的本地 Zotero 文献库 |
| 📊 **IF 与分区** | 内置 2025 年 JCR/IF 表按 ISSN 自动匹配；中科院分区支持通过 EasyScholar 或自定义指标表写入条目 | 逐篇手动查询 | 回答中的影响因子往往来源不明或版本过时，难以核对 |
| ✍️ **综述起草** | 严格基于已保存的证据起草，使用 `[EV:n]` 回溯原文；仅有摘要或存疑条目自动归入待核查表 | 全靠个人记忆和手动翻找笔记 | 未接入你本地筛选好的证据集，引文难以验证 |

> 面向组会与开题前最典型的工作流：课题方向已经明确，你需要一份可复核的检索记录、一个结构清晰的 Zotero 分类，以及一段每句话都能对上原文的综述初稿。

## 🧰 核心模块与机制

工作台由三个核心 Skill 分工协作：`literature-research` 负责检索与排序，`literature-manager` 负责 Zotero 入库与整理，`literature-writing` 负责基于证据起草；首次运行通过 `ai4s-setup` 检查环境与可用能力。底层共封装了 24 个 Zotero MCP 工具（只读模式下开放 12 个不修改文献库的工具，其中 2 个分别用于打开本地配置页和下载检索辅助程序），直接通过自然语言即可调用。

### 🔎 文献检索与排序

默认并行检索 PubMed 和 OpenAlex。OpenAlex 免费开放且无需密钥；若本机已配置联系邮箱，请求会自动走 OpenAlex polite pool。

去重优先按 DOI 合并，缺失 DOI 时按 PMID 合并。脚本会自动生成 `report.md` 作为检索日志，完整记录研究问题、日期、数据库、原始检索式、返回上限、命中/去重后篇数及入选文献列表；详细打分依据保存在 `ranked_all.json`。检索阶段只负责产出证据，正文撰写统一交由 `literature-writing` 完成。

<p align="center"><img src="docs/assets/search-results.png" width="480" alt="示例检索记录：研究问题、PubMed 检索式、命中数量和入选文献"></p>

*一份示例 PubMed 检索记录（`report.md`）：研究问题、原始检索式、命中数量与入选文献列表。*

相关性排序采用确定性规则计算，综合题名、摘要、MeSH 词及发表年份等维度，每一项得分均有据可查并记录在 `ranked_all.json`。**Priority（1–3）** 用于标示当前课题的阅读优先级：入选文献默认为 1；Agent 在复核相关性时，会将值得精读的文献（关键机制、方法学、重要综述或相反结论）标为 2，必读核心文献标为 3，并附带简短原因码。期刊影响因子独立显示在指标列中，不与阅读优先级混用。Priority 星级支持后续手动调整，且在下次同步导入时会保留已有标记。

期刊指标默认使用仓库内置、经核验的 2025 年 JCR/IF 表，按 ISSN 匹配并作为元数据附着在条目上，不影响原始检索召回结果。中科院分区数据需通过 EasyScholar 查询，或导入你自行提供的指标表。

其他数据源支持：arXiv 仅在你明确要求时纳入检索；Web of Science 支持导入你自行下载的官方 CSV / TSV；校园网订阅库仍保留在你本机浏览器中访问。开放获取 PDF 的拉取作为独立步骤执行，在尚未获取全文前，对应证据严格按「仅摘要」处理。

### 📚 Zotero 同步与入库

读取本机 Zotero 文献库无需任何密钥：打开 Zotero，进入 **设置 → 高级**，勾选 **允许这台电脑上的其他应用与 Zotero 通信** 即可。

写入 Zotero 提供两种方式：配置 Zotero API Key，或运行 Zotero 10 及以上版本并在本地授权弹窗中选择「始终允许」（更早版本仅支持本地只读）。*注：无密钥本地写入目前仅对照官方协议文档完成了 Mock 测试，尚未在运行中的 Zotero 桌面端完成实机验证。*

同步过程基于 DOI 和 PMID 精确匹配：库内已有条目会直接复用，避免重复建项，并将本次检索记录作为笔记存入目标分类。仅通过标题与年份模糊匹配的条目，会先交由你确认，再决定是否合并为同一篇。

### 🏷️ 标签规范与清理

`zotero_tag_manager` 用于清理重复标签和废弃标签，严格遵循 `scan` → `plan` → `apply` 三步流程：`plan` 阶段会生成一份带校验哈希（plan hash）的变更计划，此时不会改动 Zotero 文献库或受控词表；`apply` 默认先执行 dry-run，只有在你明确确认对应的 plan hash 后才会真正写入。

合并标签时，被归并的旧标签会保留为目标标签的别名，条目变更与词表更新会记录在同一份回执中。未被纳入计划的原有标签保持不变；`Priority`、`Article Type`、`JCR`、`CAS` 等结构化标签，在未经你明确指令授权前不会被修改。

### ✍️ 可溯源写作

写作流程强制依赖已生成的 `ranked_all.json` 与检索记录。若目录中缺少这两份文件，Skill 会中止起草并提示先执行文献检索，确保成稿内容完全来源于已存证的文献集。

正文采用 `[EV:n]` 标记引用来源（可选附带 PMID 或 DOI），并在初稿旁同步生成参考文献核对表。证据强度偏弱、仅有摘要支撑或存在引用存疑的条目，会自动隔离并写入 `references_to_check.md` 供人工复核。

一句式中文摘要基于题名与摘要生成，仅在你明确要求时触发，用于快速浏览文献库；撰写实质性学术结论时，应回溯排序证据或已获取的全文。

### 📊 Zotero 期刊指标列插件

`literature-metrics` 是独立安装于 Zotero 桌面端的配套插件。下载 [`literature-metrics.xpi`](https://github.com/Frankkk1912/ai4s-literature-workbench/releases/latest/download/literature-metrics.xpi) 后，在 Zotero 中依次点击 **工具 → 插件 → 右上角齿轮 → 从文件安装插件**，安装完成后重启即可。更新方式与详细说明见 `docs/zotero-xpi.md`。

插件会在条目列表中新增带颜色标记的 **IF / JCR / 中科院分区** 列、**Priority** 星级列（对应检索时的 1–3 级），以及 **Article Type**、**Agent Tags** 和一句话 **AI Summary** 列。点击星级、按快捷键 `1` / `2` / `3` 或右键 **Set Priority**，是该插件唯一会写入条目的操作（仅修改 Priority 相关标签）。

列中展示的指标数据均读取自条目的 `Extra` 字段。安装完插件后，让 Agent 对目标分类执行一次同步或刷新，数据便会自动显示。指标查询由后台 MCP 工具负责，相关 API 密钥仅保存在本地设置页中。

<p align="center"><img src="docs/assets/metrics-columns.gif" width="720" alt="Zotero 中的 literature-metrics 插件：IF、JCR、中科院分区列、Priority 星级及条目详情"></p>

*在 Zotero 中按影响因子和 Priority 排序，并在选中条目时更新右侧详情面板。*

## 🗣️ 使用示例

### 1. 检索并筛选课题文献
```text
帮我查 GLP-1 受体激动剂和心血管结局，PubMed 和 OpenAlex 都要，排个序，检索记录留下来。
```

### 2. 同步至 Zotero 分类
```text
把这次的检索记录和选中的论文放进 Zotero，分类名叫 "GLP-1 CVD Project"。库里已经有的按 DOI 或 PMID 对上。
```

### 3. 基于证据起草综述段落
```text
用我存好的排序结果和检索记录写一段中文综述。句子后面标 [EV:n]，对不上的参考文献单独列出来。
```

## 🚀 快速开始

### 1. 安装（按客户端选择）

**Claude 桌面版 Code 标签**：任选一种方式安装，然后执行 `/reload-plugins` 或新开会话。

- **上传发布包**：从 [Latest Release](https://github.com/Frankkk1912/ai4s-literature-workbench/releases/latest) 下载 `ai4s-literature-workbench-<版本号>.zip`，核对 `SHA256SUMS.txt`，在 **设置 → Plugins → Add → Upload plugin** 中上传。
- **备选方式（未验证）**：选择 **Add → Add marketplace**，填入 `Frankkk1912/ai4s-literature-workbench`，通过源码安装后需构建一次。

- *说明*：此标签页中的 `/plugin` 仅打开插件设置，不执行终端安装命令。Mac 上已验证 v0.2.0 上传成功并识别四个技能与两个本地服务，但该已发布 zip 的相对 MCP 路径会启动失败；本次路径修复尚未包含在该已发布产物中，也尚未在桌面版验证启动。

**Claude 桌面版 Chat**：
1. **安装技能（仅含四个技能）**：在 **设置 → Plugins → Add → Upload plugin** 上传上述同一个 zip（Mac 已验证 v0.2.0）。Chat 忽略插件内的本地 MCP 服务（包括插件声明的 `.mcpb`），而 Code 会加载它们。
2. **下载工具扩展**：另行下载**两个**独立扩展 `ai4s-literature-zotero-<版本号>.mcpb` 和 `ai4s-literature-fulltext-<版本号>.mcpb`，逐个核对 `SHA256SUMS.txt`；若缺少任一文件或校验不符则停止。
3. **安装扩展**：逐个打开（Mac：`open <file>`；Windows：`start "" <file>`），或交给用户双击。Zotero 保持两个可选设置默认并点击 **安装**；fulltext 无必填设置或密钥，直接点击 **安装**。用户完成安装前工具不会生效。

- *扩展与运行时说明*：fulltext 提供 OA 优先全文拉取与 PDF 校验，不涉及 Zotero 凭据或机构登录。两个扩展均由 CI 构建校验（尚未做真实 Chat 安装验证），并使用 Claude Desktop 内置的 Node.js（版本未验证，要求 ≥ 22.13）。上传的插件保存在 claude.ai 账号上，在 Chat、Cowork、Code 间同步，但各入口的工具支持不同。
- *安全与备选*：切勿将 API 密钥贴进聊天，也不要让 Agent 编辑 `~/Library/Application Support/Claude/` 下的配置（Mac 保护此目录，实测拒绝访问）。[INSTALL.md](INSTALL.md) 中的手动配置路线仅供用户自行粘贴、作为最后备选。

**Claude Code 终端、ChatGPT 桌面版、WorkBuddy**：将以下指令原样发送给客户端（若客户端请求访问 GitHub 或网络权限，请选择**允许**）：

```text
请帮我从
https://github.com/Frankkk1912/ai4s-literature-workbench.git
安装这个插件到当前应用。严格按 INSTALL.md 操作；如果打不开仓库，就读
https://raw.githubusercontent.com/Frankkk1912/ai4s-literature-workbench/main/INSTALL.md
不要自己添加步骤。装好后，用通俗的话告诉我现在能用什么、我自己还需要做什么。
```

**其他**：请参考下方「其他 Agent 与手动安装」折叠部分。

> **验证状态：** 已在 Windows 11 通过 MCP 配置文件验证 WorkBuddy 与 ChatGPT 桌面版（ChatGPT 的 MCP 配置文件方式仅连接工具，不加载技能）；Mac 下 Claude 插件上传与四个 Chat 技能已验证。尚未验证：桌面版 Code 中路径修复后的 MCP 启动、桌面端 **Add marketplace**、两个独立 `.mcpb` 扩展安装、WorkBuddy 应用内插件市场、CodeBuddy、macOS 版 ChatGPT 桌面端，以及在 ChatGPT 桌面端内执行 Codex 插件命令。

### 2. 首次初始化

工具已连上时，Agent 会运行 `ai4s-setup`，汇报当前可用功能，只询问尚未配置的密钥及 Zotero 插件；三把密钥都已配置时，会提醒随时可以要求打开密钥页修改。全部可选。只有技能的 Claude Chat 会先说明限制并引导安装两个独立扩展，不会声称检索可用：

- **API 密钥非必需**：文献检索、排序和起草均可零配置使用。如需补充密钥，请在本地配置页填写，切勿直接发到聊天框。
- **开启本地 Zotero 读取（免密钥）**：在 Zotero 中打开 **设置 → 高级**，勾选 **允许这台电脑上的其他应用与 Zotero 通信**。
- **开启 Zotero 写入**：在本地设置页填入 Zotero API Key，或使用 Zotero 10+ 并在弹窗中选择「始终允许」。
- **安装指标列插件**：下载 [`literature-metrics.xpi`](https://github.com/Frankkk1912/ai4s-literature-workbench/releases/latest/download/literature-metrics.xpi)，通过 **工具 → 插件 → 齿轮 → 从文件安装插件** 安装并重启 Zotero；随后让 Agent 同步或刷新一次目标分类即可显示 IF / JCR / 中科院分区数据。

### 常见问题排查

| 现象 | 解决方法 |
| --- | --- |
| Agent 提示 `My search tools are not connected yet` | 重启客户端，再次让它运行 `ai4s-setup`。 |
| 本地设置页未自动弹出 | 访问 Agent 返回的本地链接并输入短码；或直接在解压后的发布目录中双击 `Setup AI4S.bat`（Windows）/ `Setup AI4S.command`（macOS，若被系统拦截请右键选择「打开」）。 |
| 无法读取本地 Zotero 文献库 | 检查 Zotero **设置 → 高级**，确认已勾选「允许这台电脑上的其他应用与 Zotero 通信」。 |
| 无法写入 Zotero | 在本地设置页配置 Zotero API Key，或升级至 Zotero 10+ 并在授权弹窗选择「始终允许」。 |
| 列表中不显示 IF / JCR / 分区列 | 确认已安装 `literature-metrics.xpi` 并重启 Zotero，再让 Agent 对该分类执行一次同步或刷新。 |
| 客户端请求访问 GitHub 或网络权限 | 选择允许。 |

更多上手说明见 `docs/getting-started_CN.md`。

### 可选 API 密钥说明

<p align="center"><img src="docs/assets/onboarding.png" width="520" alt="本地配置页，展示 Zotero、PubMed 与 EasyScholar 的配置状态"></p>

*演示环境中的本地配置页。EasyScholar 已配置；页面显示 “Zotero not found”，是因为插件安装在隔离的演示 profile 中，扫描默认路径时不会找到它。*

- API 密钥均保存在本机私有配置文件中，不会暴露在对话上下文里。
- PubMed 与 Zotero 的 API Key 均可通过各自免费账号直接申请；EasyScholar 密钥请参考其官网说明。
- 基础检索依托公开数据源，不配密钥即可正常运行；配置密钥主要用于提升 PubMed 请求速率上限、启用 Zotero 写入以及补全中科院分区等期刊指标。

<details>
<summary>其他 Agent 与手动安装</summary>

前置要求：Git，以及包含 npm 的 Node.js ≥ 22.13。克隆仓库并运行一次构建脚本即可；首次检索会自动下载检索辅助组件，无需手动安装 `uv`。

```bash
git clone https://github.com/Frankkk1912/ai4s-literature-workbench.git
cd ai4s-literature-workbench
node scripts/bootstrap.mjs
```

Windows 环境同样执行上述三条命令；请直接通过 `node` 运行脚本，切勿使用 `.ps1` 或 `.sh` 包装脚本。

**终端 Claude Code**（`/plugin` 安装命令仅在终端输入，切勿在桌面版 Code 标签页执行）

```bash
claude plugin marketplace add Frankkk1912/ai4s-literature-workbench
claude plugin install ai4s-literature-workbench@ai4s-literature-workbench
```

**Codex**

```bash
codex plugin marketplace add https://github.com/Frankkk1912/ai4s-literature-workbench.git
codex plugin add ai4s-literature-workbench@ai4s-literature-workbench
```

**ChatGPT 桌面版**：优先使用上方的安装指令。如需手动配置，已安装 `codex` CLI 时可直接执行上述 Codex 命令；否则请参照 [INSTALL.md](INSTALL.md) 配置 MCP 文件（仅连接工具，不加载技能）。已在 Windows 11 验证，macOS 尚未实测。

**CodeBuddy**（尚未在 CodeBuddy 上实测）：在应用内执行：

```bash
/plugin marketplace add Frankkk1912/ai4s-literature-workbench
/plugin install ai4s-literature-workbench@ai4s-literature-workbench
```

**Trae / Qoder**：在仓库根目录执行（将 `/path/to/project` 替换为目标工作区路径）：

```bash
node scripts/install-host.mjs --host trae --target /path/to/project
node scripts/install-host.mjs --host qoder --target /path/to/project
```

</details>

<details>
<summary>开发者指南</summary>

### 项目结构

```text
ai4s-literature-workbench/
├── .claude-plugin/            # Claude Code 插件市场与清单配置
├── .codebuddy-plugin/         # CodeBuddy 插件市场与插件清单
├── .codex-plugin/             # Codex 清单与插件市场配置
├── docs/                      # 安装指南与各模块说明文档
├── release/launchers/         # Setup AI4S.bat 与 Setup AI4S.command 启动器
├── scripts/                   # 安装、构建与环境校验脚本
├── skills/                    # ai4s-setup、文献检索、Zotero 管理与写作 Skills
├── runtime/                   # Zotero MCP 运行时与本地配置面板
├── fulltext-runtime/          # 开放获取全文拉取与 PDF 校验模块
├── literature-metrics/        # Zotero 桌面端指标列插件源码
└── tests/                     # 仓库级自动化测试
```

`install-manifest.json` 与 `INSTALL.md` 配套维护，供 Agent 自动执行安装流程；本 README 面向人工阅读。

### 本地构建与测试

在仓库根目录执行。`bootstrap.mjs` 会自动安装依赖并构建 Zotero 与全文检索两个运行时：

```bash
node scripts/bootstrap.mjs
node --import ./runtime/node_modules/tsx/dist/loader.mjs --test "tests/*.test.mjs"
(cd runtime && npm run typecheck && npm test)
(cd fulltext-runtime && npm run typecheck && npm test)
(cd literature-metrics && npm ci && npm run check && npm test && npm run package)
```

### 相关文档

- `docs/getting-started_CN.md`
- `docs/zotero-xpi.md`
- `docs/dev/onboarding.md`
- `docs/dev/local-dashboard.md`
- `docs/dev/release-checklist.md`
- `SECURITY.md`

</details>

## 🤝 参与贡献

欢迎提交 Issue 反馈问题或发起 Pull Request。

## 📄 许可证

本项目基于 MIT 协议开源，详见 `LICENSE`。© Frank AI4S Skill contributors。

本项目的 Zotero 交互层参考了 Oscar Devos 的 [Zoteus](https://github.com/oscardvs/zoteus)，第三方组件署名详见 `THIRD_PARTY_NOTICES.md`。

---

<p align="center">
  <sub>📚 AI4S Literature Workbench · 让综述里的每一句引文都有据可查</sub>
</p>
