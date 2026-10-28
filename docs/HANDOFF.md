# Handoff prompt for the next agent session

继续开发 jobhunt-agent v2：一个帮我（Lanxin "Lindsey" Ma）自动找 New Grad / Entry-Level AI/ML 岗位并投递的 agent。

- 代码在私有仓库 Lindsey-cyber/jobhunt-agent 的 `v2` 分支（TypeScript + Playwright），在这个分支上继续提交和推送。`main` 分支是旧的 Python 版，只作参考：`jobhunt/feeds.py`、`catalog.py`、`identity.py`、`criteria.py` 里的职位发现逻辑和 `docs/SEARCH_REPORT_2026-10-28.md` 的真实搜索结果值得借鉴，其余不用管。
- 先读 `CLAUDE.md`、`ARCHITECTURE.md` 和 `.claude/skills/`。设计原则来自 Lauren Tan 的 pstack：先让 agent 能自己验证，再放开自主；每纠正一次就把它沉淀到代码、类型或测试里；关键判断用独立的审核 agent（不同模型、只看证据）。
- 我的真实资料在 `data/`（profile、answers、简历），已提交。不填紧急联系人、薪资、推荐人。
- 当前阶段是第一阶段：真实搜索测试，`trust: draft`，不自动提交。要做的：
  1. 多渠道职位发现：美国中大型科技公司和 AI 公司的官方 ATS（Greenhouse、Lever、Ashby、Workday）长期监控名单、New Grad GitHub 仓库的增量更新、Gmail 里 LinkedIn/Glassdoor/Handshake/Indeed 的职位提醒（会话里有 Gmail 连接器；VPS 上以后改用 Gmail API OAuth）。
  2. 来源归因：一个岗位一条记录，但保留所有发现来源及时间；只按 ATS Job ID 或官方链接合并，绝不只按公司加职位名合并。
  3. 按 New Grad / 0–2 年 + 目标岗位类型筛选。签证担保没写就不过滤，明确写了不担保才排除。
  4. 出报告：各渠道数量、独有数、重复率、近 7 天和 30 天的新岗位、抽样验证官方链接，附 CSV 和 Dashboard。
  5. 小公司单独建 Outreach 队列：岗位、招聘帖、公开的招聘负责人信息，带来源和可信度。只收集、只起草，不发送。
- 没有权限或 Key 的来源就跳过，并在报告里写明；绝不用假数据冒充真实结果。解决不了的问题放进每日清单（`jh pending`），我每天结束时看。
- 报告做完先发给我看，搜索质量确认后再做自动投递（Lever、Ashby、Workday 适配器）和 VPS 部署。
