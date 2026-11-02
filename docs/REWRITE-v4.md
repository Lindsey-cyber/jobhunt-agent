# 重写方案：按 Lauren Tan 的「先建信任，再并行」来做

写于 2026-11-02，基于 `v2` 上 HANDOFF-v4 那一版。这是第一步：只出方案，不动 `src/`。等候选人给出其他 skill 和资源，并选定「新 repo 还是原地重写」以后再开工。

## 目标

候选人拿到一份能办 H-1B 的工作。用她自己的话说，「这事儿就四步」：搜全、筛准、投出去、两份名单（她自己投的、小公司外联的）。整个系统要做到：她不用逐条检查，也能相信它的结果。

## 视频的逻辑，翻译成投简历

| 视频里的概念 | 放到投简历上 |
|---|---|
| 信任曲线：人盯着每个输出 → agent 自己验证 → 无人值守自动合并 | 每个环节、每个 ATS 分别走三级：她看过证据才放行 → agent 自己验证 → 无人值守。提交申请撤不回来，比合并 PR 更严，所以只有能用代码核对证据的地方才升到无人值守 |
| Verification：agent 自己跑真实应用、截图、判断改动生效没有 | 填完从页面读回每个字段和计划逐项比对，提交后查确认页和确认邮件；搜索做完后，按公司检查官方招聘列表今天是否完整读到。这些检查都写在代码里，不交给 agent 自己判断 |
| Feature Map | **ATS 地图**：每个 ATS 的字段、上传方式、验证码、要不要注册账号、确认页长什么样，配一份抓下来的真实页面 fixture。**公司地图**：每家目标公司的官方招聘入口、用哪个 ATS、能不能读全 |
| pstack skills / playbooks | 已经在 `.claude/skills/`。业务 skill 按四步各一个，另加「修 ATS」「验证」 |
| 用 eval 维护 skill | 她的筛选标注、问题→事实映射、已提交的答案、**拒信**都是 eval 集。改规则、改 prompt、换模型之前先跑分，分数不能降 |
| Local → Cloud | 本地（或单个会话里）连续几天自检通过以后，再上定时任务，由她点头 |
| Dune：把最短路径变成正确路径 | 用类型和目录结构让常见错误写不出来，见下面「新架构」 |
| 五层信任金字塔 | 修正优先往上层放：代码结构 > CI 和测试 > CLAUDE.md 规则 > skill > 人工检查 |
| 每纠正一次就往高层沉淀 | 同一类错出现第二次，就加一个测试或类型约束 |

## 上两轮哪里违背了这套逻辑

旧代码已经借用了视频里的词（总协调、经理、工人、审核、信任等级），测试也是绿的（43 个文件、570 个测试）。但 HANDOFF-v4 记下的失败，对到视频里，都属于同一个病：**信任压在金字塔下面两层（审核者人工抓、文档提醒），最上面的代码结构那层没建起来。**

| HANDOFF-v4 记下的失败 | 违背了视频的哪一条 | 重写时怎么从结构上消掉 |
|---|---|---|
| 同一岗位存成两份（出现 3 次），在架岗位误判成下架（出现 4 次），每次都靠审核者人工抓到 | 每纠正一次就往高层沉淀 | `PostingId` 只能由 `jobKey(岗位自己的链接)` 构造；「下架」只能由 `CompleteBoardRead` 类型产生。所有抓取器继承同一套契约测试 |
| 覆盖率测了 6 轮不收敛，大部分轮次在修尺子 | Verification 要验证东西本身，不验证代理指标 | 第 1 步按公司验收：目标公司 × 今天是否完整读到；第三方抽样降级成每周审计 |
| 最大的损失在第 2 步：抽样里在库的 56 个，有 22 个被自己的规则拒掉 | eval 先行 | 每条拒绝规则都带 id，误拒按规则归因，`npm run check` 跑误拒率 |
| 投出了注定被拒的申请（Anduril 出口管制、Accenture Federal、Waymo 撞上每家公司申请数上限、BlackEdge 不办签证） | 结果要回流成验证 | 拒信也是 eval：每封拒信归到一条不投原因（要求美国身份 / 每家上限 / 岗位写明不办签证），加进 policy 以后，用历史拒信回放验证 |
| 阶段门只拦了批量命令，`jh apply` 绕过去了 | 把最短路径变成正确路径 | 只有 gate 能构造 `Submittable`，`adapter.submit()` 只接受 `Submittable`。不管从哪条路径进来都绕不过去 |
| 并行工人改同一批文件，频繁冲突；任务书禁止改接线文件，新抓取器就没接上 | 多 agent 的前提是边界清楚 | 每个来源、每个 ATS 一个目录、一个负责人；注册表由目录自动生成，不需要手改接线文件 |
| 答题靠 `rules.ts` 949 行逐个措辞写的正则，和 v3 的「事实」两套逻辑并存 | 一个领域只有一个模型 | `Answer` 必须带 `FactId`，正则那条路删掉 |
| 4 份 handoff、几十份过期清单 | 第 5 层（文档）最不可靠 | 一个每日页面加一份决策记录；其余由代码生成，或者删掉 |

