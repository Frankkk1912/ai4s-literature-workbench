# 入门指南

[English](getting-started.md)

这一页带你从零开始，到完成第一次检索，按你会遇到的顺序写。你不需要输入任何命令：只需要点“允许”、点下载、把密钥贴进一个表单。

**做完之后你会得到：** 一次真实检索得出的排序阅读清单；如果你想要，还有 Zotero 里的期刊分区列（IF / JCR / 中科院分区）。

## 开始之前

- 需要一个 agent 应用；如果想在 Zotero 里整理文献，再准备 Zotero 桌面版。
- 应用可能会请求访问 GitHub 或网络的权限，请选择**允许**，否则安装会卡住。
- 密钥都是可选的。不配密钥，你也能检索、排序和起草。

## 第 1 步：安装

| 你用的应用 | 怎么做 |
| --- | --- |
| **Claude 桌面版 Code 标签** | 下载 release zip、核对哈希，在 **设置 → Plugins → Add → Upload plugin** 上传。Mac 上传已验证；修复后的 MCP 启动未做桌面验证，已发布 v0.2.0 zip 的相对 MCP 路径会启动失败。备选 **Add → Add marketplace** 填 `Frankkk1912/ai4s-literature-workbench`（未验证，源码需构建）。然后 `/reload-plugins` 或新开会话。这里 `/plugin` 只打开设置。见 [INSTALL.md](../INSTALL.md#claude-desktop-code-tab)。 |
| **Claude 桌面版 Chat** | 上传同一个 zip 只获得四个技能（Mac 已验证 v0.2.0）。Chat 忽略插件内本地 MCP，包括插件声明的 `.mcpb`，Code 会加载它们。再下载两个独立扩展 `ai4s-literature-zotero-<版本号>.mcpb` 和 `ai4s-literature-fulltext-<版本号>.mcpb`，逐个核对 `SHA256SUMS.txt`；缺少任一文件或校验不符就停止。逐个打开（Mac：`open <file>`；Windows：`start "" <file>`），或交给用户双击。Zotero 保持可选设置默认并点安装；fulltext 无必填设置或密钥，直接点安装。用户安装前工具不会生效。两者均由 CI 构建校验，未做真实 Chat 安装验证；使用 Desktop 内置 Node（版本未确认，要求 22.13+）。fulltext 提供 OA 优先全文拉取与 PDF 校验，不处理 Zotero 凭据或机构登录。禁止让 agent 改 `~/Library/Application Support/Claude/`；配置路线只供用户手动粘贴、作为最后备选。见 [INSTALL.md](../INSTALL.md#claude-desktop-chat)。 |
| **终端 Claude Code、Codex、ChatGPT 桌面版、WorkBuddy、CodeBuddy** | 把 [README_CN](../README_CN.md#1-安装选你用的应用) 里的安装指令发给应用。agent 会按 [INSTALL.md](../INSTALL.md) 操作，并告诉你哪些已经能用、哪些需要你处理。 |
| **Trae、Qoder** | 按 [README_CN](../README_CN.md) 里“其他 agent 与手动安装”操作。 |

已在一台真实的 Windows 11 电脑上试过：WorkBuddy 通过它的 MCP 配置文件安装，ChatGPT 桌面版也通过它的 MCP 配置文件安装（这条路径能连上工具，但不会加载技能）。还没有测试过的是：WorkBuddy 应用里的插件市场、CodeBuddy，以及 Mac 上的 ChatGPT 桌面版。某一步失败时，agent 会说明卡在哪里。

## 第 2 步：看看现在能用什么

只有技能的 Claude Chat 中，`ai4s-setup` 会说明限制并引导安装两个独立扩展；单纯重启不会增加插件内的本地工具。下文的检索步骤要求宿主能运行工具和命令。

让 agent 运行 `ai4s-setup` 技能，或者直接开始用。它会做一次状态检查，并分三组告诉你：**现在可用**、**需要你处理**、**可选**。如果它说“检索工具还没有连上”（My search tools are not connected yet），重启应用再问一次。

## 第 3 步：按需添加（全部可选）

安装结束时 agent 只会询问尚未配置的密钥及 Zotero 插件；三把都已配置时，会提醒随时可以要求打开密钥页修改。全部可以跳过。需要密钥时，agent 会在你自己的电脑上打开一个页面。页面已经完成配对，会说明这个密钥有什么用、给出申请链接，并提供一个隐藏输入的框。把密钥贴到这里：agent 看不到它，聊天里也不会显示它。

| 你想要 | 你需要 | 在哪里设置 |
| --- | --- | --- |
| 检索、排序、起草 | 什么都不用 | |
| 读取你的 Zotero 文献库 | 打开 Zotero，并勾选**“允许这台电脑上的其他应用与 Zotero 通信”** | Zotero → 设置 → 高级 |
| 把文献存进 Zotero | Zotero 密钥；或 Zotero 10 及以上（保存时 Zotero 会弹窗询问一次，选**“始终允许”**） | 设置页 |
| 更快的 PubMed 检索 | 免费的 PubMed 密钥 | 设置页 |
| 报告里更多期刊指标 | EasyScholar 密钥 | 设置页 |
| Zotero 里的 IF / JCR / 中科院分区列 | Zotero 插件 | 见下 |

Zotero 密钥要在重启应用后才生效，agent 会提醒你。

如果设置页没有打开，agent 会给你一个网址和一个短码：打开网址，输入短码。再不行，就在解压出来的发布文件夹里双击 `Setup AI4S.bat`（Windows）或 `Setup AI4S.command`（Mac）。Mac 上如果被拦截，右键点它，选**打开**，再点一次**打开**。

### Zotero 插件（期刊分区列）

1. [下载插件](https://github.com/Frankkk1912/ai4s-literature-workbench/releases/latest/download/literature-metrics.xpi)。如果没有开始下载，打开[发布页](https://github.com/Frankkk1912/ai4s-literature-workbench/releases)，选 `.xpi` 文件。
2. 在 Zotero 中选择 **工具 → 插件**。
3. 点齿轮 → **从文件安装插件**（Install Add-on From File…），选下载的文件。
4. 重启 Zotero。

状态检查只能告诉你“在你的 Zotero 配置里找到了这个插件”，不能证明 Zotero 已经加载了它。分区列显示的是工具写进条目里的数据，所以装好之后，请让 agent 同步或刷新一个分类。

## 第 4 步：你的第一条指令

```text
检索并排序 GLP-1 受体激动剂与心血管结局相关的 PubMed 证据，保存证据和报告，方便之后写作。
```

你会得到一份去重后的阅读清单、排序理由，以及一份可以打开查看的报告。

## 遇到问题时

| 你看到的 | 怎么办 |
| --- | --- |
| agent 说“检索工具还没有连上” | 重启应用，然后对它说：“运行 ai4s-setup 技能”。 |
| 设置页没有打开 | 用 agent 给你的网址和短码，或者双击 `Setup AI4S` 文件（见第 3 步）。 |
| agent 读不到我的 Zotero 文献库 | 打开 Zotero，在 设置 → 高级 里勾选“允许这台电脑上的其他应用与 Zotero 通信”。 |
| 存不进 Zotero | 在设置页填入 Zotero 密钥；或使用 Zotero 10 及以上，Zotero 弹窗时选“始终允许”。 |
| Zotero 里没有分区列 | 按第 3 步安装插件并重启 Zotero，再让 agent 同步或刷新一个分类。 |
| 很早以前装的插件一直不更新 | 0.1.14 之前的版本不能自己更新。请手动安装一次最新文件。 |
| 应用请求访问 GitHub 或网络 | 选择“允许”。 |
| 检索提示缺少辅助工具 | agent 会提出把一个小的检索辅助工具（约 15 MB）下载到你用户账户下的文件夹里（不需要管理员权限），请同意。如果下载被拦下，agent 会改为提供这个工具的官方安装程序。 |

## 常见问题

**密钥是什么？** 一长串像密码的字符，让这个工具以你的身份使用某个服务。它只填进你自己电脑上的设置页，存放在这台电脑的私有文件里，不会出现在聊天中。

**哪些密钥免费？** PubMed 密钥用 NCBI 账号免费申请；Zotero 密钥用免费的 Zotero 账号即可创建；EasyScholar 密钥由 EasyScholar 发放，请以其网站说明为准。

**为什么不配密钥也能检索？** 检索用的是公开数据源。密钥的作用是提高 PubMed 的请求额度、让工具能存进 Zotero，以及补充更多期刊指标。
