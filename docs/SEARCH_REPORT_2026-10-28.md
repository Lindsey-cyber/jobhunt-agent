# 多渠道职位搜索与来源归因实测 · 2026-10-28

公开抓取完成：**2026-10-28 07:36（上海时间）**。功能提交 `edd5326`。本报告将真实公开来源批次与另一次已授权 Gmail 导入合并；合并时没有重新核验链接，所有核验时间保留原值。历史真实观察仅用于恢复最早发现时间。

[真实抓取、原始响应附件与 ARM64 测试](https://github.com/Lindsey-cyber/jobhunt-agent/actions/runs/40602703675) · [PostgreSQL/Chromium CI](https://github.com/Lindsey-cyber/jobhunt-agent/actions/runs/40602703656)

**AUTO_SUBMIT=false；申请流程 0 次，真实申请提交 0 份。** 本轮交付止于搜索质量评估。

| 项目 | 实测结果 |
| --- | ---: |
| 原始观察记录（含重复证据） | 7980 |
| 其中公开源 / Gmail 独立线索 | 7960 / 20 |
| 强身份去重后岗位/待核实线索 | 7536 |
| 合并的重复观察 | 444 |
| 官方证据下规则匹配 | 44 |
| 匹配岗位页可访问 / 受限 | 39 / 5 |
| 待核实 / 排除 | 806 / 6686 |
| 检查链接 / 失效 / 受限 | 150 / 1 / 6 |
| 规则匹配中官方发布近 7 / 30 天 | 0 / 6 |
| 匹配岗位发布时间未知 | 22 |
| 匹配公司数 | 17 |
| 已归类中大型公司岗位 / 匹配总数 | 32 / 44（72.7%） |
| 规模未知的匹配岗位 | 12 |

公司规模标签为维护名单中的分组，未独立审计当前员工数；未知规模不等于小公司。匹配是岗位规则筛选结果，未证明个人学历、毕业时间或工作授权完全符合。页面可访问不等于申请表能成功提交。未核验 URL 不计入有效率分母。

## 渠道贡献

| 渠道 | 原始记录 | 独立 Job ID | 本轮独有 | 跨渠道共有 | 规则匹配贡献 | 有效/已判定链接 | 官方近7/30天（全部角色） |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| github_newgrad | 1662 | 1347 | 1280 | 67 | 20 | 123/124 | 0/7 |
| gmail_glassdoor | 9 | 9 | 9 | 0 | 0 | 0/0 | 0/0 |
| gmail_handshake | 5 | 5 | 5 | 0 | 0 | 0/0 | 0/0 |
| gmail_linkedin | 6 | 6 | 6 | 0 | 0 | 0/0 | 0/0 |
| hn_hiring | 28 | 28 | 28 | 0 | 0 | 0/0 | 0/0 |
| official_ashby | 1137 | 1137 | 1119 | 18 | 11 | 11/11 | 81/318 |
| official_ats | 1114 | 1114 | 1053 | 61 | 16 | 16/16 | 186/352 |
| official_greenhouse | 3627 | 3627 | 3610 | 17 | 14 | 9/9 | 0/0 |
| official_lever | 306 | 306 | 288 | 18 | 2 | 2/2 | 0/1 |
| official_page | 22 | 22 | 0 | 22 | 22 | 22/22 | 0/6 |
| official_workday | 64 | 64 | 22 | 42 | 4 | 4/4 | 0/0 |

独有/共有按本轮可证明的 ATS 身份计算。一个岗位可由多渠道贡献，列值不能直接相加。official_page 是辅助官方核验证据，不是独立新增岗位。CSV 同时记录渠道内重复率、原始 URL、官方发布时间、来源日期、首次发现和最后核验。GitHub 维护日期与邮件到达日期没有冒充官方发布日期。

## 覆盖与缺口

- 已维护 17 个官方公司 Board 和 3 个 GitHub New Grad 仓库，并持续从相关岗位发现新的 ATS。具体成功/失败来源见下表。
- 邮件真实导入：LinkedIn 6、Glassdoor 9、Handshake 5，全部保持待核实。最近30天 Indeed 英文职位提醒查询未找到匹配邮件；其直接接口未运行。Gmail 连接没有被假装安装到 VPS。
- LinkedIn、Indeed、Glassdoor、Handshake 与 Wellfound 的直接授权接口尚未配置；未模拟登录或抓取受限站点。YC、a16z Portfolio 和 AI 招聘入口本轮解析为零，不等于平台没有职位。
- Brave/Tavily 没有可用 Key，公开 catalog 未调用它们，也不依赖它们。
- HN 只采样最新 Who is hiring 的前40条顶层回复。Workday 为有界关键词查询，Greenhouse详情与公开页面核验均有预算；不能据此估算全网召回率。同行/竞品与融资关系情报尚未实现。

| 来源 | 记录 | 状态 |
| --- | ---: | --- |
| https://github.com/SimplifyJobs/New-Grad-Positions/blob/dev/README.md | 544 | 读取完成；零条可能表示无机器可读职位 |
| https://github.com/speedyapply/2027-AI-College-Jobs/blob/main/NEW_GRAD_USA.md | 520 | 读取完成；零条可能表示无机器可读职位 |
| https://github.com/Tar-ive/ML_Newgrad_2027/blob/main/README.md | 598 | 读取完成；零条可能表示无机器可读职位 |
| https://gmail.googleapis.com/gmail/v1/users/me/messages | 0 | skipped — credentials/explicit site permission not configured |
| NVIDIA | 40 | 读取完成；零条可能表示无机器可读职位 |
| Adobe | 15 | 读取完成；零条可能表示无机器可读职位 |
| Salesforce | 9 | 读取完成；零条可能表示无机器可读职位 |
| Databricks | 899 | 读取完成；零条可能表示无机器可读职位 |
| Stripe | 714 | 读取完成；零条可能表示无机器可读职位 |
| Pinterest | 160 | 读取完成；零条可能表示无机器可读职位 |
| Reddit | 160 | 读取完成；零条可能表示无机器可读职位 |
| Roblox | 269 | 读取完成；零条可能表示无机器可读职位 |
| Duolingo | 58 | 读取完成；零条可能表示无机器可读职位 |
| DoorDash | 442 | 读取完成；零条可能表示无机器可读职位 |
| Lyft | 178 | 读取完成；零条可能表示无机器可读职位 |
| Anthropic | 681 | 读取完成；零条可能表示无机器可读职位 |
| NewsBreak | 66 | 读取完成；零条可能表示无机器可读职位 |
| OpenAI | 799 | 读取完成；零条可能表示无机器可读职位 |
| Applied Intuition | 329 | 读取完成；零条可能表示无机器可读职位 |
| Quora | 9 | 读取完成；零条可能表示无机器可读职位 |
| Palantir | 306 | 读取完成；零条可能表示无机器可读职位 |
| https://news.ycombinator.com/submitted?id=whoishiring | 28 | 读取完成；零条可能表示无机器可读职位 |
| https://www.ycombinator.com/jobs | 0 | 读取完成；零条可能表示无机器可读职位 |
| https://jobs.a16z.com/jobs | 0 | 读取完成；零条可能表示无机器可读职位 |
| https://aijobs.net/ | 0 | 读取完成；零条可能表示无机器可读职位 |
| Duolingo | 5 | 读取完成；零条可能表示无机器可读职位 |
| Snowflake | 361 | 读取完成；零条可能表示无机器可读职位 |
| NVIDIA | 40 | 读取完成；零条可能表示无机器可读职位 |
| ServiceNow | 129 | TimeoutError:  |
| Meijer | 0 | 读取完成；零条可能表示无机器可读职位 |
| Brain Co. | 44 | 读取完成；零条可能表示无机器可读职位 |
| Graphcore | 209 | 读取完成；零条可能表示无机器可读职位 |
| Motorola | 16 | 读取完成；零条可能表示无机器可读职位 |
| Dark Wolf Solutions | 71 | 读取完成；零条可能表示无机器可读职位 |
| Crowe | 9 | 读取完成；零条可能表示无机器可读职位 |
| Lightfield | 26 | 读取完成；零条可能表示无机器可读职位 |
| Notion | 139 | 读取完成；零条可能表示无机器可读职位 |
| Wonderschool | 38 | 读取完成；零条可能表示无机器可读职位 |
| GlobalFoundries | 9 | 读取完成；零条可能表示无机器可读职位 |
| Laminar | 18 | 读取完成；零条可能表示无机器可读职位 |

## 误筛、漏筛与去重审计

- AI Developer Advocate 曾误入工程岗位，已排除；Post-Doctoral AI Researcher 的“2年固定期限”曾被当作经验条件，现进入学历核实。
- Backend Inference Runtime / AML Inference、Data Arch / Data Infra 等相关 New Grad 标题曾被漏识别，已补充规则；第三方记录仍需官方要求确认，不直接算合格申请。
- 公司＋标题指纹已移除。不同 Job ID 保留；自有招聘域名与 Greenhouse 托管 URL 仅在官方 Board/Job ID 提供映射时合并。`distinct-job-id-audit.csv` 可检查同公司同标题的不同岗位。
- ServiceNow 失效页被识别为 job has expired。Pinterest 等受限页保持 blocked，没有绕过限制。来源超时保留已取得记录并进入退避。
- 没有全量人工标签集，不能报告精确误筛率或漏筛率；本次给出可追踪的真实样本与完整原始记录。

## 可检查的匹配岗位

时间以亚洲/上海显示；CSV 保留原始 ISO 时间及来源日期类型。完整经验要求片段与全部来源见 CSV。

| 公司 | 岗位/官方页 | 地点 | 官方发布（上海） | 最早发现（上海） | 最后页核验（上海） | 状态 |
| --- | --- | --- | --- | --- | --- | --- |
| Brain Co. | [AI Product Engineer, 2027 New Grad](https://jobs.ashbyhq.com/brainco/c1788246-305f-4e4f-8b03-8444c76a466e) | San Francisco Bay Area | 2026-10-21 07:35 | 2026-10-28 06:57 | 2026-10-28 07:35 | valid |
| Quora | [Machine Learning Engineer, New Grad - Quora (Remote)](https://jobs.ashbyhq.com/quora/40659fe7-545e-4b08-b6d7-2567b18b9ed3) | Remote - Multiple Locations | 2026-10-16 00:18 | 2026-10-28 06:23 | 2026-10-28 07:35 | valid |
| Palantir | [Data Engineer - Talent Acquisition Operations](https://jobs.lever.co/palantir/1b690123-1766-4e75-a0ef-0f58afa864b4) | New York, NY | 2026-10-07 08:00 | 2026-10-28 06:57 | 2026-10-28 07:35 | valid |
| Brain Co. | [AI Security Engineer, 2027 New Grad](https://jobs.ashbyhq.com/brainco/32c4e1c9-ccd1-4dca-a68b-31ad1b868030) | San Francisco Bay Area | 2026-10-02 04:49 | 2026-10-28 06:57 | 2026-10-28 07:35 | valid |
| Brain Co. | [AI/ML Engineer, 2027 New Grad](https://jobs.ashbyhq.com/brainco/4c9f8f00-0caf-4927-80da-02a3e53cb0cd) | San Francisco Bay Area | 2026-10-02 04:36 | 2026-10-28 06:57 | 2026-10-28 07:35 | valid |
| Brain Co. | [AI Platform Engineer, 2027 New Grad](https://jobs.ashbyhq.com/brainco/4d39773e-f4c3-49c1-87c3-812a9804fb15) | San Francisco Bay Area | 2026-10-02 04:21 | 2026-10-28 06:57 | 2026-10-28 07:35 | valid |
| Quora | [Software Engineer New Grad, Machine Learning Platform - Quora (Remote)](https://jobs.ashbyhq.com/quora/cf34f80e-fe5c-454d-bc9a-4c59993ffda0) | Remote - Multiple Locations | 2026-09-26 06:08 | 2026-10-28 06:23 | 2026-10-28 07:35 | valid |
| Snowflake | [AI Research Scientist, New Grad – Agents & Reinforcement Learning](https://jobs.ashbyhq.com/snowflake/1bad12df-f443-426f-9d09-e96fc780d698) | US-WA-Bellevue | 2026-09-04 05:07 | 2026-10-28 06:57 | 2026-10-28 07:35 | valid |
| Applied Intuition | [Research Engineer - New Grad (2027)](https://jobs.ashbyhq.com/applied/45fc41cd-8280-4010-ba1f-def6114b3e39) | Sunnyvale | 2026-08-15 05:59 | 2026-10-28 06:23 | 2026-10-28 07:35 | valid |
| Applied Intuition | [Machine Learning Engineer - Behavior and Planning](https://jobs.ashbyhq.com/applied/129325ce-77e6-4d2a-a24a-6726acb53749) | Sunnyvale | 2026-07-30 01:49 | 2026-10-28 06:23 | 2026-10-28 07:35 | valid |
| Palantir | [Software Engineer - Edge AI Systems](https://jobs.lever.co/palantir/67110929-adea-41c3-851a-8882e222d9e4) | Seattle, WA | 2026-07-22 08:00 | 2026-10-28 06:58 | 2026-10-28 07:35 | valid |
| Notion | [Software Engineer, Early Career (AI)](https://jobs.ashbyhq.com/notion/85947779-6b87-466a-98bc-30a640448c28) | San Francisco, California | 2026-07-07 02:37 | 2026-10-28 06:57 | 2026-10-28 07:35 | valid |
| Brain Co. | [AI Product Engineer](https://jobs.ashbyhq.com/brainco/39660079-dc7e-4974-8ab1-900c45198bcf) | New York City, NY | 2026-06-13 09:08 | 2026-10-28 06:58 | 2026-10-28 07:35 | valid |
| Applied Intuition | [Software Engineer - AI Engineering](https://jobs.ashbyhq.com/applied/981054d6-d6d9-4553-9db8-38e56939d3b8) | Sunnyvale | 2026-03-25 23:07 | 2026-10-28 06:23 | 2026-10-28 07:35 | valid |
| Applied Intuition | [Software Engineer - Systems Engineering AI Tooling](https://jobs.ashbyhq.com/applied/6cce20b1-2250-4350-9952-9691f58fb074) | Sunnyvale | 2026-03-07 09:42 | 2026-10-28 06:23 | 2026-10-28 07:35 | valid |
| Applied Intuition | [Research Engineer - Reinforcement Learning, Self-Driving](https://jobs.ashbyhq.com/applied/36a49d01-e60f-4c01-8c8c-5a7f79347f51) | Sunnyvale | 2026-02-14 04:28 | 2026-10-28 06:23 | 2026-10-28 07:35 | valid |
| Applied Intuition | [Research Engineer - 3D Vision and Generation, Self-Driving](https://jobs.ashbyhq.com/applied/8da87c90-49ff-4b75-97c5-337882f63a00) | Sunnyvale | 2026-02-14 04:28 | 2026-10-28 06:23 | 2026-10-28 07:35 | valid |
| Brain Co. | [Software Engineer, ML Infrastructure](https://jobs.ashbyhq.com/brainco/0b8c4f13-c8bd-4987-b3b3-0c1adb57c6d8) | San Francisco Bay Area | 2025-10-29 03:01 | 2026-10-28 06:58 | 2026-10-28 07:35 | valid |
| Applied Intuition | [Research Engineer - Robotic Hardware, Simulation and Data](https://jobs.ashbyhq.com/applied/4cb44794-7b3b-46fc-9408-104a6d0f379e) | Sunnyvale | 2025-08-20 05:30 | 2026-10-28 06:23 | 2026-10-28 07:35 | valid |
| Applied Intuition | [Research Engineer - Robot Learning](https://jobs.ashbyhq.com/applied/e725018e-2577-4ff6-8dbd-69206272d9af) | Sunnyvale | 2025-08-20 05:30 | 2026-10-28 06:23 | 2026-10-28 07:35 | valid |
| Brain Co. | [AI Product Engineer](https://jobs.ashbyhq.com/brainco/4866bc74-52fa-4819-a9d0-3a5e73c31951) | San Francisco Bay Area | 2025-06-27 06:16 | 2026-10-28 06:58 | 2026-10-28 07:35 | valid |
| Applied Intuition | [Research Engineer - AI/RL Infrastructure](https://jobs.ashbyhq.com/applied/091ed808-95c9-420b-8061-0ff2eb9342bc) | Sunnyvale | 2024-09-17 08:52 | 2026-10-28 06:23 | 2026-10-28 07:35 | valid |
| NewsBreak | [Software Engineer, ML Infra (Junior & New Grad)](https://job-boards.greenhouse.io/newsbreak/jobs/4615879006) | Mountain View, California, United States | 未知/未核验 | 2026-10-28 06:23 | 2026-10-28 07:35 | valid |
| Adobe | [2027 University Graduate - Machine Learning Engineer](https://adobe.wd5.myworkdayjobs.com/external_experienced/job/San-Jose/XMLNAME-2027-University-Graduate---Machine-Learning-Engineer_R172085) | San Jose {'descriptor': 'United States of America', 'id': 'bc33aa3152ec42d4995f4791a106ed09'} | 未知/未核验 | 2026-10-28 06:57 | 2026-10-28 07:35 | valid |
| NVIDIA | [Research Scientist, Fundamental Generative AI - New College Grad 2026](https://nvidia.wd5.myworkdayjobs.com/NVIDIAExternalCareerSite/job/US-CA-Santa-Clara/Research-Scientist--Fundamental-Generative-AI---New-College-Grad-2026_JR2012698) | US, CA, Santa Clara {'descriptor': 'United States of America', 'id': 'bc33aa3152ec42d4995f4791a106ed09'} | 未知/未核验 | 2026-10-28 06:57 | 2026-10-28 07:35 | valid |
| Pinterest | [Master's University Grad Machine Learning Engineer 2027 (USA)](https://www.pinterestcareers.com/jobs/?gh_jid=8140219) | San Francisco, CA, US; Palo Alto, CA, US; Seattle, WA, US; New York, NY, US | 未知/未核验 | 2026-10-28 06:57 | 未知/未核验 | blocked |
| NVIDIA | [Applied Machine Learning Engineer, AI for VLSI Design - New College Grad 2026](https://nvidia.wd5.myworkdayjobs.com/NVIDIAExternalCareerSite/job/US-CA-Santa-Clara/Applied-Machine-Learning-Engineer--AI-for-VLSI-Design---New-College-Grad-2026_JR2026576) | US, CA, Santa Clara {'descriptor': 'United States of America', 'id': 'bc33aa3152ec42d4995f4791a106ed09'} | 未知/未核验 | 2026-10-28 06:57 | 2026-10-28 07:35 | valid |
| NewsBreak | [Applied AI Engineer, Advertising Agents (New Grad)](https://job-boards.greenhouse.io/newsbreak/jobs/4700278006) | Mountain View, California, United States | 未知/未核验 | 2026-10-28 06:23 | 2026-10-28 07:35 | valid |
| NVIDIA | [Machine Learning Engineer, AI Safety](https://nvidia.wd5.myworkdayjobs.com/NVIDIAExternalCareerSite/job/US-CA-Santa-Clara/Machine-Learning-Engineer--AI-Safety_JR2021784-1) | US, CA, Santa Clara {'descriptor': 'United States of America', 'id': 'bc33aa3152ec42d4995f4791a106ed09'} | 未知/未核验 | 2026-10-28 06:57 | 2026-10-28 07:35 | valid |
| Databricks | [AI Engineer – Forward Deployed Engineering (AI FDE)](https://databricks.com/company/careers/open-positions/job?gh_jid=8546367002) | United States | 未知/未核验 | 2026-10-28 07:32 | 2026-10-28 07:35 | valid |
| Stripe | [Machine Learning Engineer, Radar](https://stripe.com/jobs/search?gh_jid=8243617) | Seattle | 未知/未核验 | 2026-10-28 06:57 | 2026-10-28 07:35 | valid |
| Pinterest | [Machine Learning Engineer, Core Engineering](https://www.pinterestcareers.com/jobs/?gh_jid=6121450) | San Francisco, CA, US; Palo Alto, CA, US; Seattle, WA, US; Remote, US | 未知/未核验 | 2026-10-28 06:57 | 未知/未核验 | blocked |
| Pinterest | [Machine Learning Engineer, EPD Ads](https://www.pinterestcareers.com/jobs/?gh_jid=6121543) | San Francisco, CA, US; Palo Alto, CA, US; Seattle, WA, US | 未知/未核验 | 2026-10-28 06:57 | 未知/未核验 | blocked |
| Pinterest | [Machine Learning Engineer II, Core Engineering ](https://www.pinterestcareers.com/jobs/?gh_jid=7473497) | Toronto, ON, CA | 未知/未核验 | 2026-10-28 06:57 | 未知/未核验 | blocked |
| Pinterest | [Machine Learning Engineer II, Responsible AI](https://www.pinterestcareers.com/jobs/?gh_jid=8162046) | San Francisco, CA, US; Remote, US | 未知/未核验 | 2026-10-28 06:57 | 未知/未核验 | blocked |
| DoorDash | [Software Engineer, Data Platform](https://job-boards.greenhouse.io/doordashusa/jobs/8191886) | San Francisco, CA; Sunnyvale, CA; Seattle, WA; New York City, NY | 未知/未核验 | 2026-10-28 07:32 | 2026-10-28 07:35 | valid |
| DoorDash | [Software Engineer, ML Infrastructure (MDX)](https://job-boards.greenhouse.io/doordashusa/jobs/8283735) | San Francisco, CA; Sunnyvale, CA; Seattle, WA | 未知/未核验 | 2026-10-28 07:32 | 2026-10-28 07:35 | valid |
| Lyft | [Machine Learning Engineer](https://app.careerpuck.com/job-board/lyft/job/8689127002?gh_jid=8689127002) | New York, NY | 未知/未核验 | 2026-10-28 06:57 | 2026-10-28 07:35 | valid |
| Lyft | [Machine Learning Engineer, Fulfillment](https://app.careerpuck.com/job-board/lyft/job/8688633002?gh_jid=8688633002) | San Francisco, CA | 未知/未核验 | 2026-10-28 06:57 | 2026-10-28 07:35 | valid |
| NewsBreak | [NewsBreak Venture, AI Growth Intelligence Engineer (New Grad）](https://job-boards.greenhouse.io/newsbreak/jobs/4694899006) | Mountain View, California, United States | 未知/未核验 | 2026-10-28 06:23 | 2026-10-28 07:35 | valid |
| Crowe | [Machine Learning Software Engineer 1](https://crowe.wd12.myworkdayjobs.com/external_careers/job/Chicago-IL-USA/Machine-Learning-Software-Engineer-1_R-71006) | Chicago IL USA {'descriptor': 'United States of America', 'id': 'bc33aa3152ec42d4995f4791a106ed09'} | 未知/未核验 | 2026-10-28 06:57 | 2026-10-28 07:35 | valid |
| Wonderschool | [Early Career Software Engineer – Applied AI](https://job-boards.greenhouse.io/wonderschool/jobs/6359139003) | San Francisco | 未知/未核验 | 2026-10-28 06:57 | 2026-10-28 07:35 | valid |
| GlobalFoundries | [AI Software Engineer (2027 New College Graduate)](https://globalfoundries.wd1.myworkdayjobs.com/External/job/USA---California---Santa-Clara/AI-Software-Engineer--2027-New-College-Graduate-_JR-2604055) | USA - California - Santa Clara {'descriptor': 'United States of America', 'id': 'bc33aa3152ec42d4995f4791a106ed09'} | 未知/未核验 | 2026-10-28 06:57 | 2026-10-28 07:35 | valid |
| GlobalFoundries | [AI/ML Systems Engineer (2027 New College Graduate)](https://globalfoundries.wd1.myworkdayjobs.com/External/job/USA---Texas---Richardson/AI-ML-Systems-Engineer--2027-New-College-Graduate-_JR-2604163) | USA - Texas - Richardson {'descriptor': 'United States of America', 'id': 'bc33aa3152ec42d4995f4791a106ed09'} | 未知/未核验 | 2026-10-28 06:57 | 2026-10-28 07:35 | valid |

## Outreach、测试和部署

真实 HN/公开帖线索 28 条，其中 1 条含明确发布的联系邮箱。负责人姓名未核实则留空；没有猜邮箱。草稿包含来源与公司/岗位上下文，个人经历保留待填写，未发送邮件或私信。详见私有下载包中的 outreach-drafts.json。

最新功能 CI：**73 项通过**（PostgreSQL 17 + 实际 Chromium）；本地 **70 通过、3 跳过**。Ruff、源码秘密扫描、Compose 启动/健康检查、原生 ARM64 Docker 构建与 Chromium 启动均通过。保留一项依赖弃用提示。

真实数据已导入隔离本地预览库，Dashboard、匹配/7天筛选、CSV、JSON、Outreach 路由均验证 HTTP 200；申请账本为空。

**OCI 未部署。** 未发现可用 OCI API 配置或实例 SSH 连接；已有一般账号授权没有提供实例公网IP与受支持的 SSH/API 通道。原生 aarch64 + Chromium 141.0.7390.37 测试证明容器兼容，不证明 OCI 实例已运行。最短部署步骤见 [OCI_ARM64.md](OCI_ARM64.md)。

本轮不推进自动投递；先由用户检查搜索质量。实际表单成功率、长期无人值守运行和100份有效申请/天仍未验证。
