# 多渠道职位发现报告 · 2026-10-28

运行 2026-10-28 09:40 UTC → 2026-10-28 09:43 UTC，报告生成 2026-10-28 09:45 UTC。信任等级 `draft`：**本轮只发现和筛选，没有打开任何申请表，提交 0 份。**

| 项目 | 数量 |
| --- | ---: |
| 原始发现记录（sightings，含跨渠道重复） | 33541 |
| 去重后岗位（按 ATS Job ID / 官方链接） | 32395 |
| 合并掉的重复记录 | 1124 |
| 无链接线索（Handshake 提醒等，不参与合并） | 22 |
| 规则匹配 match | 575（官方页 141，仅第三方 434） |
| 待核实 review / 排除 reject | 765 / 31055 |
| 匹配岗位链接核验：有效 / 失效 / 受限 / 未能核验 | 539 / 25 / 11 / 0（共核验 575） |
| 匹配岗位中官方发布于近 7 / 30 天 | 6 / 34（450 个无官方发布日期） |
| 全部岗位中官方发布于近 7 / 30 天 | 2320 / 9024 |
| 观察到的公司 / 有匹配的公司 | 1754 / 215 |
| 匹配岗位中属于名单内中大型公司 | 68 / 575 |
| 来源成功 / 失败或跳过 | 224 / 5 |

“近 7/30 天”只用雇主 ATS 给出的发布时间（Greenhouse `first_published`、Lever `createdAt`、Ashby `publishedAt`）。Workday 只给 start date，GitHub 列表和邮件只有转载/收件时间，这些都不当成发布时间。本仓库从今天开始记录每个来源的首次发现时间，下次运行起才能统计“我们新发现”的岗位。

## 渠道贡献

| 渠道 | 发现记录 | 岗位数 | 独有 | 与其他渠道共有 | 渠道内重复率 | 匹配 | 独有匹配 | 官方近7/30天（全部） | 匹配近7/30天 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| GitHub New Grad 列表 | 4097 | 3522 | 3119 | 403 | 14.0% | 527 | 432 | 29/118 | 5/29 |
| Gmail · Glassdoor 提醒 | 145 | 108 | 108 | 0 | 25.5% | 1 | 1 | 0/0 | 0/0 |
| Gmail · Handshake 提醒 | 22 | 22 | 22 | 0 | 0.0% | 0 | 0 | 0/0 | 0/0 |
| Gmail · LinkedIn 提醒 | 421 | 319 | 319 | 0 | 24.2% | 1 | 1 | 0/0 | 0/0 |
| HN Who is hiring | 320 | 320 | 313 | 7 | 0.0% | 0 | 0 | 0/0 | 0/0 |
| 官方 Ashby | 5784 | 5784 | 5666 | 118 | 0.0% | 57 | 16 | 689/2272 | 4/17 |
| 官方 Greenhouse | 19615 | 19615 | 19416 | 199 | 0.0% | 52 | 20 | 1498/6094 | 2/10 |
| 官方 Lever | 2380 | 2380 | 2305 | 75 | 0.0% | 16 | 1 | 133/658 | 0/7 |
| 官方 Workday | 757 | 757 | 739 | 18 | 0.0% | 16 | 9 | 0/0 | 0/0 |

“独有”= 本轮只有这个渠道报告了这个 Job ID。一个岗位可被多个渠道报告，各列不能相加。第三方渠道（GitHub、邮件、HN）的“官方近7/30天”来自同一岗位的官方记录，没有官方记录就算未知。

## 来源覆盖

- 长期监控名单（`config/watchlist.yaml`）：官方 Greenhouse 53 家，官方 Lever 4 家，官方 Ashby 24 家，官方 Workday 25 家，共 19215 个在招岗位。Workday 没有全量接口，每家用固定关键词做有界搜索，召回不完整。
- 从第三方列表顺藤摸瓜抓取的官方 Board：109 个（成功 109），让官方要求而不是转载内容决定筛选。
- SimplifyJobs/New-Grad-Positions：3014 条（16129 rows marked closed by the list were skipped）
- speedyapply/2027-AI-College-Jobs：520 条（0 rows marked closed by the list were skipped）
- Tar-ive/ML_Newgrad_2027：563 条（0 rows marked closed by the list were skipped）
- HN Who is hiring：320 条（Ask HN: Who is hiring? (October 2026); 319 of 319 top-level posts read）
- Gmail：读取近 30 天 157 封 LinkedIn/Glassdoor/Handshake/Indeed 提醒邮件（会话中的 Gmail 连接器，只读；VPS 上改用 Gmail API OAuth）。
  - Gmail linkedin alerts：421 条（122 alert emails）
  - Gmail glassdoor alerts：145 条（21 alert emails）
  - Gmail handshake alerts：22 条（9 alert emails）
  - Gmail indeed alerts：0 条（5 alert emails）
  - Gmail emails without job cards：0 条（58 of 157 emails had no job listing (newsletters, invitations, application receipts)）

跳过的来源（没有授权接口，不模拟登录、不抓取受限站点）：

- LinkedIn direct：No approved jobs API; covered through LinkedIn alert emails in Gmail
- Indeed direct：No approved jobs API; covered through Indeed alert emails in Gmail
- Glassdoor direct：No approved jobs API; covered through Glassdoor alert emails in Gmail
- Handshake direct：Needs an account integration; covered through Handshake emails in Gmail
- Wellfound：Account authorization not configured

