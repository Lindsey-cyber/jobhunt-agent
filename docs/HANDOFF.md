# Handoff prompt for the next agent session

继续开发 jobhunt-agent v2：一个帮我（Lanxin "Lindsey" Ma）自动找 New Grad / Entry-Level AI/ML 岗位并投递的 agent。

- 代码在私有仓库 Lindsey-cyber/jobhunt-agent 的 `v2` 分支（TypeScript + Playwright），在这个分支上继续提交和推送。`main` 分支是旧的 Python 版，只作参考：`jobhunt/feeds.py`、`catalog.py`、`identity.py`、`criteria.py` 里的职位发现逻辑和 `docs/SEARCH_REPORT_2026-10-28.md` 的真实搜索结果值得借鉴，其余不用管。
- 先读 `CLAUDE.md`、`ARCHITECTURE.md` 和 `.claude/skills/`。设计原则来自 Lauren Tan 的 pstack：先让 agent 能自己验证，再放开自主；每纠正一次就把它沉淀到代码、类型或测试里；关键判断用独立的审核 agent（不同模型、只看证据）。
- 系统按 Lauren 的组织方式搭：总管（只排程和汇总，以后常驻 VPS）→ 发现/投递/Outreach 三个经理 → 工人 + 独立验证者。
  验证者必须换模型或换 prompt，只看证据、不看工人的说法；能用代码判对错的环节（读回核对、链接、去重、提交确认）一律用代码。
- 第一阶段就要有筛选审计 agent：抽查"通过"和"被排除"的岗位，盲评后算出误筛率和漏筛率，写进报告。
- 每日清单里我的批准/驳回要存成带标签的评测集；改筛选规则、答题 skill 或换模型前，先在评测集上跑分，不降才上线。
- 每个环节单独设信任等级，凭审计数据升级，审计出问题自动降回"等我确认"。审计发现的错误要沉淀成规则、测试或适配器修复。
- 第一阶段先在云会话里跑通总管和经理的骨架；我开好 VPS 后再搬过去常驻（Claude Agent SDK 或 Claude Code 无交互模式 + systemd，Gmail 改用 Gmail API 只读授权，Dashboard 走 SSH 隧道）。
- 我的真实资料在 `data/`（profile、answers、简历），已提交。不填紧急联系人、薪资、推荐人。
- 当前阶段是第一阶段：真实搜索测试，`trust: draft`，不自动提交。要做的：
  1. 多渠道职位发现：美国中大型科技公司和 AI 公司的官方 ATS（Greenhouse、Lever、Ashby、Workday）长期监控名单、New Grad GitHub 仓库的增量更新、Gmail 里 LinkedIn/Glassdoor/Handshake/Indeed 的职位提醒（会话里有 Gmail 连接器；VPS 上以后改用 Gmail API OAuth）。
  2. 来源归因：一个岗位一条记录，但保留所有发现来源及时间；只按 ATS Job ID 或官方链接合并，绝不只按公司加职位名合并。
  3. 按 New Grad / 0–2 年 + 目标岗位类型筛选。签证担保没写就不过滤，明确写了不担保才排除。
  4. 出报告：各渠道数量、独有数、重复率、近 7 天和 30 天的新岗位、抽样验证官方链接，附 CSV 和 Dashboard。
  5. 小公司单独建 Outreach 队列：岗位、招聘帖、公开的招聘负责人信息，带来源和可信度。只收集、只起草，不发送。
- 没有权限或 Key 的来源就跳过，并在报告里写明；绝不用假数据冒充真实结果。解决不了的问题放进每日清单（`jh pending`），我每天结束时看。
- 报告做完先发给我看，搜索质量确认后再做自动投递（Lever、Ashby、Workday 适配器）和 VPS 部署。

## 进度（2026-10-28 会话）

已完成（第一阶段骨架）：

- 发现：`config/watchlist.yaml` 长期监控 106 个官方 Board（Greenhouse 53、Lever 4、Ashby 24、Workday 25，全部当日实测可访问），3 个 New Grad GitHub 列表（Simplify 用其机器可读的 `listings.json`），HN Who is hiring，Gmail 提醒（LinkedIn、Glassdoor、Handshake、Indeed）。第三方列表里出现的 Greenhouse/Lever/Ashby 链接会顺藤摸瓜抓取该公司官方 Board。
- 来源归因：`src/discover/identity.ts` 只按 ATS Job ID（含 `gh_jid`）、Lever/Ashby UUID、Workday 租户+需求号、平台 ID 或规范化官方链接合并；`data/discovery/catalog.jsonl` 保存每个来源的首次和最后发现时间。
- 筛选：`src/discover/triage.ts`，每个结论带规则 id；签证没写不过滤，官方明确不担保才排除。
- 审计：`jh daily` 抽 110 个盲样本，独立审核 agent（另一个模型，只看 `brief.md` + `blind.jsonl`）判定，`jh audit score` 用代码对照隐藏答案键算误筛率/漏筛率，分歧进每日清单，超过 10% 自动降级。
- 评测集：`jh label` 存候选人的决定（带当时的证据），`tests/eval.test.ts` 让 `npm run check` 在规则变差时失败。
- 总管/经理骨架：`src/org/coordinator.ts`；流程写在 `.claude/skills/daily-discovery/SKILL.md`。

