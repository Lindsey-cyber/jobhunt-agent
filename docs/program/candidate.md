## 四、候选人的决定（以此为准）

**投什么**（`data/policy.yaml`，已核对）
- 排除 47 家：OpenAI、Anthropic、TikTok、ByteDance、Google、Palantir，加头部量化公司（名单里 D. E. Shaw 有两种写法，实际 40 家）。
- 不投纯高级岗；混合级别（"Senior/Software Engineer"、"[Junior / Senior]"、"Senior / Engineer II"）照投。"Member of Technical Staff" 不是级别。
- 只投 2023 年以来有 H-1B 申请记录的公司；查不到或名字对不上的不投，但留在库里。
- 只招某个学校学生的岗位不投（即使她以前标过适合）。
- 符合规则的匹配直接投，不逐个批准（`approveMatches: true`）。
- 投递顺序：档位 A→B→C，同档按发布时间从新到旧。
- 个性化问答题（Why X、项目经历、"让我们印象深刻的事"）**不写**，留给她；同一家公司她写一段可以放行多份。
- 要求上传成绩单的岗位：放进她的手动清单最后（`docs/transcript-required.md`），不问她。
- 每日上限 500（她授权改的）。

**她 2026-11-02 最后一轮的新决定，还没落到代码里（接手后第一批做）**
1. **30 天不是过滤条件，是优先选项。** 超过 30 天的岗位也留在库里；容易投的照样投（排在 30 天内的之后）。现在 `eligibility.ts` 把超过 30 天的直接判为不可投，要改。
2. **Analytics Engineer 不要了**，根本对不上：从筛选范围里去掉（`src/discover/triage.ts` 的 `DATA_SCIENCE`），删掉 `policy.yaml` 的 `applyLast`。
3. **种族、代词**：选项里有"不愿透露"就选它；**只有在没有"不愿透露"时**，种族选 Asian，代词选 She/Her。（性别同理：没有不愿透露时选 Female，已实现。）
4. **agent 要自己研究能自动投哪些别的 ATS。** 已知：Ashby 提交被隐形验证码挡住（截图显示点提交后停在表单）；Workday 每家要注册账号、表单长、费 token；Lever 未试。先研究、拿证据，再提方案。
5. **搜索还没证明搜全了。** 要定义"搜全"的可检验标准并测量，例如拿独立来源（她邮箱的 LinkedIn/Glassdoor 提醒、新毕业生列表）抽样，看我们的库覆盖了多少，查漏的原因。

**怎么答题**（`data/profile.yaml`、`data/answers.yaml`、`src/plan/rules.ts`）
- 工作许可：能在美国工作（F-1 OPT）；将来需要 sponsorship。"无需 sponsorship 就能工作吗"答否。
- 国籍：中国。出口管制题如实答（名单里有中国就答是）。
- 薪资期望 $100K–$150K；"期望是否在范围内"答是；绝不填过去的薪资。
- 最早入职 2026-11-15；月份选项选 November 2026。
- 地点：美国任何地方都行，能到岗、能混合办公、愿意搬家；城市写 New York（不写 Flushing）；偏好办公室：波士顿 → 湾区 → 纽约。
- 出差：多少都行（选最多的那档）。
- 经验/技能是非题答是；"几年经验"填 2（选包含 2 年的那档）。
- 政府官员、亲属、竞业协议、某公司的客户/合作方/竞争对手：都没有（她现在的公司 Arborphy AI 是教授朋友开的小公司）。
- 以前在某公司工作过吗：除了简历上的 4 家，都没有。
- 西语裔否；退伍军人否；残障否。
- 允许代为同意：如实声明、仲裁、面试规则、录音、数据处理和隐私、保密、日后联系。手写签名和自由文本声明留给她。
- 研究方向关键词：按简历（多模态融合、视觉基础模型表征分析、神经影像自监督去噪、多智能体推理、机器人实时视觉）。

**不做**：冷邮件和中小公司投递（第 2 阶段）；每天自动定时（等系统可信）；LinkedIn/Glassdoor 网站上的自动操作。

**她要处理但没回复的**：投错工作许可的两份 NewsBreak（10/28、10/30，上一个 agent 之前的规则错误）怎么办，见 `docs/STATUS.md` 开头。


## 一点五、候选人刚收到的拒信（2026-11-02，待她决定）
Anduril 拒信（Software Engineer- Machine Learning，greenhouse 5248869007，11-02 02:39 UTC 投出）："Based on your responses to the export control/security clearance questionnaire … cannot move forward"。答案本身如实：出口管制"U.S. person"题按 `src/plan/rules.ts` 的 export-control 规则答"都不是"，安全许可资格答"否"（她是中国籍、F-1 OPT）。问题是系统投了一个注定被拒的岗位：Anduril 共投出 9 份（10-28 至 11-02，均在 v4 之前），其余大概率同样被拒。
建议（需她拍板）：表单或岗位原文要求"U.S. person / 出口管制许可 / 安全许可资格"时，判为不可投（eligibility 一条原因，进"不投"），而不是如实填完照投。实现位置：`src/discover/eligibility.ts` + triage 读岗位原文；表单层面在 `src/run/apply.ts` 提交前，若计划里有这类题且答案为否，改为 hold 并标记岗位不可投。

## 一点六、10-27 以来的拒信（候选人邮箱，2026-11-02 核对）
共 20 封、17 家。值得注意的：Waymo"已达申请数上限"（系统投了 7 份，最后一份未被审）；Anduril 两封出口管制/安全许可（共投 9 份）；iTradeNetwork"只要公民/绿卡、不办签证"；BlackEdge Capital"不提供签证协助"（有 H-1B 记录也不代表该岗位办签证）；Accenture Federal Services"根据岗位要求"（联邦承包商，系统投了 14 份）；CHAOS Industries（国防，投 2 份，通用措辞）。Apple 那封是她自己投的，模板措辞问题，与本系统无关。其余 13 封为常规拒信。
三个系统性问题，交给下一个 agent：(1) 要求美国身份的岗位（国防、联邦承包商、明确不办签证）没被拦，应在 eligibility 里成为不投原因；(2) 同一公司投递数没有上限，应在 policy 里设每家公司上限（Waymo 触发了对方上限）；(3) 公司有 H-1B 记录 ≠ 岗位办签证，需读岗位原文与表单题。