## 筛选规则

New Grad / 0–2 年 + AI/ML、研究、数据工程类岗位。签证：职位没写就不过滤；官方页面明确写了不担保才排除，第三方转载的“不担保”只进待核实。需要美国公民身份或安全许可的岗位排除（候选人不是美国公民）。要求 PhD 的岗位排除（候选人最高学历为硕士）；“MS/PhD”不排除。

| 结果 | 规则 | 数量 | 说明 |
| --- | --- | ---: | --- |
| reject | `role.out_of_scope` | 27597 | Title is not an AI/ML, research or data-engineering role |
| reject | `level.senior` | 2123 | Senior, staff, lead or manager title |
| match | `match` | 575 | Official posting; early-career |
| review | `level.unclear` | 472 | No new-grad or 0-2 year signal in title, description or source |
| reject | `role.non_engineering` | 336 | Not an engineering, scientist or research title |
| reject | `location.non_us` | 334 | Location outside the US |
| reject | `type.internship` | 203 | Internship or co-op, not a full-time role |
| review | `role.data_science` | 168 | Data-science title (early-career |
| reject | `experience.too_senior` | 164 | Requires 3+ years |
| reject | `auth.citizenship` | 150 | Requires US citizenship or clearance |
| reject | `degree.phd_required` | 87 | Description requires a PhD and never mentions a master's |
| review | `role.research_unclear` | 80 | Research title; the text given does not show whether the work is ML |
| reject | `role.research_not_ml` | 38 | Research title, but the posting describes no ML work |
| review | `location.unknown` | 28 | US location not established |
| reject | `auth.no_sponsorship` | 23 | Posting says no sponsorship |
| review | `lead.unresolved` | 13 | Alert or hiring-post lead; find the official posting before judging |
| review | `experience.conflict` | 2 | Early-career title but asks 4+ years |
| review | `degree.phd_mentioned` | 1 | PhD mentioned; check whether a master's qualifies |
| review | `auth.no_sponsorship_unverified` | 1 | A third-party copy says no sponsorship |

## 筛选审计（独立审核 agent 盲评）

抽样 110 个岗位，分层：规则匹配、全部排除中随机、“标题像 AI/ML 却被排除”的边缘排除、待核实。审核者：Sonnet subagent (fresh instance), blind, brief + postings only。它只看岗位原文和候选人事实，看不到规则结论，也看不到工人的说法；评分由代码对照隐藏的答案键完成。

| 指标 | 结果 |
| --- | --- |
| 误筛率（匹配里审核者认为不合适） | 16.7%（95% 区间 7%–34%，n=30） |
| 漏筛率（随机排除里审核者认为合适） | 0.0%（95% 区间 0%–16%，n=20） |
| 边缘排除中被认为合适 | 0.0%（95% 区间 0%–12%，n=27） |
| 待核实 → 审核者：合适 / 不合适 | 3 / 10 |
| 审核者“无法判断” | 20 |

历次审计（每轮都是新的盲样本、新的审核者实例）：

| 时间 | 误筛率 | n | 漏筛率 | n |
| --- | ---: | ---: | ---: | ---: |
| 2026-10-28 09:36 UTC | 27.0% | 37 | 5.0% | 20 |
| 2026-10-28 09:45 UTC | 16.7% | 30 | 0.0% | 20 |

筛选环节信任等级：`confirm`（audit 2026-10-28T09:45:03.448Z: false-match 16.7%, miss 0.0% (limit 10%)）。超过 10% 自动降回“等我确认”；连续 3 次审计误筛和漏筛都 ≤5% 才会建议升级，由你决定。

分歧（已进每日清单，你的判断会存成评测集）：

| 规则结论 | 规则 | 审核者 | 理由 | 岗位 |
| --- | --- | --- | --- | --- |
| match | `match` | no | "Backend Engineer Graduate - Vertical Recommendation Architecture" is general backend software, not ML or data infrastructure. | [TikTok · Backend Engineer Graduate - TikTok Vertical Recommendation Architecture - 2027 Start](https://lifeattiktok.com/search/7672532801686571317) |
| match | `match` | no | "2+ years of experience developing, evaluating, and deploying machine learning models in a production environment" is a minimum requirement beyond a new grad. | [Stripe · Machine Learning Engineer, Radar](https://job-boards.greenhouse.io/stripe/jobs/8243617) |
| match | `match` | no | "Minimum of 2+ years of work experience in developing and deploying machine learning models in production" plus 1+ years in content safety. | [NVIDIA · Machine Learning Engineer, AI Safety](https://nvidia.wd5.myworkdayjobs.com/NVIDIAExternalCareerSite/job/US-CA-Santa-Clara/Machine-Learning-Engineer--AI-Safety_JR2021784-1) |
| match | `match` | no | Requires "3+ years of applied ML experience (Master's)". | [Twitch · Applied Scientist](https://job-boards.greenhouse.io/twitch/jobs/8872835002) |
| match | `match` | no | Requires "2+ years of experience in machine learning modeling" and the role is to "lead the design". | [Lyft · Machine Learning Engineer](https://job-boards.greenhouse.io/lyft/jobs/8689127002) |

## 链接抽样核验

对本轮全部匹配岗位（官方优先）逐个请求岗位页：575 个中有效 539、失效 25、站点拒绝自动访问 11、未能核验 0。“有效”= HTTP 200、没有跳回 Board 首页、页面没有“职位已关闭”字样；官方 API 本轮仍列出该岗位是更强的在招证据。页面有效不等于申请表能提交成功。

| 状态 | 岗位 | 说明 |
| --- | --- | --- |
| invalid | [Adobe · 2027 University Graduate - Machine Learning Engineer](https://careers.adobe.com/us/en/job/R172085/2027-University-Graduate-Machine-Learning-Engineer) | page says: "job you are trying to apply for has been filled" |
| blocked | [Thales · AI Engineer - Graduate](https://www.glassdoor.com/partner/jobListing.htm?jobListingId=1010294768001) | HTTP 403; site refuses automated reads |
| invalid | [Avathon · Associate AI Engineer - Physical AI](https://avathon.com/company/careers-job-listing?gh_jid=4736834005) | HTTP 404 |
| invalid | [True Anomaly · Data Engineer I](https://job-boards.greenhouse.io/trueanomalyinc/jobs/5223279007) | redirected to the board with error=true (posting closed) |
| blocked | [Study.com · Software Engineer New Grad - AI-Native](https://study.com/pages/jobApplication.html?gh_jid=5429313008) | HTTP 403; site refuses automated reads |
| invalid | [Conviva · AI/ML Engineer](https://www.conviva.ai/careers/job/8036615003?gh_jid=8036615003) | HTTP 404 |
| invalid | [Abacus Insights · Associate Data Engineer](https://boards.greenhouse.io/abacusinsights/jobs/8917379002?gh_jid=8917379002) | job URL redirected to the board index |
| invalid | [Applied Underwriters · AI Engineer - Infrustructure](https://jobs.lever.co/auw/515a3498-4257-4e68-91ff-cf82e854f12d) | HTTP 404 |
| invalid | [Applied Underwriters · AI Engineer - Data Science](https://jobs.lever.co/auw/6f317af6-4362-4dea-accc-e86ec1d102a5) | HTTP 404 |
| invalid | [Applied Underwriters · AI Engineer - Application Development](https://jobs.lever.co/auw/9234d6e2-f306-48d9-9cd6-9192d34d889c) | HTTP 404 |
| blocked | [City of San Francisco · AI Platform Support Engineer - 1042 -Department of Technology](https://jobs.smartrecruiters.com/CityAndCountyOfSanFrancisco1/3743990016403957-ai-platform-support-engineer-1042-department-of-technology?oga=true) | HTTP 403; site refuses automated reads |
| blocked | [Sopra Steria I2S · AI Platform Engineer - m/w/d](https://jobs.smartrecruiters.com/SopraSteria1/744000151827379-ai-platform-engineer-m-w-d-?oga=true) | HTTP 403; site refuses automated reads |
| blocked | [About You · Backend Engineer - Recommendation - all genders](https://jobs.smartrecruiters.com/ABOUTYOUGmbH/744000151832959-backend-engineer-recommendation-all-genders-?oga=true) | HTTP 403; site refuses automated reads |
| blocked | [Eversana · AI Security Engineer I](https://jobs.smartrecruiters.com/EVERSANA1/744000151855805-ai-security-engineer-i?oga=true) | HTTP 403; site refuses automated reads |
| blocked | [ServiceNow · Machine Learning Engineer](https://jobs.smartrecruiters.com/ServiceNow/744000156637254-machine-learning-engineer?oga=true) | HTTP 403; site refuses automated reads |
| invalid | [Johns Hopkins Applied Physics Laboratory · 2027 Graduate - Software Engineer; Machine Learning Engineer; Data Scientist - Tactical Intelligence Systems](http://careers.jhuapl.edu/jobs/59653) | page says: "job may be no longer available" |
| invalid | [Johns Hopkins Applied Physics Laboratory · 2027 Graduate - Junior AI Platform Engineer](http://careers.jhuapl.edu/jobs/60364) | page says: "job may be no longer available" |
| invalid | [Amazon · Software Development Engineer 1 - AI/ML Network Infrastructure](https://amazon.jobs/en/jobs/10584797/software-development-engineer-i-ai-ml-network-infrastructure-annapurna-labs) | HTTP 404 |
| invalid | [Cruise Planners · Data & AI Engineer](https://ats.rippling.com/cruiseplanners/jobs/414d04d4-f099-4a35-8fbc-1cc7bec70462) | page says: "jobNotFoundMessage":"This job post is no longer available" |
| invalid | [Zededa · Software Engineer - AI & Edge Kubernetes Orchestration](https://ats.rippling.com/zededa/jobs/3e34a738-5eb1-405d-b46b-e9737226f5be) | page says: "jobNotFoundMessage":"This job post is no longer available" |
| blocked | [ByteDance · Agent Evaluation & Evolution Machine Learning Engineer Graduate (AML-Ark-US) - 2027 Start](https://bandana.com/jobs/32a7741a-5220-430e-aef1-3556bf55c62e) | HTTP 403; site refuses automated reads |
| invalid | [AMD · Field Applications Engineer, AI Infrastructure](https://careers.amd.com/jobs/91746?lang=en-us) | page says: "job may be no longer available" |
| invalid | [Johns Hopkins Applied Physics Laboratory · AI/ML Research Engineer](https://careers.jhuapl.edu/jobs/59548?icims=1) | page says: "job may be no longer available" |
| invalid | [Johns Hopkins Applied Physics Laboratory · Software Engineering/ML/Data Scientist New Grad - Intelligence Systems](https://careers.jhuapl.edu/jobs/59654?icims=1) | page says: "job may be no longer available" |
| invalid | [Johns Hopkins Applied Physics Laboratory · Artificial Intelligence Engineer New Grad - Intelligent Autonomous Systems](https://careers.jhuapl.edu/jobs/59848?icims=1) | page says: "job may be no longer available" |

## 匹配岗位（前 80，官方页优先）

完整列表见 `matches.csv`（含全部来源、各来源日期类型、首次发现时间、链接核验）。

| 公司 | 岗位 | 地点 | 官方发布 | 来源 | 链接 |
| --- | --- | --- | --- | --- | --- |
| Together AI | [(Senior/Junior AI Inference Reliability Engineer, Compute Infra](https://job-boards.greenhouse.io/togetherai/jobs/5268939007) | San Francisco | 2026-10-27 | 官方·Greenhouse | valid |
| Quora | [Machine Learning Engineer, New Grad - Quora (Remote)](https://jobs.ashbyhq.com/quora/40659fe7-545e-4b08-b6d7-2567b18b9ed3) | Remote - Multiple Locations; United States; Canada; United S | 2026-10-15 | 官方·Ashby、GitHub New Grad 列表 | valid |
| DoorDash USA | [Software Engineer, ML Infrastructure (MDX)](https://job-boards.greenhouse.io/doordashusa/jobs/8283735) | San Francisco, CA; Sunnyvale, CA; Seattle, WA | 2026-10-15 | 官方·Greenhouse | valid |
| Asana | [Software Engineer - AI Teammates Platform](https://job-boards.greenhouse.io/asana/jobs/8194522) | San Francisco | 2026-10-14 | 官方·Greenhouse | valid |
| DoorDash USA | [Software Engineer, Data Platform](https://job-boards.greenhouse.io/doordashusa/jobs/8191886) | San Francisco, CA; Sunnyvale, CA; Seattle, WA; New York City | 2026-10-13 | 官方·Greenhouse | valid |
| Twitch | [Applied Scientist](https://job-boards.greenhouse.io/twitch/jobs/8872835002) | San Francisco, CA | 2026-10-08 | 官方·Greenhouse、GitHub New Grad 列表 | valid |
| Palantir | [Data Engineer - Talent Acquisition Operations](https://jobs.lever.co/palantir/1b690123-1766-4e75-a0ef-0f58afa864b4) | New York, NY (US) | 2026-10-07 | 官方·Lever、GitHub New Grad 列表 | valid |
| Stripe | [Machine Learning Engineer, Radar](https://job-boards.greenhouse.io/stripe/jobs/8243617) | Seattle | 2026-10-07 | 官方·Greenhouse | valid |
| Pinterest | [Master's University Grad Machine Learning Engineer 2027 (USA)](https://job-boards.greenhouse.io/pinterest/jobs/8140219) | San Francisco, CA, US; Palo Alto, CA, US; Seattle, WA, US; N | 2026-10-01 | 官方·Greenhouse、GitHub New Grad 列表 | valid |
| Quora | [Software Engineer New Grad, Machine Learning Platform - Quora (Remote)](https://jobs.ashbyhq.com/quora/cf34f80e-fe5c-454d-bc9a-4c59993ffda0) | Remote - Multiple Locations; United States; Canada; United S | 2026-09-25 | 官方·Ashby、GitHub New Grad 列表 | valid |
| Perplexity | [Member of Technical Staff, AI Products (Early Career - Industry)](https://jobs.ashbyhq.com/perplexity/daa9120e-94ff-46e0-b4bd-4d2d290cb409) | San Francisco; United States | 2026-09-23 | 官方·Ashby | valid |
| Applied Intuition | [Robot Learning Engineer - Manipulation](https://jobs.ashbyhq.com/applied/ef7fb9ed-e254-4b90-aef2-efa9c30e7cd8) | Sunnyvale; United States | 2026-09-21 | 官方·Ashby | valid |
| Waymo | [Research Scientist, Map Scalability](https://job-boards.greenhouse.io/waymo/jobs/8180692) | Mountain View, CA, U.S.A ; San Francisco, CA, U.S.A ; New Yo | 2026-09-08 | 官方·Greenhouse、GitHub New Grad 列表 | valid |
| Snowflake | [AI Research Scientist, New Grad – Agents & Reinforcement Learning](https://jobs.ashbyhq.com/snowflake/1bad12df-f443-426f-9d09-e96fc780d698) | US-WA-Bellevue; United States | 2026-09-03 | 官方·Ashby、GitHub New Grad 列表 | valid |
| Scale AI | [Machine Learning Research Scientist, Evaluations](https://job-boards.greenhouse.io/scaleai/jobs/4728014005) | San Francisco, CA; Seattle, WA; New York, NY | 2026-08-26 | 官方·Greenhouse、GitHub New Grad 列表 | valid |
| Applied Intuition | [Research Scientist - Humanoid Robotics](https://jobs.ashbyhq.com/applied/4cd7cf1d-717c-4887-93b4-520a40a906b1) | Sunnyvale; United States | 2026-08-22 | 官方·Ashby、GitHub New Grad 列表 | valid |
| Lyft | [Machine Learning Engineer](https://job-boards.greenhouse.io/lyft/jobs/8689127002) | New York, NY | 2026-08-18 | 官方·Greenhouse | valid |
| Lyft | [Machine Learning Engineer, Fulfillment](https://job-boards.greenhouse.io/lyft/jobs/8688633002) | San Francisco, CA | 2026-08-18 | 官方·Greenhouse | valid |
| Applied Intuition | [Research Engineer - New Grad (2027)](https://jobs.ashbyhq.com/applied/45fc41cd-8280-4010-ba1f-def6114b3e39) | Sunnyvale; United States | 2026-08-14 | 官方·Ashby、GitHub New Grad 列表 | valid |
| Applied Intuition | [AI Performance Engineer](https://jobs.ashbyhq.com/applied/23c60c30-8329-443a-8297-73cfc529c103) | Sunnyvale; United States | 2026-08-12 | 官方·Ashby、GitHub New Grad 列表 | valid |
| Nuro | [Software Engineer, ML Inference Platform](https://job-boards.greenhouse.io/nuro/jobs/8122537) | Mountain View, California (HQ) | 2026-08-11 | 官方·Greenhouse | valid |
| Nuro | [Software Engineer, ML Infrastructure Platform](https://job-boards.greenhouse.io/nuro/jobs/8122483) | Mountain View, California (HQ) | 2026-08-11 | 官方·Greenhouse、GitHub New Grad 列表 | valid |
| Glean | [Machine Learning Engineer, Assistant Quality](https://job-boards.greenhouse.io/gleanwork/jobs/4711484005) | San Francisco, CA | 2026-08-03 | 官方·Greenhouse、GitHub New Grad 列表 | valid |
| OpenAI | [Research Engineer / Research Scientist - Personal AGI, Personalization](https://jobs.ashbyhq.com/openai/1bf678c5-1058-45ca-b9bd-b0029fccd60e) | San Francisco; United States | 2026-08-03 | 官方·Ashby、GitHub New Grad 列表 | valid |
| Applied Intuition | [Machine Learning Engineer - Behavior and Planning](https://jobs.ashbyhq.com/applied/129325ce-77e6-4d2a-a24a-6726acb53749) | Sunnyvale; United States | 2026-07-29 | 官方·Ashby | valid |
| NewsBreak | [Applied AI Engineer, Advertising Agents (New Grad)](https://job-boards.greenhouse.io/newsbreak/jobs/4700278006) | Mountain View, California, United States | 2026-07-27 | 官方·Greenhouse、GitHub New Grad 列表 | valid |
| Applied Intuition | [Research Scientist - 3D Vision and Generation, Self-Driving](https://jobs.ashbyhq.com/applied/5f15c171-ae5a-496b-a8eb-c6a351d55b6b) | Sunnyvale; United States | 2026-07-24 | 官方·Ashby、GitHub New Grad 列表 | valid |
| Together AI | [[Junior / Senior / Staff] Software Engineer, Inference / Compute Infrastructure Engineering](https://job-boards.greenhouse.io/togetherai/jobs/5186628007) | San Francisco | 2026-07-16 | 官方·Greenhouse | valid |
| NewsBreak | [NewsBreak Venture, AI Growth Intelligence Engineer (New Grad）](https://job-boards.greenhouse.io/newsbreak/jobs/4694899006) | Mountain View, California, United States | 2026-07-06 | 官方·Greenhouse、GitHub New Grad 列表 | valid |
| Together AI | [Research Engineer, Post-Training Inference](https://job-boards.greenhouse.io/togetherai/jobs/5179372007) | San Francisco | 2026-07-06 | 官方·Greenhouse | valid |
| NewsBreak | [Applied AI Engineer, Advertising Agents](https://job-boards.greenhouse.io/newsbreak/jobs/4690262006) | Mountain View, California, United States | 2026-06-17 | 官方·Greenhouse、GitHub New Grad 列表 | valid |
| Nuro | [Software Engineer, ML Infrastructure, Optimization](https://job-boards.greenhouse.io/nuro/jobs/6916236) | Mountain View, California (HQ) | 2026-06-16 | 官方·Greenhouse | valid |
| Anduril Industries | [Software Engineer, Perception](https://job-boards.greenhouse.io/andurilindustries/jobs/5165250007) | Costa Mesa, California, United States | 2026-06-15 | 官方·Greenhouse | valid |
| Applied Intuition | [Software Engineer - AI Engineering](https://jobs.ashbyhq.com/applied/981054d6-d6d9-4553-9db8-38e56939d3b8) | Sunnyvale; United States | 2026-03-25 | 官方·Ashby | valid |
| Applied Intuition | [Software Engineer - Systems Engineering AI Tooling](https://jobs.ashbyhq.com/applied/6cce20b1-2250-4350-9952-9691f58fb074) | Sunnyvale; United States | 2026-03-07 | 官方·Ashby | valid |
| Applied Intuition | [Research Engineer - Reinforcement Learning, Self-Driving](https://jobs.ashbyhq.com/applied/36a49d01-e60f-4c01-8c8c-5a7f79347f51) | Sunnyvale; United States | 2026-02-13 | 官方·Ashby | valid |
| Applied Intuition | [Research Engineer - 3D Vision and Generation, Self-Driving](https://jobs.ashbyhq.com/applied/8da87c90-49ff-4b75-97c5-337882f63a00) | Sunnyvale; United States | 2026-02-13 | 官方·Ashby | valid |
| Waymo | [Software Engineer, Perception Scaling Evaluation](https://job-boards.greenhouse.io/waymo/jobs/7449712) | Mountain View, CA, USA; San Francisco, CA, USA | 2025-12-11 | 官方·Greenhouse | valid |
| NewsBreak | [Software Engineer, ML Infra (Junior & New Grad)](https://job-boards.greenhouse.io/newsbreak/jobs/4615879006) | Mountain View, California, United States | 2025-11-05 | 官方·Greenhouse、GitHub New Grad 列表 | valid |
| Nuro | [Software Engineer, AI Platform - New Grad](https://job-boards.greenhouse.io/nuro/jobs/7351066) | Mountain View, California (HQ) | 2025-10-22 | 官方·Greenhouse | valid |
| Applied Intuition | [Research Engineer - Robotic Hardware, Simulation and Data](https://jobs.ashbyhq.com/applied/4cb44794-7b3b-46fc-9408-104a6d0f379e) | Sunnyvale; United States | 2025-08-19 | 官方·Ashby | valid |
| Applied Intuition | [Research Engineer - Robot Learning](https://jobs.ashbyhq.com/applied/e725018e-2577-4ff6-8dbd-69206272d9af) | Sunnyvale; United States | 2025-08-19 | 官方·Ashby | valid |
| Waymo | [Machine Learning Engineer, Prediction & Planning](https://job-boards.greenhouse.io/waymo/jobs/6506689) | Mountain View, CA, USA; San Francisco, CA, USA | 2025-04-28 | 官方·Greenhouse | valid |
| Applied Intuition | [Research Engineer - AI/RL Infrastructure](https://jobs.ashbyhq.com/applied/091ed808-95c9-420b-8061-0ff2eb9342bc) | Sunnyvale; United States | 2024-09-17 | 官方·Ashby | valid |
| Pinterest | [Machine Learning Engineer, Core Engineering](https://job-boards.greenhouse.io/pinterest/jobs/6121450) | San Francisco, CA, US; Palo Alto, CA, US; Seattle, WA, US; R | 2024-07-24 | 官方·Greenhouse | valid |
| Pinterest | [Machine Learning Engineer, EPD Ads](https://job-boards.greenhouse.io/pinterest/jobs/6121543) | San Francisco, CA, US; Palo Alto, CA, US; Seattle, WA, US | 2024-07-23 | 官方·Greenhouse | valid |
| Glean | [Machine Learning Engineer, Search Quality](https://job-boards.greenhouse.io/gleanwork/jobs/4006735005) | Mountain View, CA; San Francisco, CA | 2022-04-08 | 官方·Greenhouse | valid |
| Adobe | [2027 University Graduate - Machine Learning Engineer](https://adobe.wd5.myworkdayjobs.com/external_experienced/job/San-Jose/XMLNAME-2027-University-Graduate---Machine-Learning-Engineer_R172085) | San Jose; Waltham; San Francisco; Austin; Seattle; Lehi; New | 未知 | 官方·Workday、GitHub New Grad 列表 | valid |
| Analog Devices | [Associate Machine Learning Engineer](https://analogdevices.wd1.myworkdayjobs.com/External/job/US-MA-Boston/Associate-Machine-Learning-Engineer_R266607-1) | US, MA, Boston; United States of America | 未知 | 官方·Workday、GitHub New Grad 列表 | valid |
| AT&T | [AI-Native Software Engineer Analyst, Full-Stack Python](https://att.wd1.myworkdayjobs.com/ATTGeneral/job/USATXDallas--208-S-Akard-St---Concourse208-S-Akard-St--Concourse/AI-Native-Software-Engineer-Analyst--Full-Stack-Python_R-124488-1) | USA:TX:Dallas / 208 S Akard St - Concourse:208 S Akard St @  | 未知 | 官方·Workday、GitHub New Grad 列表 | valid |
| Capital One | [Applied Researcher 5 (AI Foundations - LLM, Optimization and Finetuning)](https://capitalone.wd12.myworkdayjobs.com/Capital_One/job/New-York-NY/Applied-Researcher-5--AI-Foundations---LLM--Optimization-and-Finetuning-_R1001371-1) | New York, NY; McLean, VA; Cambridge, MA; San Jose, CA; Unite | 未知 | 官方·Workday | valid |
| Capital One | [Applied Researcher 4 (AI Foundations, LLM Customization and Finetuning)](https://capitalone.wd12.myworkdayjobs.com/Capital_One/job/San-Jose-CA/Applied-Researcher-4--AI-Foundations--LLM-Customization-and-Finetuning-_R1002964) | San Jose, CA; McLean, VA; Cambridge, MA; New York, NY; Unite | 未知 | 官方·Workday | valid |
| Capital One | [Applied Researcher 4 (AI Foundations: Multimodal Guardrails and VLM's)](https://capitalone.wd12.myworkdayjobs.com/Capital_One/job/Cambridge-MA/Applied-Researcher-4--AI-Foundations--Multimodal-Guardrails-and-VLM-s-_R1003357-1) | Cambridge, MA; McLean, VA; San Jose, CA; New York, NY; Unite | 未知 | 官方·Workday | valid |
| Capital One | [Applied Researcher 4 (AI Foundations, LLM Core and Agentic AI)](https://capitalone.wd12.myworkdayjobs.com/Capital_One/job/San-Jose-CA/Applied-Researcher-4--AI-Foundations--LLM-Core-and-Agentic-AI_R1003483-1) | San Jose, CA; McLean, VA; Cambridge, MA; New York, NY; Unite | 未知 | 官方·Workday | valid |
| Capital One | [Applied Researcher 4 (AI Foundations)](https://capitalone.wd12.myworkdayjobs.com/Capital_One/job/San-Jose-CA/Applied-Researcher-4--AI-Foundations-_R1003658-1) | San Jose, CA; New York, NY; McLean, VA; United States of Ame | 未知 | 官方·Workday | valid |
| Capital One | [Applied Researcher 4 (AI Foundations: Recommendation Systems)](https://capitalone.wd12.myworkdayjobs.com/Capital_One/job/McLean-VA/Applied-Researcher-4--AI-Foundations--Recommendation-Systems-_R1003955-1) | McLean, VA; Cambridge, MA; San Jose, CA; New York, NY; Unite | 未知 | 官方·Workday | valid |
| Crowe | [Machine Learning Software Engineer 1](https://crowe.wd12.myworkdayjobs.com/External_Careers/job/Chicago-IL-USA/Machine-Learning-Software-Engineer-1_R-71006) | Chicago IL USA; Washington DC USA; Tallahassee FL USA; Saras | 未知 | 官方·Workday、GitHub New Grad 列表 | valid |
| GlobalFoundries | [AI Software Engineer (2027 New College Graduate)](https://globalfoundries.wd1.myworkdayjobs.com/External/job/USA---California---Santa-Clara/AI-Software-Engineer--2027-New-College-Graduate-_JR-2604055) | USA - California - Santa Clara; USA - Texas - Richardson; Un | 未知 | 官方·Workday、GitHub New Grad 列表 | valid |
| GlobalFoundries | [AI/ML Systems Engineer (2027 New College Graduate)](https://globalfoundries.wd1.myworkdayjobs.com/External/job/USA---Texas---Richardson/AI-ML-Systems-Engineer--2027-New-College-Graduate-_JR-2604163) | USA - Texas - Richardson; United States of America | 未知 | 官方·Workday、GitHub New Grad 列表 | valid |
| HP | [AI Software Engineer - HP IQ](https://hp.wd5.myworkdayjobs.com/ExternalCareerSite/job/San-Francisco-California-United-States-of-America/AI-Software-Engineer---HP-IQ_3163597-2) | San Francisco, California, United States of America; United  | 未知 | 官方·Workday | valid |
| NVIDIA | [Machine Learning Engineer, AI Safety](https://nvidia.wd5.myworkdayjobs.com/NVIDIAExternalCareerSite/job/US-CA-Santa-Clara/Machine-Learning-Engineer--AI-Safety_JR2021784-1) | US, CA, Santa Clara; US, CA, Remote; United States of Americ | 未知 | 官方·Workday | valid |
| NVIDIA | [Applied Machine Learning Engineer, AI for VLSI Design - New College Grad 2026](https://nvidia.wd5.myworkdayjobs.com/NVIDIAExternalCareerSite/job/US-CA-Santa-Clara/Applied-Machine-Learning-Engineer--AI-for-VLSI-Design---New-College-Grad-2026_JR2026576) | US, CA, Santa Clara; United States of America | 未知 | 官方·Workday、GitHub New Grad 列表 | valid |
| Workday | [AI Engineer](https://workday.wd5.myworkdayjobs.com/Workday/job/USA-CA-Pleasanton/AI-Engineer_JR-0110881) | USA, CA, Pleasanton; United States of America | 未知 | 官方·Workday | valid |
| Fuel Cycle | [Associate AI Engineer (Onsite in Los Angeles)](https://jobs.ashbyhq.com/fuel-cycle/0d24c1b6-e79b-4880-890f-a8ddb53b6d0d) | Los Angeles Office; USA | 2026-10-27 | GitHub New Grad 列表、官方·Ashby | valid |
| Fab2 | [Computer Vision Software Engineer](https://jobs.ashbyhq.com/fab2/d9edb922-6cae-4e65-9b20-ba452f3e2edf) | Austin; United States | 2026-10-27 | GitHub New Grad 列表、官方·Ashby | valid |
| BeyondTrust | [Associate Data Engineer](https://job-boards.greenhouse.io/beyondtrust/jobs/8300876) | Remote United States  | 2026-10-23 | GitHub New Grad 列表、官方·Greenhouse | valid |
| Makai Labs | [AI Engineer](https://jobs.ashbyhq.com/makai-labs/a350e730-8d80-4528-9d41-497acbd01223) | New York; California; Massachusetts; Texas; New Jersey; Nort | 2026-10-23 | GitHub New Grad 列表、官方·Ashby | valid |
| Alchemi | [AI Engineer](https://jobs.ashbyhq.com/alchemi/0b6d993e-e29f-4102-a055-34db1f2797a0) | NYC preferred; United States | 2026-10-21 | GitHub New Grad 列表、官方·Ashby | valid |
| Brain Co. | [AI Product Engineer, 2027 New Grad](https://jobs.ashbyhq.com/brainco/c1788246-305f-4e4f-8b03-8444c76a466e) | San Francisco Bay Area; United States | 2026-10-20 | 官方·Ashby、GitHub New Grad 列表 | valid |
| Scopely | [Software Engineer, Machine Learning](https://job-boards.greenhouse.io/scopely/jobs/5456049008) | US - San Francisco, California, United States | 2026-10-19 | GitHub New Grad 列表、官方·Greenhouse | valid |
| Hive | [Machine Learning Engineer](https://jobs.lever.co/hive/8977b31f-787d-4b17-ab00-5825764774fe) | Seattle | 2026-10-15 | GitHub New Grad 列表、官方·Lever | valid |
| Hive | [Machine Learning Engineer](https://jobs.lever.co/hive/b60b0f85-8aed-4751-9f2c-5b92060c64a2) | San Francisco | 2026-10-15 | GitHub New Grad 列表、官方·Lever | valid |
| Thumbtack | [Software Engineer, AI/ML Infrastructure (US-Based)](https://jobs.ashbyhq.com/thumbtack/3efb1a7b-cfaf-475a-86a9-abff37581b4b) | Remote, United States; United States | 2026-10-14 | GitHub New Grad 列表、官方·Ashby | valid |
| Arizent | [Data & AI Engineer](https://jobs.ashbyhq.com/arizent/5f246f2b-8cd1-41ec-916c-9ed37a6b07a5) | NYC \| Midtown Manhattan; United States | 2026-10-13 | GitHub New Grad 列表、官方·Ashby | valid |
| Brillio | [AI Engineer](https://jobs.lever.co/brillio-2/3de75f8b-9ddc-4908-b67d-d6e91bafd9e2) | Dallas, Texas, United States (US) | 2026-10-12 | GitHub New Grad 列表、官方·Lever | valid |
| Handshake | [Machine Learning Engineer](https://jobs.ashbyhq.com/handshake/42aca7f5-2f58-40ef-a6ce-19027d32a12f) | San Francisco, CA; United States | 2026-10-08 | GitHub New Grad 列表、官方·Ashby | valid |
| Artera | [Machine Learning Scientist, Computational Pathology](https://jobs.lever.co/artera/e69fa8b3-ecad-4f6a-b8b6-77d6542dfbe1) | Remote-US (US) | 2026-10-08 | GitHub New Grad 列表、官方·Lever | valid |
| Niantic Spatial | [AI Engineer, Computer Vision](https://jobs.ashbyhq.com/niantic-spatial/aa5cac58-e677-4238-9d90-f05f3da9cd4f) | San Francisco, CA; United States | 2026-10-07 | GitHub New Grad 列表、官方·Ashby | valid |
| SteerBridge | [Junior NLP Data Scientist](https://jobs.lever.co/steerbridge/16c834c5-5462-46dd-bd83-da94dc2f0101) | Vienna, VA (US) | 2026-10-06 | GitHub New Grad 列表、官方·Lever | valid |
| Mach9 | [ML Engineer, Product](https://jobs.ashbyhq.com/mach9/622a014b-ff77-45bd-9caa-61a6506884ed) | San Francisco; USA | 2026-10-01 | GitHub New Grad 列表、官方·Ashby | valid |

## 小公司 Outreach 队列

140 家公司（官方 Board 在招 ≤30 个岗位作为规模代理，或在 HN Who is hiring 发帖）。其中 24 家在公开招聘帖里写了联系邮箱；没有一个联系人是猜的或从别处查的。负责人姓名未核实一律留空。每家附一份草稿，经历部分留空待你填写，**没有发送任何邮件或私信**。详见 `outreach.json` / `outreach.csv`。

## 每日清单（`jh pending`）

- approve_match：40
- outreach_draft：24
- question：1
- audit_disagreement：16

批准或驳回用 `jh label <清单 id> fit|not_fit`，你的每个决定都存进评测集（`data/labels/triage.jsonl`），以后改规则先在上面跑分。

## 局限

- 规则只看文本。审计给出的是抽样估计，样本量见上表的区间；没有你的标签前，无法算出真实的误筛/漏筛。
- Workday 是关键词搜索，不是全量；LinkedIn/Indeed/Glassdoor/Handshake 只能通过提醒邮件看到，覆盖取决于你订阅的提醒。
- Handshake 提醒邮件正文没有岗位链接，只能作为线索列出，不与其他来源合并（不按公司+职位名合并）。
- 公司规模是名单分组或在招岗位数代理，不是审计过的员工数。
- 匹配不等于你个人符合全部条件（毕业时间、具体技能等），申请前还要看原文。
