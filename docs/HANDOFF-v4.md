# 交接：jobhunt-agent v4（2026-11-02）

给下一个 agent。候选人对这一轮的结果不满意，要重新搭多 agent 框架。本文写清楚：现在有什么、没做完什么、这一轮哪里做错了、建议怎么做。先读这份，再读 `CLAUDE.md`、`docs/program/notes.md`（追踪文件，含复盘）、`docs/decisions.tsv` 最后 40 行。候选人的决定以 `data/policy.yaml`、`data/profile.yaml` 和 `docs/HANDOFF-v3.md` 第四节为准（第四节的 5 条新决定已全部落进代码，见下）。

## 一、现状（都已合入 `v2` 并推送，`npm run check` 43 个文件 570 个测试通过）

**投递：暂停。** 代码里拦住：`src/run/apply.ts` 提交前要求阶段门 1c 通过、且该岗位按当前规则可投（`eligibleNow`），每个填入的值必须有来源。1a、1b 都没通过，所以任何路径都不会提交。

**候选人的四步**（她的原话："这事儿就四步"）：
| 步 | 现状（数字来自 `jh today` / `jh coverage`，最后一次完整搜索 2026-11-02 12:59 UTC） |
|---|---|
| 1 搜全 | 来源登记表达标（无"未做"，推迟的都写了理由）；匹配岗位有日期 84.1%（标准 90%）；第三方抽样中大型公司 76/100 在库（标准 95%，但这把尺子不可靠，见复盘） |
| 2 筛准 | 未开始。盲审误选 10.5%（标准 10%）；抽样里在库的 56 个，被我们自己的规则拒掉 22 个（39%）——这是最大损失 |
| 3 投递跑通 | 暂停 |
| 4 两份名单 | 每日页面有她手动投的名单（按 ATS 列出差在哪）；报告里有小公司外联名单初版 |

**这一轮新增的能力**：阶段门（`src/discover/gates.ts`，`jh today` 显示）；`jh coverage`（独立列表抽样、跳过已关闭条目、只在完整读过该板且编号不在时才判下架、按公司规模分档）；监控名单重建（`scripts/rebuild-watchlist.ts`，不碰 H-1B 缓存）；来源登记表（`src/discover/sources.ts`）；新抓取器：SmartRecruiters、Oracle HCM、Amazon、Eightfold（Netflix、Eaton、Qualcomm）、Jibe（AMD）、IBM、Atlassian；Workday 全量读到底（不再按日期提前停）；各渠道发布日期、已下架岗位有证据才标关闭；所有抓取器共用一个岗位范围判断（`inScopeTitle`）；公司别名表；提交前查资格/来源；严格 schema；HANDOFF-v3 第四节 5 条决定（30 天只排序、不投 Analytics Engineer、种族/代词规则、ATS 调研 `docs/research/ats-automation.md`、搜全调研 `docs/research/search-coverage.md`）。

**没做完、已停掉的**：第三次完整搜索（停在中途，未写入）；"按公司验收第 1 步 + 两条统一结构检查"（刚派出就停了，无提交）。W5 规则清单剩余项、W8 文档清理（`docs/HANDOFF*.md` 等旧文档与代码矛盾）、`jh selftest` 都没做。

**候选人已决定、不要再问**：投错的 66 Degrees 两份、NewsBreak 两份不处理；Amazon 她已自己投完；Workday 难搞就放进她的手动名单；只做搜索，投递先别管。

## 一点五、候选人刚收到的拒信（2026-11-02，待她决定）
Anduril 拒信（Software Engineer- Machine Learning，greenhouse 5248869007，11-02 02:39 UTC 投出）："Based on your responses to the export control/security clearance questionnaire … cannot move forward"。答案本身如实：出口管制"U.S. person"题按 `src/plan/rules.ts` 的 export-control 规则答"都不是"，安全许可资格答"否"（她是中国籍、F-1 OPT）。问题是系统投了一个注定被拒的岗位：Anduril 共投出 9 份（10-28 至 11-02，均在 v4 之前），其余大概率同样被拒。
建议（需她拍板）：表单或岗位原文要求"U.S. person / 出口管制许可 / 安全许可资格"时，判为不可投（eligibility 一条原因，进"不投"），而不是如实填完照投。实现位置：`src/discover/eligibility.ts` + triage 读岗位原文；表单层面在 `src/run/apply.ts` 提交前，若计划里有这类题且答案为否，改为 hold 并标记岗位不可投。

