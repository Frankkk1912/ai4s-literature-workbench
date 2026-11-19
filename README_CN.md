<h1 align="center">📚 AI4S Literature Workbench</h1>

<p align="center">
  <strong>一句课题，收成阅读清单、一个 Zotero 分类，和能对上出处的草稿。</strong><br>
  <em>写综述的时候，还找得到那句话出自哪篇。</em>
</p>

<p align="center">
  🔎 检索留着记录 · 📚 论文进自己的库 · ✍️ 草稿对得上出处
</p>
<p align="center">
  <a href="https://github.com/Frankkk1912/ai4s-literature-workbench/releases">📥 发布页</a> ·
  <a href="README.md">🇬🇧 English</a> ·
  <a href="#-快速开始">🚀 快速开始</a> ·
  <a href="docs/getting-started_CN.md">📖 入门</a>
</p>

---

## 🤔 为什么要做这个？

> 🎓 明天组会，开题也还空着。前一天晚上你在 PubMed 里翻页，一篇篇查影响因子和分区，再手动导入 Zotero。综述写到某一句，哪句话出自哪篇，找不到了。
>
> **要是你只说一句课题，回来就是阅读清单、一个 Zotero 分类，还有一段能对上论文的草稿呢？**

这是装在你已经在用的 agent 里的一套文献工具。你用平时说话的方式讲课题。它去 PubMed 和 OpenAlex 检索，DOI 或 PMID 相同的并成一条，把检索式和篇数写成一份记录，再把选中的论文和这份记录放进 Zotero 的同一个分类。写的时候句子后面留着 `[EV:n]`，指回存下来的那一篇。检索有条数上限，看到的多半是摘要，两件事都写在检索记录里，下结论前看一眼。

### 😩 现在怎么做

| 麻烦 | 自己弄的时候 |
| --- | --- |
| 🔁 翻库 | PubMed 一页页点，换一个库再点一遍 |
| 📊 分区 | 影响因子、JCR、中科院分区，一篇篇查 |
| 📥 入库 | 条目手动导入 Zotero，重复的过一会儿才发现 |
| 📝 写综述 | 写到某句，想不起是哪篇说的 |

### 💡 换成三件事

| | 你拿到什么 |
| --- | --- |
| 🔎 **先检索** | PubMed 和 OpenAlex 一起查，按 DOI 或 PMID 去重，留下检索记录，再用 Priority 1–3 标这份课题先读哪几篇 |
| 📚 **再入库** | DOI 或 PMID 对上的条目直接复用。检索记录和论文放在同一个 Zotero 分类 |
| ✍️ **写的时候留出处** | 草稿用 `[EV:n]`。只有摘要、或者对不上的，另列一张待查表 |

<!-- GIF: 一句话检索到 Zotero 分类 -->
<!-- GIF: Zotero 里的 IF、JCR、中科院分区列和 Priority 星星 -->
<!-- GIF: 综述段落里的 [EV:n]，旁边是待查参考文献 -->

## ⚔️ 跟另外两种做法比

| | 这个工作台 | 自己动手 | 直接问一个通用聊天机器人 |
| --- | --- | --- | --- |
| 📄 **文献从哪来** | PubMed 和 OpenAlex，DOI 或 PMID 相同就合成一条 | 你在网页上翻 | 模型凭记忆回答，可能写出不存在的文献 |
| 📝 **检索记录** | `report.md` 里有问题、日期、数据库、原样检索式，以及命中、去重、入选的篇数 | 你自己的笔记，有就有 | 不会在你的课题文件夹里留下检索式 |
| 📚 **你的文献库** | 本机 Zotero 可以不配密钥就读。写入用 Zotero 密钥，或者开着 Zotero 10 及以上（它自己弹一次窗） | 你一条条导入 | 读不到你的 Zotero，也写不进去 |
| 📊 **影响因子和分区** | 自带 2025 年 JCR/IF 表，按 ISSN 对上。中科院分区要 EasyScholar 查过，或者你另外给的指标表写进条目之后，列里才有 | 一篇篇查 | 聊天里报的影响因子不是查的这份 2025 表，数字可能对不上 |
| ✍️ **写综述** | 按保存的证据下笔，句子用 `[EV:n]` 指回论文。只有摘要、或者对不上的，进待查清单 | 出处记在你脑子里 | 它没读过你存下来的那批证据 |

> 它管的是组会前最常见的那一晚：课题已经清楚，你要一份能复核的检索、一个 Zotero 分类，还有一段能对上论文的草稿。

## 🧰 里面有什么

