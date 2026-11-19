> Historical design note from before the current skill. It is not retrieval
> guidance. The supported path is `SKILL.md`: PubMed and OpenAlex APIs, plus a
> Web of Science CSV/TSV export the user downloaded. This skill does not browse
> campus databases.

### Objective：

- 一个由用户自然语言驱动的关键词检索-多平台聚合-结果总结的学术文献搜索skill

### core Workflow：

1. 检索词拆解：根据用户给出的自然语言自动拆解、匹配、拓展成学术词汇或者mesh词表进行搜索、保持用户给出的时间、期刊、分区、影响因子等限定条件
2. 多数据库检索。现行实现是 PubMed 与 OpenAlex 的公开 API，Web of Science 只接受用户自行下载的官方 CSV/TSV。不要用浏览器访问校园网数据库。
   - pubmed ：可以使用 api key
   - openalex ：免费，无 key
   - wos ：用户自己下载的官方导出，不是浏览器抓取
   - arxiv
3. 过滤筛选符合条件的文献进行整合按照相关性降序结构化输出，包括：
   - 标题 ｜ 核心结论 ｜ 分区影响因子｜doi或者全文链接
4. 检索阶段只留下检索记录。科学问题的回答交给 literature-writing，不写进 report.md

### 使用实例：

用户：检索过去五年有关EXAMPLE-GENE在心血管疾病中的作用
agent：
    - 提取关键词：过去五年、EXAMPLE-GENE、心血管疾病
    - 拓展关键词：EXAMPLE-GENE的同源名称（Example-gene、example-gene等）、心血管疾病包括：心梗、心衰、心肌病等
    - 数据库检索
    - 导出或者爬取文献摘要到本地
    - 过滤、筛选、整合结果为结构化的csv或者md文档
    - 回答用户、给出ref脚注

### 下一步实现

1. 联动zotero进行文献管理：导出结果直接写入zotero，或者直接搜索zotero已有文献
2. 基于文献搜索结果聚合进行综述写作

### 参考实现：

1. 🌟n8n-transfer ：基本涵盖了前三个流程、但缺少了多数据库搜索
2. 校园网浏览器访问已不在本仓库中。Web of Science 只导入用户下载的官方导出。
3. K-Dense-AI/scientific-agent-skills ：学术skill
4. blessonism/openclaw-search-skills ：多源搜索、结果整合