值得保留的（搬过去，或者当验收对照）：`data/` 全部（不改）；各 ATS 的 `extract.browser.js`、真实页面 fixture 和 ATS 地图；所有抓取器（SmartRecruiters、Oracle HCM、Amazon、Eightfold、Jibe、IBM、Atlassian、Workday 全量）里踩过坑的解析逻辑；「只有一个地方点提交、点之前先写 ledger」「`unconfirmed` 永不重试」「纯函数目录不碰 IO」；现有的 570 个测试，作为行为说明；HANDOFF-v3 第四节和 `docs/decisions.tsv` 里她的决定。

## 新架构：让错误写不出来

数据形状先定：

```
Company       CompanyId，H-1B 记录，官方招聘入口（ATS + 板子），规模
Posting       PostingId = jobKey(岗位自己的链接)；原文；每个来源的发现记录
BoardRead     complete | partial(原因)   ← 只有 complete 能证明某个岗位已下架
Decision      eligible | ineligible(RuleId[])   ← policy 唯一计算，每条原因都有 id
Fact          FactId → 值，来源（profile / answers / resume）
Answer        { questionId, factId, value }     ← 没有 FactId 就构造不出来
Application   planned → filled → verified → submitted → confirmed | unconfirmed | held(原因)
Submittable   只有 gate 能构造
```

```
src/
  domain/     上面这些类型和状态机（纯）
  policy/     eligibility、fit、每家公司上限（纯，只读 data/policy.yaml）
  discover/   parse、merge、triage（纯）
  answer/     问题 → 事实映射（纯）
  verify/     读回比对、gate、每日不变式（纯）
  io/sources/<来源>/   抓取器 + fixture + 契约测试
  io/ats/<名字>/       adapter + extract.browser.js + fixture + ATS 地图
  io/store/            ledger（只追加）、catalog、待办清单
  run/                 day、apply（唯一会提交的地方）
  cli.ts
```

`npm run check` 要强制的（金字塔第 1、2 层）：

1. import 边界：纯目录不能 import `io/`、`run/`、playwright、fs、fetch。
2. 每个来源目录都要有 fixture 和契约测试（PostingId 规则、下架规则、岗位范围 `inScopeTitle`），注册表由目录生成。
3. 每个 ATS 目录都要有 adapter、ATS 地图、真实 fixture、e2e 测试。
4. 每日页面的每个数字都带不变式（各状态之和 = 总数，agent 待投 = 投递队列），不成立就报错，页面不生成。
5. eval：筛选在标注集上、答题在映射集上、policy 在历史拒信上，分数低于基线就不过。

## 顺序：每一步结束时都能验证

| 步 | 做什么 | 怎么证明做完了 |
|---|---|---|
| 0 | 录下旧系统的行为当对照：每个 posting 的 eligibility 和原因、每张 fixture 表单的计划、每日页面的计数 | 录制脚本能重复跑，输出稳定 |
| 1 | `domain/` + `io/store/` + 状态模型，`jh status` 带不变式 | 和旧 `jh today` 逐项对得上，有差异就逐条解释 |
| 2 | 抓取器迁到 `io/sources/<来源>/`，套上统一契约；第 1 步改按公司验收 | 公司地图 × 今天完整读到的比例（按 H-1B 申请量加权）；读不了的公司进她的手动名单 |
| 3 | 第 2 步「筛准」：误拒按规则归因，加上拒信得出的不投原因 | 抽样误拒 ≤5%，历史拒信回放全部能被拦下 |
| 4 | `answer/` 取代正则 | 历史上出现过的题，新引擎都答对，敏感题零错 |
| 5 | apply 流水线 + Greenhouse，然后是其他 ATS | 先在 fixture 上跑 `verify-apply`，再挑一个真实岗位跑 draft |
| 6 | 自检连续几天都通过以后，再上云端定时任务 | 她决定 |

每迁完一块，就删掉对应的旧代码，不让新旧两套并存。每一轮结束写一行复盘（这一轮目标数字动了多少；修的是尺子还是东西本身）。连续两轮不收敛就停下来，回头检查前提。

## 需要候选人决定的

1. **新建 repo，还是在这个 repo 里原地重写？** 建议原地重写：`data/`、fixture 和 git 历史都在这里，按上面的顺序逐块替换。这个会话没有新建 GitHub repo 的权限；如果要新 repo，需要她先建一个空的，再加进会话。
2. **HANDOFF-v4 里待她拍板的 Anduril 类问题**：要求美国身份、出口管制许可、安全许可资格的岗位，是否一律不投？方案默认「不投」。
3. **其他 skill 和资源**：拿到以后再定第 0 步的具体范围。