三个 skill 分工：`literature-research` 检索，`literature-manager` 放进 Zotero，`literature-writing` 写。第一次用 `ai4s-setup` 看现在能干什么。Zotero 这边 22 个工具。只读模式下还留着 12 个，它们不改文献库，其中两个只是打开密钥页、下载检索小工具。工具走 MCP，你说话就行。

### 🔎 检索和排序

默认同时查 PubMed 和 OpenAlex。OpenAlex 免费，不用密钥。电脑上如果已经配了联系邮箱，请求会走 OpenAlex 的 polite pool，这个地址不写进检索计划。

两条记录先按 DOI 合并，没有 DOI 再看 PMID。`report.md` 由脚本写成检索记录：问题、日期、数据库、原样检索式、条数限制、命中和去重之后的篇数、入选论文表。排序理由在 `ranked_all.json`。这份文件只记检索，综述放到 `literature-writing` 里写。

排序分按写死的规则算。题名、摘要、MeSH 里的词，再加上年份等，每一分都有原因，记在 `ranked_all.json`。Priority 是这份课题的阅读顺序。选进来的默认是 1。相关性过一遍时，agent 把值得细读的（机制、方法、综述或相反结果）标成 2，把必读标成 3，并记一个简短原因码。影响因子在分区列里。星星你可以事后改。下次导入时，条目上已经有的 Priority 会留着。

期刊数默认用仓库里审过的 2025 年 JCR/IF 表，按 ISSN 对上，附在证据旁边。检索结果还是原来那些。中科院分区来自 EasyScholar，或者你另外给的指标表。仓库里这张表是 2025 年的。

arXiv 要你开口才加。Web of Science 只收你已经下好的官方 CSV 或 TSV。校园网数据库留在你自己的浏览器里。开放获取的 PDF 可以另一步去取。PDF 还没到手时，这条证据按摘要算。

### 📚 放进 Zotero

读你这台电脑上的文献库不用密钥。打开 Zotero，设置 → 高级，勾上 **允许这台电脑上的其他应用与 Zotero 通信**。

存进去有两条路。填 Zotero 密钥，或者开着 Zotero 10 及以上，弹窗时选始终允许。更早的版本，本机连接只能读。无密钥写入这条，目前只对照文档里的协议做了替身测试，还没在打开的 Zotero 窗口里核过。

同步按 DOI、PMID 精确匹配，对上了就用库里那一条，不新建一份。检索记录写成这个分类里的一条笔记。只靠题名加年份猜中的，先给你看，你点头才算同一篇。

### 🏷️ 整理标签

`zotero_tag_manager` 管重复标签和没人用的标签。顺序是 `scan`、`plan`、`apply`。`plan` 写出一份带 hash 的计划，Zotero 和词表先不动。`apply` 先 dry-run。你确认那个 plan hash 之后才真改。

合并的时候，被收掉的标签进保留标签的别名，条目和词表记在同一张回执里。你没点名的标签留在原条目上。Priority、Article Type、JCR、CAS 这些，操作里没写上、你也没允许，就不动。

### ✍️ 写的时候留出处

写作从已经存下的 `ranked_all.json` 和检索记录开始。文件还没有，skill 会停下来，先去检索。草稿从这两份文件里来。

句子后面用 `[EV:n]`，也可以带 PMID 或 DOI。草稿旁边有一张参考文献核对表。证据偏弱、只有摘要、或者对不上的，才另写 `references_to_check.md`。

一句话中文摘要是看题名和摘要写的，你明确要它才生成，用来在文献库里扫一眼。写结论时回到排序结果，或者回到你真正取到的全文。

### 📊 Zotero 里的分区列

literature-metrics 是单独装进 Zotero 桌面版的插件。下载 `literature-metrics.xpi`，地址是 `https://github.com/Frankkk1912/ai4s-literature-workbench/releases/latest/download/literature-metrics.xpi`，然后工具 → 插件 → 齿轮 → 从文件安装插件，再重启。更新和详细步骤在 `docs/zotero-xpi.md`。

条目列表里会多出彩色的 **IF / JCR / 中科院分区** 列，还有 **Priority** 星星。星星用的就是检索时那套 1 / 2 / 3。Article Type、Agent Tags、一句话 AI Summary 也在这个列表里。星星、数字键 `1` / `2` / `3`、右键 **Set Priority**，是这个插件唯一会改条目的地方，改的只有 Priority 那几个标签。

列里的数字，是工具写进条目之后才显示的。装完让 agent 同步或刷新一个分类。插件读条目里的 `Extra`。查指标是同步和刷新那些工具的事。密钥只在设置页。

### 🔑 密钥不进聊天

密钥都是可选的。检索、排序、起草都不用。

