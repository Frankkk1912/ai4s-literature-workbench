# AI4S Literature Workbench

[English](README.md)

> 把你的研究问题变成有排序的阅读清单、整理好的 Zotero 文库分类，以及能回溯到证据的草稿。

![License: MIT](https://img.shields.io/badge/license-MIT-blue)

<!-- Screenshot: 展示 Zotero 项目分类中的彩色 IF/JCR/CAS 指标列与阅读优先级（Priority）控件。 -->
<!-- ![带期刊指标与阅读优先级的 Zotero 项目分类](assets/zotero-project-collection.png) -->

## 它能帮你做什么
别再来回切换数据库检索、期刊指标查询和零散的引文笔记。研究一个生物医学问题时，你需要知道哪些论文值得读，以及它们究竟能支持哪些结论。

用一句话描述你的问题。让内置工具检索并排序论文，把选中的证据和报告一起整理到 Zotero，再基于这些证据起草。下结论前，先检查检索覆盖范围，以及证据来自摘要还是全文。

```mermaid
flowchart LR
    A["研究<br/>literature-research"] --> B["检索并打分<br/>literature-research"]
    B --> C["整理到 Zotero<br/>literature-manager"]
    C --> D["带证据的写作<br/>literature-writing"]
```

看看你会得到什么：带排序理由、匹配到的 2025 JCR 指标和来源链接的阅读表，以及研究报告。
<!-- Screenshot: 并排展示 ranked_all.csv 与 report.md，包含排序理由、匹配到的 2025 JCR 指标和来源链接。 -->
<!-- ![文献检索证据表与研究报告](assets/retrieval-evidence-table.png) -->

## 试试看：你这样说，会得到什么
### 找到值得读的论文
```text
检索并排序关于 GLP-1 受体激动剂与心血管结局的 PubMed 文献证据。保存证据和报告，供后续写作使用。
```
拿到去重后的阅读清单、排序理由和可检查的报告。

### 把课题资料放在同一个 Zotero 分类
```text
把我定稿的文献报告和选中的论文同步到名为 "GLP-1 CVD Project" 的 Zotero 文库分类。
```
把报告笔记和选中的论文放在一起；复用 DOI/PMID 精确匹配的条目，避免重复创建。

### 起草能核查证据的段落
```text
基于我保存的排序证据和报告，起草一段中文文献综述。使用 [EV:n] 引文占位符，并标出需要核查的参考文献。
```
拿到带证据出处的草稿和参考文献核对表；有引文需要进一步检查时，再附一份待核查清单。
<!-- Screenshot: 并排展示带 [EV:n] 占位符的综述段落与对应的参考文献核对表。 -->
<!-- ![证据可追溯的综述段落与参考文献核对表](assets/evidence-traced-writing.png) -->

## 为什么你会喜欢它
- **选好下一篇要读的论文** — 比较相关性与排序理由，并查看从内置 2025 JCR 表匹配到的期刊指标。
- **随时找回课题资料** — 把选中的论文和当前报告放在同一个 Zotero 分类；需要时再请求生成可复用的英文标签或一句话中文摘要。
- **核查草稿里的结论** — 通过引文占位符和参考文献核对表，把论点追溯到保存的证据。
- **掌握修改的决定权** — 批量导入和指标更新先预览，你确认后才写入，并留下修改记录。
- **不把密钥交给聊天窗口** — 在你自己的电脑上，通过隐藏输入内容的设置向导亲手录入可选凭据。
<details>
<summary>内置技能（Skill）清单</summary>

`literature-research` — 检索与排序；`literature-manager` — 整理到 Zotero；`literature-writing` — 基于证据起草。
</details>

## 里面有什么
整个工作台分两块。单独使用其中一块，或合在一起用。

### 你用的 agent 自带的工具
你的 agent 可以代你调用这些能力——它们和 agent 已经在用的同一种协议对话（即 MCP, Model Context Protocol），所以你只需要用自然语言提问。
- **检索与排序** — 从配置好的源库抓论文、去重、按相关性打分。`search-items`、`find-duplicates`
- **同步到 Zotero 分类** — 用 DOI/PMID 精确匹配，写一份课题笔记，绝不重复创建。`sync-literature-project`、`apply-import-plan`、`manage-collections`
- **打标签与生成摘要** — 清理冗余源标签，应用 `AI4S:Semantic:*` 结构化标签，给每条目加一句话中文摘要。`apply-semantic-tags`、`apply-ai-summaries`、`cleanup-auto-tags`、`tag-audit`
- **引文与起草** — 把排序后的证据变成带 `[EV:n]` 占位符的草稿，格式化参考文献并导出。`apply-citation-plan`、`format-bibliography`、`export`
- **审计与指标** — 维护证据-论点对应表，审计标签一致性，更新期刊指标。`tag-audit`、`apply-metrics-plan`

### Zotero 桌面端附加组件
需要单独安装到 Zotero 桌面端的插件（XPI）。它在你的文库右侧增加这些列与控件，默认只读：
- 彩色 **IF / JCR / CAS** 指标列，一眼看清期刊质量
- **文章类型（Article Type）** 自动识别、**AI 摘要（AI Summary）** 字段、**智能标签（Agent Tags）** 便于导航
- **优先级 1 / 2 / 3** — 唯一允许直接写入的路径，必须由你通过星标控件、数字快捷键或右键菜单显式设置


## 开始使用

### 你需要什么
- 使用 **Claude Code** 或 **Codex** 作为你的 agent 应用。
- 如果要在 Zotero 中整理文献，准备 **Zotero 桌面版（Zotero Desktop）**。
- 按需准备 Zotero、PubMed/NCBI 或 EasyScholar 的可选凭据，用于文库写入、提高检索请求额度或补充期刊指标。
- 让你的 agent 在首次设置时替你检查技术前置条件，并说明还需要安装什么。

### 1. 安装
把下面这段话发给 Codex、Claude Code 或 WorkBuddy：
> 请帮我从 https://github.com/Frankkk1912/ai4s-literature-workbench.git 安装这个插件到当前应用。严格按该仓库里的 INSTALL.md 操作，不要自己添加步骤。装好后，用通俗的话告诉我现在能用什么、我自己还需要做什么。

应用可能会请求访问 GitHub 或网络的权限，请选择**允许**，否则安装无法继续。WorkBuddy 与 CodeBuddy 目前还没有在真实电脑上测试过。

### 2. 首次设置
- **可选：** 申请所需凭据，在你电脑上隐藏输入内容的设置向导中录入，不要贴进聊天。若要同步条目或笔记，请允许 Zotero 文库写入。
- **可选：** 请你的 agent 构建用于彩色指标和阅读优先级的 Zotero 附加组件。在 Zotero 中选择 **工具 → 附加组件 → 齿轮菜单 → 从文件安装附加组件…**，选中构建出的文件，再按 Zotero 提示操作。

### 3. 发出你的第一条指令
从上面的 **找到值得读的论文** 开始。不配置可选凭据，你也能检索、排序，并基于已保存的证据起草。

<details>
<summary>其他 agent 与手动安装</summary>

安装 Git、Node.js ≥22.13（含 npm）和 uv。在 macOS/Linux 上克隆并构建：
```bash
git clone https://github.com/Frankkk1912/ai4s-literature-workbench.git
cd ai4s-literature-workbench
node scripts/bootstrap.mjs
```
在 Windows 上执行同样的 `git clone` 和 `cd`，再执行同样的 `node scripts/bootstrap.mjs`。
选择你所用 agent 的命令。Trae/Qoder 命令需在此仓库目录运行；把 `/path/to/project` 换成你的项目文件夹。这些命令会把内置工具添加到该项目。

**Claude Code**
```bash
claude plugin marketplace add Frankkk1912/ai4s-literature-workbench
claude plugin install ai4s-literature-workbench@ai4s-literature-workbench
```
**Codex**
```bash
codex plugin marketplace add https://github.com/Frankkk1912/ai4s-literature-workbench.git
codex plugin add ai4s-literature-workbench@personal
```
**Trae / Qoder** — 选择你所用应用对应的那一行。
```bash
node scripts/install-host.mjs --host trae --target /path/to/project
node scripts/install-host.mjs --host qoder --target /path/to/project
```
</details>

---

## 开发者指南

### 项目结构
```text
ai4s-literature-workbench/
├── .claude-plugin/            # Claude Code 插件清单与市场定义
├── .codex-plugin/             # Codex 插件清单与默认提示词
├── docs/                      # 设置与组件指南
├── scripts/                   # 安装、构建与验证脚本
├── skills/                    # 检索、Zotero 管理与写作技能
├── runtime/                   # Zotero 工具与本地配置服务
├── fulltext-runtime/          # 开放获取（Open Access）全文检索与 PDF 检查
├── database-browser-runtime/  # 通过可见浏览器访问已授权数据库
├── literature-metrics/        # Zotero 桌面端附加组件源码
└── tests/                     # 仓库级测试
```

### 开发
从仓库根目录运行；构建过程会安装 Zotero/全文组件依赖：
```bash
node scripts/bootstrap.mjs
node --import ./runtime/node_modules/tsx/dist/loader.mjs --test "tests/*.test.mjs"
(cd runtime && npm run typecheck && npm test)
(cd fulltext-runtime && npm run typecheck && npm test)
(cd database-browser-runtime && npm ci && npx playwright install chromium && npm run build && npm run typecheck && npm test)
(cd literature-metrics && npm ci && npm run check && npm test && npm run package)
```

### 文档
- [首次设置与凭据](docs/onboarding.md)
- [Zotero 桌面端附加组件：构建与安装](docs/zotero-xpi.md)
- [本地配置状态页](docs/local-dashboard.md)

### 引用与致谢
遵循 **No Evidence, No Conclusion（无证据，不下结论）**：把科学论断追溯到保存的证据。
感谢 Frank AI4S Skill contributors 和 Oscar Devos 的 [Zoteus](https://github.com/oscardvs/zoteus)。组件署名与许可证见[第三方声明](THIRD_PARTY_NOTICES.md)。

### 许可证
[MIT](LICENSE) © Frank AI4S Skill contributors。
