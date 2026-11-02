# 搜全度量：独立样本覆盖率（2026-11-02）

标签：【实测】脚本/接口直接得到；【推断】由实测推出；【猜测】无直接证据。
复跑：`npx tsx scripts/coverage-sample.ts [--sample 文件] [--save 文件] [--json 文件] [--max 100]`（只读；不改 src/data/config）。

## 1. 判据（建议写入 HANDOFF 决策 5）

**"搜全" = 在独立来源的合格样本里，≥95% 的职位在 catalog 中，且发布后 24 小时内被首次看到（firstSeen − 发布日 ≤ 24h）；同时 catalog 中的合格职位里，被 triage 错拒的 ≤5%。**

- 合格 = 美国、应届/入门、ML/AI/数据科学/数据工程标题、≤30 天、非 `excludeCompanies`。
- "独立" = 来源不在 `config/watchlist.yaml` 的抓取清单里，也不是 Gmail 提醒（见下）。
- 两个数分开报：**收录率**（在不在 catalog）和**可用收录率**（在 catalog 且 triage 不是 reject）。只看前者会漏掉"抓到了但被错拒"。
- 样本月度重抽（换名单/换日期），连续两次达标才算"搜全"。24h 时效这次**没测**（独立名单只有"日期"，没有精确发布时间；【推断】需要用官方板 `published` 字段做第二类样本）。

## 2. 样本来源与独立性

- Gmail LinkedIn/Indeed/Glassdoor 提醒：**不独立**【实测】。`data/discovery/latest.json` 显示本轮摄入 34 封提醒；catalog 里有 gmail_linkedin / gmail_handshake 来源的行。未使用，也未读 Gmail。
- GitHub 名单：流水线已抓 Simplify、speedyapply×2、Tar-ive、cvrve、zapplyjobs（watchlist.yaml github 段）【实测】，所以这些**不独立**。
- 本次用流水线**未抓**的三份【实测，grep watchlist 与 catalog 来源均无】：`jobright-ai/2026-Data-Analysis-New-Grad`、`jobright-ai/2026-Software-Engineer-New-Grad`、`vanshb03/New-Grad-2027`。
- 抓取 3162 行 → 过滤后 101 条去重合格 → 取 **n=100**。匹配方式：规范化公司+标题（这些名单没有 ATS id，无法按 JobKey 匹配；链接是 jobright.ai 页面或 go.vansh.nyc 短链）。

## 3. 结果

| 指标 | 值 |
|---|---|
| 收录率（在 catalog） | **70/100 = 70%**（精确标题 69，模糊 1）【实测】 |
| 可用收录率（在 catalog 且非 reject） | **57/100 = 57%**【实测】 |
| 收录但被 triage 拒 | 13/70【实测】 |
| 未收录 | 30/100【实测】 |

距 95% 差 25 个点，**当前不能说搜全**。但 70% 是**下界**：【推断】名单本身有陈旧条目——例如 Torc "ML Engineer I, App Engine (CUDA)" 不在其 Greenhouse 板上（实时查 48 个职位，无此标题）【实测】；NVIDIA 5 条里按标题搜 Workday 板，其中 3 条没找到【实测，搜索可能不完整】。陈旧条目数量没有逐条核实，真实覆盖率在 70% 到约 80% 之间【猜测】。

另外 jobright 数据分析名单里不少是 analyst/外包/需要安全许可（"Cleared"）的岗位，是否真"适合她"本身可疑【推断】，会把分母拉大。

## 4. 未收录明细（30 条）

| 原因 | 条数 | 例子 | 标签 |
|---|---|---|---|
| A. 公司不在 watchlist（catalog 中完全没有，或只通过提醒/名单出现，没抓过官方板） | 17 | Tata Consultancy、Omnicom、L.E.K.、Stamp、Sixtyfour、Centene、Concord、American Express、Capgemini、BNY、American Honda、Eaton、General Dynamics IT、Annapurna Labs(Amazon)、Gauntlet、B4Corp、Military Spouse Jobs | 实测（公司级）；"该公司确有此职位在线"未逐一核实 |
| B. 公司在 watchlist，但此职位没进 catalog | 13：NVIDIA 5、Adobe、AIG、Mastercard、Booz Allen、GE Vernova、Salesforce、Thomson Reuters（以上均为 **Workday**），Torc（Greenhouse） | NVIDIA "AI and ML Infra Software Engineer, GPU Clusters" | 实测：12/13 是 Workday。成因【推断】：Workday 只做有界关键词搜索（`workdayQueries` 8 个词，每词有页数上限，fetch.ts:76-94），搜不到的职位永远不进来；Torc 一条【实测】是名单陈旧 |
| C. 发布晚于上次运行 | 0 | 最新名单日期 Nov 01 < 本轮开始 2026-11-02 03:42Z | 实测 |

收录但被拒的 13 条，大多合理（`role.non_engineering` 7、`role.research_not_ml` 2、`auth.citizenship` 1、`model.not_fit` 1）。**疑似错拒 2 条**【推断，标题明显匹配 ML 新卒】：NVIDIA "Deep Learning Performance Architect - New College Grad 2027" 被 `level.senior` 拒（【实测】catalog 原因文字是"Senior, staff, lead or manager title"，标题里没有 senior，【猜测】是 "Architect" 触发）；ServiceNow "New Grad 2027: Software Engineer (AI/ML)" 被 `role.out_of_scope` 拒。

## 5. 修复排序（按预计消除的未收录数）

1. **扩大 watchlist 公司面（约 17 条，占未收录 57%）**：来源【推断】——把本次 A 类公司加进去，并让 github 名单/jobright 的公司名自动发现其官方板（流水线已有"通过名单链接发现板"，但 jobright/vanshb03 未接入）。把这两份名单加入 `github:` 段即可直接带来约 30 条候选；但它们就不再独立，抽样要换新名单。
2. **Workday 抓取改为枚举全部职位或按地区/日期分页（约 12 条，40%）**：对 NVIDIA、Adobe、Salesforce 等大板，先用 `postedOn`/地点 facet 翻页取近 30 天全量，而非关键词搜索。【猜测】能消除大部分 B 类；需要核实各板单次翻页上限。
3. **修 triage 错拒（2/70 ≈ 3% 的收录职位）**：检查 `level.senior` 对 "Architect" 的规则，以及 AI/ML 标题的 `role.out_of_scope`。【推断】小改动、风险低，可用本次两条做回归测试。
4. **度量本身**：加一类"官方板全量"样本（对 5-10 家随机选的公司直接取 Greenhouse/Lever/Ashby 全部近 30 天职位，按 JobKey 对 catalog），可以测 24h 时效，也不受名单陈旧影响。本次未做。

## 6. 局限

- 名单陈旧条目未逐条核实，70% 偏低估计（见上）。
- 匹配用规范化公司+标题，模糊匹配阈值 Jaccard 0.75，并排除 senior/海外的 catalog 行；可能有少量误判（本次人工复核了 NVIDIA、Torc 各几条）。
- 样本只来自 vanshb03 与 jobright 两家（未命中 16 条来自 vanshb03、14 条来自 jobright），且 jobright 偏小公司/外包；对"大公司官方板"的覆盖率代表性弱。
- 未使用 Gmail（提醒已被摄入，不独立）。