你要填的时候，agent 调 `open_setup`，在你自己电脑上打开一个页面。输入框是遮住的。你贴在那里，agent 看不到，聊天里也不会出现。密钥存在这台电脑的私有文件里。

PubMed 密钥用 NCBI 账号免费申请，用来提高请求额度。Zotero 密钥用 Zotero 账号免费创建，用来写入。EasyScholar 密钥用来补期刊指标，包括中科院分区。页面上有领取链接。

## 🗣️ 你可以这样说

### 找该读的论文
```text
帮我查 GLP-1 受体激动剂和心血管结局，PubMed 和 OpenAlex 都要，排个序，检索记录留下来。
```

### 放进一个分类
```text
把这次的检索记录和选中的论文放进 Zotero，分类名叫 "GLP-1 CVD Project"。库里已经有的按 DOI 或 PMID 对上。
```

### 写一段能对上的综述
```text
用我存好的排序结果和检索记录写一段中文综述。句子后面标 [EV:n]，对不上的参考文献单独列出来。
```

## 🚀 快速开始

### 你得先有
- 一个 agent：**Claude Desktop**、**Claude Code**、**Codex**、**ChatGPT 桌面版**，或者 WorkBuddy、CodeBuddy、Trae、Qoder。
- 想整理文献库、想看分区列，就装 **Zotero 桌面版**。
- 一个浏览器，用来打开填密钥的页面。

这些就是你要自己装的。第一次检索，agent 会先问你一声，再下载一个大约 15 MB 的小工具到你的用户目录。电脑上没有能用的 Python 时，它会再下一个。不需要管理员权限，也不改系统设置。应用如果还要 Node.js，agent 会告诉你去哪下。

### 1. 安装（选你用的应用）

**Claude Desktop**（只有 Zotero 工具，没有那三个 skill，也没有全文工具。这条还没在 Claude Desktop 里试过。）

1. 打开 `https://github.com/Frankkk1912/ai4s-literature-workbench/releases/latest`，下载 `ai4s-literature-zotero-<版本号>.mcpb`。
2. 双击，或拖进 Claude Desktop 窗口。两个可选设置保持原样。密钥不要贴进聊天。

这个 `.mcpb` 用的是 Claude Desktop 自带的 Node.js。具体是哪个版本还没核对。程序包要求 22.13 或更新。

**Claude Code、Codex、ChatGPT 桌面版、WorkBuddy、CodeBuddy**：把下面这段原样发给应用：

```text
请帮我从
https://github.com/Frankkk1912/ai4s-literature-workbench.git
安装这个插件到当前应用。严格按 INSTALL.md 操作；如果打不开仓库，就读
https://raw.githubusercontent.com/Frankkk1912/ai4s-literature-workbench/main/INSTALL.md
不要自己添加步骤。装好后，用通俗的话告诉我现在能用什么、我自己还需要做什么。
```

**Trae、Qoder**：按下面「其他 agent 与手动安装」做。

应用如果问能不能访问 GitHub 或网络，选**允许**。不选的话，安装就停在这里。

> 在一台 Windows 11 上试过：WorkBuddy 走它的 MCP 配置文件，ChatGPT 桌面版也走它的 MCP 配置文件。ChatGPT 这条能连上工具，技能不会加载。还没试过的：WorkBuddy 应用里的插件市场、CodeBuddy、Mac 上的 ChatGPT 桌面版、Claude Desktop，以及在 ChatGPT 桌面版里跑 Codex 的插件命令。

### 2. 第一次用

agent 会跑 `ai4s-setup`，用大白话告诉你现在能干什么、还要你做哪一步。

- **密钥可选。** 检索、排序、起草都不用。密钥贴在本机页面上，别贴进聊天。
- **读本机文献库不用密钥。** 设置 → 高级 → 勾选 **允许这台电脑上的其他应用与 Zotero 通信**。
- **存进 Zotero** 要 Zotero 密钥，或者 Zotero 10 及以上。弹窗时选始终允许。
- **IF / JCR / 中科院分区列**：下载 `literature-metrics.xpi`，地址是 `https://github.com/Frankkk1912/ai4s-literature-workbench/releases/latest/download/literature-metrics.xpi`，工具 → 插件 → 齿轮 → 从文件安装插件，重启。列里是工具写进条目的数据，装完让 agent 同步或刷新一个分类。

### 3. 你的第一句

用上面 **找该读的论文** 那句。第一次检索一般要等几分钟。

### 出了问题