## 一点六、10-27 以来的拒信（候选人邮箱，2026-11-02 核对）
共 20 封、17 家。值得注意的：Waymo"已达申请数上限"（系统投了 7 份，最后一份未被审）；Anduril 两封出口管制/安全许可（共投 9 份）；iTradeNetwork"只要公民/绿卡、不办签证"；BlackEdge Capital"不提供签证协助"（有 H-1B 记录也不代表该岗位办签证）；Accenture Federal Services"根据岗位要求"（联邦承包商，系统投了 14 份）；CHAOS Industries（国防，投 2 份，通用措辞）。Apple 那封是她自己投的，模板措辞问题，与本系统无关。其余 13 封为常规拒信。
三个系统性问题，交给下一个 agent：(1) 要求美国身份的岗位（国防、联邦承包商、明确不办签证）没被拦，应在 eligibility 里成为不投原因；(2) 同一公司投递数没有上限，应在 policy 里设每家公司上限（Waymo 触发了对方上限）；(3) 公司有 H-1B 记录 ≠ 岗位办签证，需读岗位原文与表单题。

## 二、这一轮哪里做错了（按代价从大到小）

1. **优化了尺子，没有优化目标。** 第 1 步用第三方列表抽样测覆盖率，6 轮在 67%–87% 之间来回跳（67→74→80→87→76）。多数轮次在修测量方法（过期条目、已关闭标记、跳转链接、规模分档、样本量），而不是搜索本身。尺子不稳，指标就不收敛。
2. **度量单位选错。** 她要的是"目标公司每天新发的岗位都看得到"。直接的检验是按公司：每家目标公司（办 H-1B 的中大型 AI/ML 雇主）今天的官方招聘列表是否完整读到。第三方抽样应只做辅助审计。
3. **没有每轮复盘。** 每轮只看审核过没过，不看结果有没有更接近目标；数字连续不收敛还在继续派活。复盘规则已补进 `docs/program/notes.md`，但我自己没有及时执行。
4. **同类错误没有沉淀成结构。** "同一岗位存成两份"出现 3 次（Amazon、iCIMS、AMD），"把还在的岗位误判成下架"出现 4 次，每次都靠审核者人工抓到。结果几乎每个工人第一轮都被退回，审核与返工让成本翻倍。第二次出现时就该写成对所有抓取器统一生效的测试或类型。
5. **任务书切分造成大量返工和冲突。** 例如阶段门只拦了批量命令（`jh apply` 直接绕过）；禁止工人改接线文件，导致新抓取器没接进搜索；多个并行工人改同一批文件（`src/sources/fetch.ts`、`config/watchlist.yaml`），合并冲突频繁。
6. **没有先问"跑完要做什么决定"就开长任务**（完整搜索），以及对时长的估计没看数据（说"一两个小时"，实际 22 分钟）。
7. **大头放在了小头后面。** 最大的损失是第 2 步的误拒（22/56），我却一直在打磨第 1 步的漏搜（14 个）。

## 三、给下一个框架的建议

- **每一步先写一个可直接检验的验收标准，再派活；验收标准用"东西本身"，不用间接抽样。** 第 1 步：目标公司清单 × 今天是否完整读到（H-1B 申请量加权 ≥95%）；读不了的公司直接进她的手动名单，不逐家写抓取器。
- **先把反复出现的错误类写成统一检查，再扩展抓取器**：所有抓取器的岗位编号 = `jobKey(该岗位自己的链接)`；"下架"只能由"完整读过该板"的结果产生（用类型保证）。
- **按文件归属切任务，一个区域一个负责人**，避免并行改同一文件。
- **每轮结束写一行复盘；连续两轮目标数字不收敛就停，回到前提。** 给每个单元设 token 预算。
- **下一步最值得做的是第 2 步**：查清抽样里那 22 个误拒来自哪些规则（`data/coverage/2026-11-02.json` 里 cause 为 "filtered by triage rule …" 的条目）。
- 审核者有用（这一轮抓到的都是真问题：会投错、会重复、会虚高），但应该把审核清单变成测试，而不是每次让模型重读。

## 四、关键文件

| 做什么 | 在哪 |
|---|---|
| 追踪文件（规则、四步现状、评分卡、复盘） | `docs/program/notes.md` |
| 决策记录（只追加） | `docs/decisions.tsv` |
| 阶段门 | `src/discover/gates.ts`，`jh today` 的"阶段门"一节 |
| 覆盖率抽样 | `src/discover/coverage.ts`、`src/sources/coverage.ts`、`jh coverage`、`data/coverage/` |
| 来源登记表 | `src/discover/sources.ts` |
| 监控名单 | `config/watchlist.yaml`（含 `pending:`、`aliases:`、`aggregators:`），重建脚本 `scripts/rebuild-watchlist.ts` |
| 唯一提交入口 | `src/run/apply.ts` |