审计结果（同一天三轮，每轮新的盲样本 + 新的 Sonnet 审核实例，代码打分）：误筛率 27.0% → 16.7% → 6.1%（n=37/30/33），漏筛率 5.0% → 0% → 0%（n=20）。每轮的分歧都已变成规则修复和测试（`tests/discover.test.ts` 里按轮次标注）。第三轮后又修了两处（标题里的安全许可、41 字符长的不担保句子），下一次 `jh daily` 生效，尚未单独审计。筛选环节信任等级保持 `confirm`。

已知局限：Gmail 邮件是 agent 按机械规则手抄到 `data/inbox/`，5/5 抽查与原邮件逐条一致，但不是程序直接保存；VPS 上改用 Gmail API 后消除。Workday 只做关键词搜索。仅第三方来源的匹配（434/535，多为 TikTok/ByteDance 等无公开 ATS API 的公司）没有官方发布日期。

下一步：

1. 等候选人看报告、回答每日清单里的问题（Data Scientist 是否算目标岗位）并批准/驳回匹配，形成第一版评测集，然后 `jh eval --record`。
2. 搜索质量确认后：Lever、Ashby、Workday 申请适配器（`add-ats-adapter` skill）。
3. VPS：systemd timer 跑 `jh daily`；Gmail API 只读 OAuth 替换会话里的连接器复制；审核 agent 改为 API 调用（同样只给 brief + blind）；Dashboard 走 SSH 隧道。

## 进度（2026-10-28 第二段）

- 候选人的决定已落地：Data Scientist 算目标；只有严格要求 3 年以上才排除；2027 届岗位照投；不投 OpenAI、Anthropic、TikTok、Google、Palantir（`data/search.yaml`，在筛选之后单独排除，不影响评测集）。60 个标签进了评测集，基线 precision 97.8%、recall 100%。地点填 New York（`data/answers.yaml`）。新简历已替换，GPA 改为简历上的 3.71/3.82。
- 审计第 4 轮：误筛 5.9%（n=34），漏筛 0%（n=20）。GPT-5.5 对同一样本复核：误筛 7.5%（n=40），两个审核者在都能判断的 87 个岗位上一致 82 个。
- 审核 agent 可走 Claude API 或 OpenAI（`JH_AUDIT_PROVIDER`）；Anthropic 账户目前余额不足，暂用 gpt-5.5。密钥只在 `~/.config/jobhunt/env`（VPS 上是 `/etc/jobhunt/env`），不进仓库。
- Gmail API（只读、PKCE）：`jh gmail auth` 两步授权，`jh daily` 自动拉提醒邮件。等候选人完成一次授权。
- VPS：`deploy/`（install.sh、每日 systemd timer、127.0.0.1 Dashboard）和 `docs/DEPLOY.md`；在临时仓库里完整彩排过一次 daily.sh（check → daily → 提交推送）。云会话出不了 22 端口，安装需要候选人在 VPS 上跑一条命令。
- Greenhouse 适配器第一次在真实页面上验证（Scale AI，草稿不提交），修了 7 处只有真实页面才会暴露的问题。Lever 适配器基于真实页面完成，因为提交按钮带 hCaptcha，代理永远不点提交，由候选人自己点。
- Ashby：真实页面已抓取（`fixtures/ashby/real-quora-40659fe7.html`），适配器未写。在真实申请表上做交互探测被会话的权限分类器拦下（视作真实交易），需要候选人放行后才能做在线草稿验证。Workday 申请需要注册账号，按规则必须由候选人决定。

## Pause point (2026-10-28, ~16:40 UTC)

- Apply batch 2 (`.scratch/batch2.log`, local only) was mid first pass: 4 confirmed (Nuro ×3, Together AI), Scopely
  submitted but recorded unconfirmed (after-submit page says "Application Sent!"; the candidate resolves it), 23 held.
  The chain then runs `jh draft` and a second `jh apply-approved` with every fix pushed today.
- Next: deploy to Hetzner CAX11 (37.27.217.240, Ubuntu 24.04 ARM64) per docs/DEPLOY.md. Outbound SSH is blocked from
  the cloud session, so the candidate runs install.sh herself or attaches the VPS through Remote Control.
- Open for the candidate: Lyft (certification, employment section), Anduril (export controls), zip code (not in profile).