| 你看到的 | 怎么办 |
| --- | --- |
| agent 说 “My search tools are not connected yet” | 重启应用，再让它跑 `ai4s-setup`。 |
| 设置页没打开 | 打开 agent 给的网址，输入那个短码。或者在解压出来的发布文件夹里双击 `Setup AI4S.bat`（Windows）或 `Setup AI4S.command`（Mac）。Mac 上如果被拦，右键，打开，再点打开。 |
| 读不到文献库 | Zotero 设置 → 高级，勾上允许其他应用与 Zotero 通信。 |
| 存不进 Zotero | 在设置页填 Zotero 密钥，或者用 Zotero 10 及以上，弹窗选始终允许。 |
| 没有 IF / JCR / 分区列 | 装上插件，重启 Zotero，再让 agent 同步或刷新。 |
| 应用要访问 GitHub 或网络 | 选允许。 |

更多说明：`docs/getting-started_CN.md`。

### 密钥，三句

- 密钥是一长串字符，让工具以你的身份去调那个服务。它在你电脑的私有文件里，聊天里看不到。
- PubMed 密钥、Zotero 密钥，用各自的免费账号就能办。EasyScholar 的密钥看它网站上的说明。
- 检索走的是公开数据源，所以不配密钥也能查。密钥用来提高 PubMed 的额度、写入 Zotero，或者补期刊指标。

<details>
<summary>其他 agent 与手动安装</summary>

需要 Git，以及带 npm 的 Node.js 22.13 或更新。克隆之后构建一次。第一次检索会自己下载检索小工具，这条路不用你先装 uv。

```bash
git clone https://github.com/Frankkk1912/ai4s-literature-workbench.git
cd ai4s-literature-workbench
node scripts/bootstrap.mjs
```

Windows 上同样这三行。用 `node` 跑脚本，不要去跑 `.ps1` 或 `.sh`。

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

**ChatGPT 桌面版。** 把上面的安装说明发给应用。自己动手的话，本机有 `codex` 命令就用上面的 Codex 命令，否则按 [INSTALL.md](INSTALL.md) 里的 MCP 配置文件来。配置文件这条不会加载 skill。Windows 11 上试过这条，Mac 还没有。

**CodeBuddy**（还没在 CodeBuddy 上试过）。在应用里：

```bash
/plugin marketplace add Frankkk1912/ai4s-literature-workbench
/plugin install ai4s-literature-workbench@ai4s-literature-workbench
```

**Trae / Qoder。** 在这份仓库目录里运行，把 `/path/to/project` 换成你的项目文件夹。

```bash
node scripts/install-host.mjs --host trae --target /path/to/project
node scripts/install-host.mjs --host qoder --target /path/to/project
```

</details>

<details>
<summary>给开发者</summary>

### 项目结构

```text
ai4s-literature-workbench/
├── .claude-plugin/            # Claude Code 的市场和插件清单
├── .codebuddy-plugin/         # CodeBuddy 的市场清单
├── .codex-plugin/             # Codex 的清单和市场
├── docs/                      # 安装和组件说明
├── release/launchers/         # Setup AI4S.bat 和 Setup AI4S.command
├── scripts/                   # 安装、构建、检查
├── skills/                    # ai4s-setup、检索、Zotero、写作
├── runtime/                   # Zotero 工具和本机密钥页
├── fulltext-runtime/          # 开放获取全文和 PDF 检查
├── literature-metrics/        # Zotero 桌面版插件
└── tests/                     # 仓库测试
```

`install-manifest.json` 和 `INSTALL.md` 是一对。agent 按那两份走。这份 README 是给人看的。

### 开发

在仓库根目录运行。bootstrap 会装依赖并构建 Zotero 和全文这两边：

```bash
node scripts/bootstrap.mjs
node --import ./runtime/node_modules/tsx/dist/loader.mjs --test "tests/*.test.mjs"
(cd runtime && npm run typecheck && npm test)
(cd fulltext-runtime && npm run typecheck && npm test)
(cd literature-metrics && npm ci && npm run check && npm test && npm run package)
```

### 文档

- `docs/getting-started_CN.md`
- `docs/zotero-xpi.md`
- `docs/dev/onboarding.md`
- `docs/dev/local-dashboard.md`
- `docs/dev/release-checklist.md`
- `SECURITY.md`

</details>

## 🤝 参与

欢迎提 Issue 和 Pull Request。

## 📄 许可证

MIT，见 `LICENSE`。© Frank AI4S Skill contributors。

**无证据，不下结论。** 科学论断要能追溯到存下来的证据。Zotero 这一层参考了 Oscar Devos 的 Zoteus（`https://github.com/oscardvs/zoteus`）。组件署名在 `THIRD_PARTY_NOTICES.md`。

---

<p align="center">
  <sub>📚 AI4S Literature Workbench · 写综述的时候，还找得到那句话出自哪篇。</sub>
</p>
