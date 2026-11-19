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
| **Claude Desktop** | 打开[最新发布页](https://github.com/Frankkk1912/ai4s-literature-workbench/releases/latest)，下载 `ai4s-literature-zotero-<版本号>.mcpb`，双击它（或拖进 Claude Desktop 窗口）。在安装界面点确认，两个可选设置保持默认。这样装上的只有 Zotero 工具，不含技能和全文工具。 |
| **Claude Code、Codex、WorkBuddy、CodeBuddy** | 把 [README_CN](../README_CN.md#1-安装选你用的应用) 里的安装指令发给应用。agent 会按 [INSTALL.md](../INSTALL.md) 操作，并告诉你哪些已经能用、哪些需要你处理。 |
| **Trae、Qoder** | 按 [README_CN](../README_CN.md) 里“其他 agent 与手动安装”操作。 |

WorkBuddy 与 CodeBuddy 目前还没有在真实电脑上测试过；如果失败，agent 会说明卡在哪一步。

## 第 2 步：看看现在能用什么

让 agent 运行 `ai4s-setup` 技能，或者直接开始用。它会做一次状态检查，并分三组告诉你：**现在可用**、**需要你处理**、**可选**。如果它说“检索工具还没有连上”（My search tools are not connected yet），重启应用再问一次。

## 第 3 步：按需添加（全部可选）

需要密钥时，agent 会在你自己的电脑上打开一个页面。页面已经完成配对，会说明这个密钥有什么用、给出申请链接，并提供一个隐藏输入的框。把密钥贴到这里：agent 看不到它，聊天里也不会显示它。

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
| 检索提示缺少辅助工具 | agent 会提出安装一个小的检索辅助工具（`uv`），请同意。 |

## 常见问题

**密钥是什么？** 一长串像密码的字符，让这个工具以你的身份使用某个服务。它只填进你自己电脑上的设置页，存放在这台电脑的私有文件里，不会出现在聊天中。

**哪些密钥免费？** PubMed 密钥用 NCBI 账号免费申请；Zotero 密钥用免费的 Zotero 账号即可创建；EasyScholar 密钥由 EasyScholar 发放，请以其网站说明为准。

**为什么不配密钥也能检索？** 检索用的是公开数据源。密钥的作用是提高 PubMed 的请求额度、让工具能存进 Zotero，以及补充更多期刊指标。
