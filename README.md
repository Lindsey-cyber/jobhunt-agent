# jobhunt-agent

一个帮你投简历的 agent：只有在能证明这份申请填对了的时候才会提交。

## 快速开始

```bash
npm install
mkdir -p data && cp examples/profile.example.yaml data/profile.yaml && cp examples/answers.example.yaml data/answers.yaml && cp examples/config.example.yaml data/config.yaml
# 把简历放到 data/resume.pdf，然后改 data/profile.yaml
npm run -s jh -- doctor
npm run -s jh -- apply <Greenhouse 职位链接>            # 默认只填不交，留证据
npm run -s jh -- apply <同一个链接> --approve            # 你看过证据后，批准提交
npm run -s jh -- pending                                 # 哪些卡住了，各缺什么
```

## 找岗位（第一阶段）

```bash
npm run -s jh -- daily --inbox data/inbox/<日期>   # 总管：多渠道发现、筛选、审计抽样、待批准队列、Outreach、报告
npm run -s jh -- audit score <verdicts.jsonl>      # 独立审核 agent 盲评后打分，自动调整筛选环节信任等级
npm run -s jh -- pending                           # 每日清单：待你批准的岗位、审计分歧、失败来源
npm run -s jh -- label <清单 id> fit|not_fit        # 你的批准/驳回，存成评测集
npm run -s jh -- eval                              # 改规则前后在评测集上跑分，不降才上线
```

监控名单在 `config/watchlist.yaml`，报告和 Dashboard 在 `docs/reports/<日期>/`。流程见 `.claude/skills/daily-discovery/SKILL.md`。

## 它保证什么

- 发给雇主的每个事实都来自 `data/profile.yaml`、`data/answers.yaml` 或简历。没有就停下，不编。
- 薪资、紧急联系人、推荐人、法律声明永远不自动填。签证、身份、EEO 这类敏感问题只认精确答案。
- 提交前把每个字段从页面读回来核对，必填项一个都不能空。
- 同一个职位绝不投两次；点了提交但没看到确认页的，绝不自动重试。
- 每次运行都在 `data/runs/` 留下计划、读回值、截图和判定理由。

信任等级、自动提交的 ATS 列表、每日上限都在 `data/config.yaml`，只有你能改。

## 开发

```bash
npm run check                       # 类型检查 + 全部测试（含浏览器端到端）
npx tsx src/dev/fixture-server.ts   # 本地模拟的 Greenhouse 申请页
```

设计见 [ARCHITECTURE.md](ARCHITECTURE.md)，agent 规则见 [CLAUDE.md](CLAUDE.md)，skills 在 `.claude/skills/`。
