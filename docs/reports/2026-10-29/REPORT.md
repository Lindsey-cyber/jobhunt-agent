# 多渠道职位发现报告 · 2026-10-29

运行 2026-10-29 06:36 UTC → 2026-10-29 06:39 UTC，报告生成 2026-10-29 06:39 UTC。信任等级 `draft`：**本轮只发现和筛选，没有打开任何申请表，提交 0 份。**

| 项目 | 数量 |
| --- | ---: |
| 原始发现记录（sightings，含跨渠道重复） | 33793 |
| 去重后岗位（按 ATS Job ID / 官方链接） | 32566 |
| 合并掉的重复记录 | 1205 |
| 无链接线索（Handshake 提醒等，不参与合并） | 22 |
| 规则匹配 match | 577（官方页 168，仅第三方 409） |
| 待核实 review / 排除 reject | 538 / 31451 |
| 匹配岗位链接核验：有效 / 失效 / 受限 / 未能核验 | 525 / 35 / 17 / 0（共核验 577） |
| 匹配岗位中官方发布于近 7 / 30 天 | 10 / 45（421 个无官方发布日期） |
| 全部岗位中官方发布于近 7 / 30 天 | 2549 / 9301 |
| 观察到的公司 / 有匹配的公司 | 1762 / 307 |
| 匹配岗位中属于名单内中大型公司 | 77 / 577 |
| 来源成功 / 失败或跳过 | 236 / 5 |

“近 7/30 天”只用雇主 ATS 给出的发布时间（Greenhouse `first_published`、Lever `createdAt`、Ashby `publishedAt`）。Workday 只给 start date，GitHub 列表和邮件只有转载/收件时间，这些都不当成发布时间。本仓库从今天开始记录每个来源的首次发现时间，下次运行起才能统计“我们新发现”的岗位。

## 渠道贡献

| 渠道 | 发现记录 | 岗位数 | 独有 | 与其他渠道共有 | 渠道内重复率 | 匹配 | 独有匹配 | 官方近7/30天（全部） | 匹配近7/30天 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| GitHub New Grad 列表 | 4147 | 3556 | 3094 | 462 | 14.3% | 521 | 408 | 28/121 | 7/35 |
| Gmail · Glassdoor 提醒 | 161 | 118 | 118 | 0 | 26.7% | 1 | 1 | 0/0 | 0/0 |
| Gmail · Handshake 提醒 | 22 | 22 | 22 | 0 | 0.0% | 0 | 0 | 0/0 | 0/0 |
| Gmail · LinkedIn 提醒 | 422 | 321 | 321 | 0 | 23.9% | 1 | 1 | 0/0 | 0/0 |
| HN Who is hiring | 319 | 319 | 311 | 8 | 0.0% | 0 | 0 | 0/0 | 0/0 |
| 官方 Ashby | 6075 | 6075 | 5952 | 123 | 0.0% | 65 | 19 | 670/2360 | 6/22 |
| 官方 Greenhouse | 19496 | 19496 | 19246 | 250 | 0.0% | 73 | 30 | 1754/6291 | 3/15 |
| 官方 Lever | 2386 | 2386 | 2308 | 78 | 0.0% | 17 | 0 | 124/649 | 0/7 |
| 官方 Workday | 765 | 765 | 746 | 19 | 0.0% | 12 | 5 | 0/0 | 0/0 |

“独有”= 本轮只有这个渠道报告了这个 Job ID。一个岗位可被多个渠道报告，各列不能相加。第三方渠道（GitHub、邮件、HN）的“官方近7/30天”来自同一岗位的官方记录，没有官方记录就算未知。

## 来源覆盖

- 长期监控名单（`config/watchlist.yaml`）：官方 Greenhouse 52 家，官方 Lever 3 家，官方 Ashby 23 家，官方 Workday 25 家，共 17409 个在招岗位。Workday 没有全量接口，每家用固定关键词做有界搜索，召回不完整。
- 从第三方列表顺藤摸瓜抓取的官方 Board：124 个（成功 124），让官方要求而不是转载内容决定筛选。
- SimplifyJobs/New-Grad-Positions：3052 条（16077 rows marked closed by the list were skipped）
- speedyapply/2027-AI-College-Jobs：513 条（0 rows marked closed by the list were skipped）
- Tar-ive/ML_Newgrad_2027：582 条（0 rows marked closed by the list were skipped）
- HN Who is hiring：319 条（Ask HN: Who is hiring? (October 2026); 319 of 319 top-level posts read）
- Gmail：读取近 30 天 161 封 LinkedIn/Glassdoor/Handshake/Indeed 提醒邮件（Gmail API，只读授权）。
  - Gmail linkedin alerts：422 条（124 alert emails）
  - Gmail glassdoor alerts：161 条（23 alert emails）
  - Gmail handshake alerts：22 条（9 alert emails）
  - Gmail indeed alerts：0 条（5 alert emails）
  - Gmail emails without job cards：0 条（58 of 161 emails had no job listing (newsletters, invitations, application receipts)）

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
| reject | `role.out_of_scope` | 26791 | Title is not an AI/ML, research or data-engineering role |
| reject | `level.senior` | 1804 | Senior, staff, lead or manager title |
| reject | `company.excluded` | 1377 | The candidate excluded OpenAI |
| match | `match` | 577 | Official posting; early-career |
| reject | `role.non_engineering` | 392 | Not an engineering, scientist or research title |
| review | `level.unclear` | 362 | No new-grad or 0-2 year signal in title, description or source |
| reject | `location.non_us` | 350 | Location outside the US |
| reject | `experience.too_senior` | 231 | Requires 3+ years |
| reject | `type.internship` | 204 | Internship or co-op, not a full-time role |
| reject | `auth.citizenship` | 166 | Requires US citizenship or clearance |
| review | `role.research_unclear` | 74 | Research title; the text given does not show whether the work is ML |
| reject | `degree.phd_required` | 67 | Description requires a PhD and never mentions a master's |
| reject | `auth.no_sponsorship` | 36 | Posting says no sponsorship |
| reject | `role.research_not_ml` | 33 | Research title, but the posting describes no ML work |
| review | `role.adjacent` | 30 | Quant or statistician title (early-career |
| review | `location.unknown` | 29 | US location not established |
| review | `lead.unresolved` | 27 | Alert or hiring-post lead; find the official posting before judging |
| review | `experience.conflict` | 13 | Early-career title but asks 3+ years |
| review | `auth.no_sponsorship_unverified` | 2 | A third-party copy says no sponsorship |
| review | `degree.phd_mentioned` | 1 | PhD mentioned; check whether a master's qualifies |

## 筛选审计（独立审核 agent 盲评）

本轮尚未完成审计。

## 链接抽样核验

对本轮全部匹配岗位（官方优先）逐个请求岗位页：577 个中有效 525、失效 35、站点拒绝自动访问 17、未能核验 0。“有效”= HTTP 200、没有跳回 Board 首页、页面没有“职位已关闭”字样；官方 API 本轮仍列出该岗位是更强的在招证据。页面有效不等于申请表能提交成功。

| 状态 | 岗位 | 说明 |
| --- | --- | --- |
| blocked | [Pinterest · Machine Learning Engineer, EPD Ads](https://job-boards.greenhouse.io/pinterest/jobs/6121543) | HTTP 403; site refuses automated reads |
| invalid | [BeyondTrust · Associate Data Engineer](https://job-boards.greenhouse.io/beyondtrust/jobs/8300876) | redirected to the board with error=true (posting closed) |
| invalid | [Figma · Data Scientist, Core Data](https://job-boards.greenhouse.io/figma/jobs/5976930004?gh_jid=5976930004) | job URL redirected to the board index |
| invalid | [Adobe · 2027 University Graduate - Machine Learning Engineer](https://careers.adobe.com/us/en/job/R172085/2027-University-Graduate-Machine-Learning-Engineer) | page says: "job you are trying to apply for has been filled" |
| invalid | [42dot · Machine Learning Engineer - Autonomy](https://jobs.ashbyhq.com/42dot/a3788235-4a51-492c-abfd-23b89d6dd411) | HTTP 404 |
| blocked | [Thales · AI Engineer - Graduate](https://www.glassdoor.com/partner/jobListing.htm?pos=101&ao=1110586&s=58&guid=000001a144327a4eb946d5729735233a&t=MJA&vt=e&ja=434335790&uido=B584549837010EE7973294E037A34D0B&cs=1_852bbf23&cb=1792145555510&jobListingId=1010294768001&cpc=AC285F3A3ECA6BB0&jrtk=5-yul1-0-1k5235vs4h71e800-b9064ea2d5c80779---6NYlbfkN0BHJpXzCTjNc0btZuSq203HR0wfNynnp5DhUbxT5tmh9edY953jkZrpsxzz5r1NmW9z26kSnsYMdI4nC4DGJHS6aD1A3k1Hp3XTz4EtAL9rA5M-SnLwMDKymzGwfD13yP_JwrElMK2RVh-fVShN8xsvtyk3m9NyfCv2zq_a539lGYZ1ROSPJtCfXp6OZJApcqYHpERi-RGU2K75Tx3AI3uUdB-y1ksctKzxyHiqM04URcqSZLe8GgJdsT2FDRW8SmN4HE-nuEEgr0AAlr7P2eY0Y-A3Dqs6gMcQwPmgcbE5jKKDH105RitUspyR0GxMCYMy-yt4J-gS3bDs9UtcNdOn3z3pXpx-uiB12THLHfwjcYgC9y_4K_-otMQ5d5d5yeKPKcqDGGdE_3vMXMAyhBZHJbgo-73W3Zuzc6EWfoevn3DC2_yOWQJCTGOqqrSCryH8umHxet7tYxVd3TwU3G27zP69y1_n0qdOOKqNVTa_GSIvJ2QmPeRFR9Ayyz6HQeWAep1oqc-j16My_1yWNDCXYuvNtcbljfZ-yrKlcJJhtyHiPkg88u7YcNgSNdDNTF_wV198Ol4p6JVEBaDANxsMUvxeucbIhYtHHoHNnir9uP5YAodbz1tnguGX6uwUL4yXsl0hRyWxm-su30zOXMIkH9s5SncUko6tKURq8QSk3SdpOEY3s1vHUlZL68GXSPZqER5cwyVGpKT9UbkzzW0Jzw-UTt7J9OhwUmTDAOHlLi-e613T-1Oq7eVAbnKkLOCndfaQyKtbtaEs6EeALYARw4CxjJOO4rHcjceZ_wsJI-eDthuRrWwHaFDmAPIu9RlH3wqKYYe1YWsAhIznC50vJoXNVLi9k7eWhDyg55CqRS1XddUaruNkqPCJEVKwO6ss0aF6WBLaIWIoadVQuJuwyvYNjrVHQk44d-oTo5mSotmeJoFZXj-kBjuUH46ZhiFBXFzbMIgSW25X6TSEEl5LOiWxK8lapkziX8cVUuQQtUwaWhcy2KS97zGb0za9BRY6VncYU54-auw-BGHEtwM0uoX1tu79w3M%3D&tgt=GD_JOB_VIEW&ja=434335790) | HTTP 403; site refuses automated reads |
| invalid | [Avathon · Associate AI Engineer - Physical AI](https://avathon.com/company/careers-job-listing?gh_jid=4736834005) | HTTP 404 |
| blocked | [Study.com · Software Engineer New Grad - AI-Native](https://study.com/pages/jobApplication.html?gh_jid=5429313008) | HTTP 403; site refuses automated reads |
| invalid | [Conviva · AI/ML Engineer](https://www.conviva.ai/careers/job/8036615003?gh_jid=8036615003) | HTTP 404 |
| invalid | [Applied Underwriters · AI Engineer - Infrustructure](https://jobs.lever.co/auw/515a3498-4257-4e68-91ff-cf82e854f12d) | HTTP 404 |
| invalid | [Applied Underwriters · AI Engineer - Data Science](https://jobs.lever.co/auw/6f317af6-4362-4dea-accc-e86ec1d102a5) | HTTP 404 |
| invalid | [Applied Underwriters · AI Engineer - Application Development](https://jobs.lever.co/auw/9234d6e2-f306-48d9-9cd6-9192d34d889c) | HTTP 404 |
| blocked | [SOSi · Data Scientist II](https://jobs.smartrecruiters.com/SOSi1/3743990015026636-data-scientist-ii?oga=true) | HTTP 403; site refuses automated reads |
| blocked | [City of San Francisco · AI Platform Support Engineer - 1042 -Department of Technology](https://jobs.smartrecruiters.com/CityAndCountyOfSanFrancisco1/3743990016403957-ai-platform-support-engineer-1042-department-of-technology?oga=true) | HTTP 403; site refuses automated reads |
| blocked | [Sopra Steria I2S · AI Platform Engineer - m/w/d](https://jobs.smartrecruiters.com/SopraSteria1/744000151827379-ai-platform-engineer-m-w-d-?oga=true) | HTTP 403; site refuses automated reads |
| blocked | [About You · Backend Engineer - Recommendation - all genders](https://jobs.smartrecruiters.com/ABOUTYOUGmbH/744000151832959-backend-engineer-recommendation-all-genders-?oga=true) | HTTP 403; site refuses automated reads |
| blocked | [Eversana · AI Security Engineer I](https://jobs.smartrecruiters.com/EVERSANA1/744000151855805-ai-security-engineer-i?oga=true) | HTTP 403; site refuses automated reads |
| blocked | [Versant Media · Data Engineer II](https://jobs.smartrecruiters.com/Versant3/744000153488694-data-engineer-ii?oga=true) | HTTP 403; site refuses automated reads |
| blocked | [ServiceNow · Machine Learning Engineer](https://jobs.smartrecruiters.com/ServiceNow/744000156637254-machine-learning-engineer?oga=true) | HTTP 403; site refuses automated reads |
| blocked | [Sopra Steria I2S · AI Engineer Cybersecurity - m/w/d](https://jobs.smartrecruiters.com/SopraSteria1/744000158047447-ai-engineer-cybersecurity-m-w-d-?oga=true) | HTTP 403; site refuses automated reads |
| invalid | [Johns Hopkins Applied Physics Laboratory · 2027 Graduate - Software Engineer; Machine Learning Engineer; Data Scientist - Tactical Intelligence Systems](http://careers.jhuapl.edu/jobs/59653) | page says: "job may be no longer available" |
| invalid | [Johns Hopkins Applied Physics Laboratory · 2027 Graduate – Software Engineer; Data Scientist; Ontologist – Threat Analytic Systems](http://careers.jhuapl.edu/jobs/59849) | page says: "job may be no longer available" |
| invalid | [Johns Hopkins Applied Physics Laboratory · 2027 Graduate - Junior AI Platform Engineer](http://careers.jhuapl.edu/jobs/60364) | page says: "job may be no longer available" |
| invalid | [Amazon · Software Development Engineer 1 - AI/ML Network Infrastructure](https://amazon.jobs/en/jobs/10490741/software-development-engineer-i-ai-ml-network-infrastructure-annapurna-labs) | HTTP 404 |
| invalid | [Deloitte · AI and Data Engineering Analyst - Government & Public Services](https://apply.deloitte.com/en_US/careers/JobDetail/Consultative-Offerings-Government-Public-Services-Analyst-AI-Data-Engineering-Winter-2027/365230) | HTTP 404 |

## 匹配岗位（前 80，官方页优先）

完整列表见 `matches.csv`（含全部来源、各来源日期类型、首次发现时间、链接核验）。

| 公司 | 岗位 | 地点 | 官方发布 | 来源 | 链接 |
| --- | --- | --- | --- | --- | --- |
| Applied Intuition | [Software Engineer - Dana for Physical AI](https://jobs.ashbyhq.com/applied/2f3f027d-9f9e-4469-955b-229b04db1141) | Sunnyvale; United States | 2026-10-28 | 官方·Ashby | valid |
| Twilio | [Machine Learning Engineer 2](https://job-boards.greenhouse.io/twilio/jobs/8240487) | Remote - US | 2026-10-28 | 官方·Greenhouse、GitHub New Grad 列表 | valid |
| Together AI | [(Senior/Junior AI Inference Reliability Engineer, Compute Infra](https://job-boards.greenhouse.io/togetherai/jobs/5268939007) | San Francisco | 2026-10-27 | 官方·Greenhouse | valid |
| Lyft | [Data Scientist, Algorithms - Pricing - Rider Engagement](https://job-boards.greenhouse.io/lyft/jobs/8908005002) | San Francisco, CA | 2026-10-22 | 官方·Greenhouse、GitHub New Grad 列表 | valid |
| Lyft | [Data Scientist](https://job-boards.greenhouse.io/lyft/jobs/8896675002) | New York, NY | 2026-10-17 | 官方·Greenhouse | valid |
| Lyft | [Data Scientist](https://job-boards.greenhouse.io/lyft/jobs/8896671002) | San Francisco, CA | 2026-10-17 | 官方·Greenhouse | valid |
| Quora | [Machine Learning Engineer, New Grad - Quora (Remote)](https://jobs.ashbyhq.com/quora/40659fe7-545e-4b08-b6d7-2567b18b9ed3) | Remote - Multiple Locations; United States; Canada; United S | 2026-10-15 | 官方·Ashby、GitHub New Grad 列表 | valid |
| DoorDash USA | [Software Engineer, ML Infrastructure (MDX)](https://job-boards.greenhouse.io/doordashusa/jobs/8283735) | San Francisco, CA; Sunnyvale, CA; Seattle, WA | 2026-10-15 | 官方·Greenhouse | valid |
| Asana | [Software Engineer - AI Teammates Platform](https://job-boards.greenhouse.io/asana/jobs/8194522) | San Francisco | 2026-10-14 | 官方·Greenhouse | valid |
| DoorDash USA | [Software Engineer, Data Platform](https://job-boards.greenhouse.io/doordashusa/jobs/8191886) | San Francisco, CA; Sunnyvale, CA; Seattle, WA; New York City | 2026-10-13 | 官方·Greenhouse | valid |
| Stripe | [Machine Learning Engineer, Radar](https://job-boards.greenhouse.io/stripe/jobs/8243617) | Seattle | 2026-10-07 | 官方·Greenhouse | valid |
| Lyft | [Data Scientist, Algorithms - Dynamic Pricing](https://job-boards.greenhouse.io/lyft/jobs/8856443002) | San Francisco, CA | 2026-10-01 | 官方·Greenhouse、GitHub New Grad 列表 | valid |
| Pinterest | [Master's University Grad Machine Learning Engineer 2027 (USA)](https://job-boards.greenhouse.io/pinterest/jobs/8140219) | San Francisco, CA, US; Palo Alto, CA, US; Seattle, WA, US; N | 2026-10-01 | 官方·Greenhouse、GitHub New Grad 列表 | valid |
| Pinterest | [Master's University Grad Data Scientist (USA)](https://job-boards.greenhouse.io/pinterest/jobs/8140389) | San Francisco, CA, US; Palo Alto, CA, US; Seattle, WA, US; N | 2026-10-01 | 官方·Greenhouse、GitHub New Grad 列表 | valid |
| Quora | [Software Engineer New Grad, Machine Learning Platform - Quora (Remote)](https://jobs.ashbyhq.com/quora/cf34f80e-fe5c-454d-bc9a-4c59993ffda0) | Remote - Multiple Locations; United States; Canada; United S | 2026-09-25 | 官方·Ashby、GitHub New Grad 列表 | valid |
| Block | [Data Scientist, Payments](https://job-boards.greenhouse.io/block/jobs/5214784008) | Bay Area, CA, United States of America | 2026-09-24 | 官方·Greenhouse、GitHub New Grad 列表 | valid |
| Perplexity | [Member of Technical Staff, AI Products (Early Career - Industry)](https://jobs.ashbyhq.com/perplexity/daa9120e-94ff-46e0-b4bd-4d2d290cb409) | San Francisco; United States | 2026-09-23 | 官方·Ashby | valid |
| Applied Intuition | [Robot Learning Engineer - Manipulation](https://jobs.ashbyhq.com/applied/ef7fb9ed-e254-4b90-aef2-efa9c30e7cd8) | Sunnyvale; United States | 2026-09-21 | 官方·Ashby | valid |
| Waymo | [Research Scientist, Map Scalability](https://job-boards.greenhouse.io/waymo/jobs/8180692) | Mountain View, CA, U.S.A ; San Francisco, CA, U.S.A ; New Yo | 2026-09-08 | 官方·Greenhouse、GitHub New Grad 列表 | valid |
| Snowflake | [AI Research Scientist, New Grad – Agents & Reinforcement Learning](https://jobs.ashbyhq.com/snowflake/1bad12df-f443-426f-9d09-e96fc780d698) | US-WA-Bellevue; United States | 2026-09-03 | 官方·Ashby、GitHub New Grad 列表 | valid |
| Lyft | [Data Scientist](https://job-boards.greenhouse.io/lyft/jobs/8772592002) | Seattle, WA | 2026-09-02 | 官方·Greenhouse | valid |
| Pinterest | [Machine Learning Engineer II, Responsible AI](https://job-boards.greenhouse.io/pinterest/jobs/8162046) | San Francisco, CA, US; Remote, US | 2026-08-27 | 官方·Greenhouse | valid |
| Scale AI | [Machine Learning Research Scientist, Evaluations](https://job-boards.greenhouse.io/scaleai/jobs/4728014005) | San Francisco, CA; Seattle, WA; New York, NY | 2026-08-26 | 官方·Greenhouse、GitHub New Grad 列表 | valid |
| Applied Intuition | [Research Scientist - Humanoid Robotics](https://jobs.ashbyhq.com/applied/4cd7cf1d-717c-4887-93b4-520a40a906b1) | Sunnyvale; United States | 2026-08-22 | 官方·Ashby、GitHub New Grad 列表 | valid |
| Lyft | [Machine Learning Engineer](https://job-boards.greenhouse.io/lyft/jobs/8689127002) | New York, NY | 2026-08-18 | 官方·Greenhouse | valid |
| Lyft | [Machine Learning Engineer, Fulfillment](https://job-boards.greenhouse.io/lyft/jobs/8688633002) | San Francisco, CA | 2026-08-18 | 官方·Greenhouse | valid |
| Applied Intuition | [Research Engineer - New Grad (2027)](https://jobs.ashbyhq.com/applied/45fc41cd-8280-4010-ba1f-def6114b3e39) | Sunnyvale; United States | 2026-08-14 | 官方·Ashby、GitHub New Grad 列表 | valid |
| Nuro | [Software Engineer, ML Inference Platform](https://job-boards.greenhouse.io/nuro/jobs/8122537) | Mountain View, California (HQ) | 2026-08-11 | 官方·Greenhouse、GitHub New Grad 列表 | valid |
| Nuro | [Software Engineer, ML Infrastructure Platform](https://job-boards.greenhouse.io/nuro/jobs/8122483) | Mountain View, California (HQ) | 2026-08-11 | 官方·Greenhouse、GitHub New Grad 列表 | valid |
| Affirm | [Machine Learning Engineer II (Underwriting ML)](https://job-boards.greenhouse.io/affirm/jobs/7822387003) | Remote US | 2026-08-06 | 官方·Greenhouse | valid |
| Glean | [Machine Learning Engineer, Assistant Quality](https://job-boards.greenhouse.io/gleanwork/jobs/4711484005) | San Francisco, CA | 2026-08-03 | 官方·Greenhouse、GitHub New Grad 列表 | valid |
| Applied Intuition | [Machine Learning Engineer - Behavior and Planning](https://jobs.ashbyhq.com/applied/129325ce-77e6-4d2a-a24a-6726acb53749) | Sunnyvale; United States | 2026-07-29 | 官方·Ashby | valid |
| NewsBreak | [Applied AI Engineer, Advertising Agents (New Grad)](https://job-boards.greenhouse.io/newsbreak/jobs/4700278006) | Mountain View, California, United States | 2026-07-27 | 官方·Greenhouse、GitHub New Grad 列表 | valid |
| Applied Intuition | [Research Scientist - 3D Vision and Generation, Self-Driving](https://jobs.ashbyhq.com/applied/5f15c171-ae5a-496b-a8eb-c6a351d55b6b) | Sunnyvale; United States | 2026-07-24 | 官方·Ashby、GitHub New Grad 列表 | valid |
| Together AI | [[Junior / Senior / Staff] Software Engineer, Inference / Compute Infrastructure Engineering](https://job-boards.greenhouse.io/togetherai/jobs/5186628007) | San Francisco | 2026-07-16 | 官方·Greenhouse | valid |
| NewsBreak | [NewsBreak Venture, AI Growth Intelligence Engineer (New Grad）](https://job-boards.greenhouse.io/newsbreak/jobs/4694899006) | Mountain View, California, United States | 2026-07-06 | 官方·Greenhouse、GitHub New Grad 列表 | valid |
| Notion | [Software Engineer, Early Career (AI)](https://jobs.ashbyhq.com/notion/85947779-6b87-466a-98bc-30a640448c28) | San Francisco, California; United States | 2026-07-06 | 官方·Ashby、GitHub New Grad 列表 | valid |
| Together AI | [Research Engineer, Post-Training Inference](https://job-boards.greenhouse.io/togetherai/jobs/5179372007) | San Francisco | 2026-07-06 | 官方·Greenhouse | valid |
| NewsBreak | [Applied AI Engineer, Advertising Agents](https://job-boards.greenhouse.io/newsbreak/jobs/4690262006) | Mountain View, California, United States | 2026-06-17 | 官方·Greenhouse、GitHub New Grad 列表 | valid |
| Nuro | [Software Engineer, ML Infrastructure, Optimization](https://job-boards.greenhouse.io/nuro/jobs/6916236) | Mountain View, California (HQ) | 2026-06-16 | 官方·Greenhouse | valid |
| Anduril Industries | [Software Engineer, Perception](https://job-boards.greenhouse.io/andurilindustries/jobs/5165250007) | Costa Mesa, California, United States | 2026-06-15 | 官方·Greenhouse | valid |
| Toast | [Data Scientist II](https://job-boards.greenhouse.io/toast/jobs/7984730) | Remote, USA | 2026-06-12 | 官方·Greenhouse | valid |
| Databricks | [AI Engineer – Forward Deployed Engineering (AI FDE)](https://job-boards.greenhouse.io/databricks/jobs/8546367002) | United States | 2026-05-13 | 官方·Greenhouse | valid |
| Applied Intuition | [Software Engineer - AI Engineering](https://jobs.ashbyhq.com/applied/981054d6-d6d9-4553-9db8-38e56939d3b8) | Sunnyvale; United States | 2026-03-25 | 官方·Ashby | valid |
| Pinterest | [Machine Learning Engineer II, Visual AI](https://job-boards.greenhouse.io/pinterest/jobs/7697137) | San Francisco, CA, US; Remote, US | 2026-03-10 | 官方·Greenhouse | valid |
| Applied Intuition | [Software Engineer - Systems Engineering AI Tooling](https://jobs.ashbyhq.com/applied/6cce20b1-2250-4350-9952-9691f58fb074) | Sunnyvale; United States | 2026-03-07 | 官方·Ashby | valid |
| Applied Intuition | [Research Engineer - Reinforcement Learning, Self-Driving](https://jobs.ashbyhq.com/applied/36a49d01-e60f-4c01-8c8c-5a7f79347f51) | Sunnyvale; United States | 2026-02-13 | 官方·Ashby | valid |
| Applied Intuition | [Research Engineer - 3D Vision and Generation, Self-Driving](https://jobs.ashbyhq.com/applied/8da87c90-49ff-4b75-97c5-337882f63a00) | Sunnyvale; United States | 2026-02-13 | 官方·Ashby | valid |
| Pinterest | [Machine Learning Engineer II, Core Engineering](https://job-boards.greenhouse.io/pinterest/jobs/7473497) | Toronto, ON, CA | 2025-12-23 | 官方·Greenhouse | valid |
| Waymo | [Software Engineer, Perception Scaling Evaluation](https://job-boards.greenhouse.io/waymo/jobs/7449712) | Mountain View, CA, USA; San Francisco, CA, USA | 2025-12-11 | 官方·Greenhouse | valid |
| NewsBreak | [Software Engineer, ML Infra (Junior & New Grad)](https://job-boards.greenhouse.io/newsbreak/jobs/4615879006) | Mountain View, California, United States | 2025-11-05 | 官方·Greenhouse、GitHub New Grad 列表 | valid |
| Nuro | [Software Engineer, AI Platform - New Grad](https://job-boards.greenhouse.io/nuro/jobs/7351066) | Mountain View, California (HQ) | 2025-10-22 | 官方·Greenhouse | valid |
| Applied Intuition | [Research Engineer - Robotic Hardware, Simulation and Data](https://jobs.ashbyhq.com/applied/4cb44794-7b3b-46fc-9408-104a6d0f379e) | Sunnyvale; United States | 2025-08-19 | 官方·Ashby | valid |
| Applied Intuition | [Research Engineer - Robot Learning](https://jobs.ashbyhq.com/applied/e725018e-2577-4ff6-8dbd-69206272d9af) | Sunnyvale; United States | 2025-08-19 | 官方·Ashby | valid |
| Waymo | [Machine Learning Engineer, Prediction & Planning](https://job-boards.greenhouse.io/waymo/jobs/6506689) | Mountain View, CA, USA; San Francisco, CA, USA | 2025-04-28 | 官方·Greenhouse | valid |
| Applied Intuition | [Research Engineer - AI/RL Infrastructure](https://jobs.ashbyhq.com/applied/091ed808-95c9-420b-8061-0ff2eb9342bc) | Sunnyvale; United States | 2024-09-17 | 官方·Ashby | valid |
| Pinterest | [Machine Learning Engineer, Core Engineering](https://job-boards.greenhouse.io/pinterest/jobs/6121450) | San Francisco, CA, US; Palo Alto, CA, US; Seattle, WA, US; R | 2024-07-24 | 官方·Greenhouse | valid |
| DoorDash USA | [Data Scientist / Senior Data Scientist](https://job-boards.greenhouse.io/doordashusa/jobs/6103225) | San Francisco, CA; Seattle, WA; New York, NY; Los Angeles, C | 2024-07-10 | 官方·Greenhouse | valid |
| Adobe | [2027 University Graduate - Machine Learning Engineer](https://adobe.wd5.myworkdayjobs.com/external_experienced/job/San-Jose/XMLNAME-2027-University-Graduate---Machine-Learning-Engineer_R172085) | San Jose; Waltham; San Francisco; Austin; Seattle; Lehi; New | 未知 | 官方·Workday、GitHub New Grad 列表 | valid |
| Analog Devices | [Associate Machine Learning Engineer](https://analogdevices.wd1.myworkdayjobs.com/External/job/US-MA-Boston/Associate-Machine-Learning-Engineer_R266607-1) | US, MA, Boston; United States of America | 未知 | 官方·Workday、GitHub New Grad 列表 | valid |
| Crowe | [Machine Learning Software Engineer 1](https://crowe.wd12.myworkdayjobs.com/External_Careers/job/Chicago-IL-USA/Machine-Learning-Software-Engineer-1_R-71006) | Chicago IL USA; Washington DC USA; Tallahassee FL USA; Saras | 未知 | 官方·Workday、GitHub New Grad 列表 | valid |
| GlobalFoundries | [AI Software Engineer (2027 New College Graduate)](https://globalfoundries.wd1.myworkdayjobs.com/External/job/USA---California---Santa-Clara/AI-Software-Engineer--2027-New-College-Graduate-_JR-2604055) | USA - California - Santa Clara; USA - Texas - Richardson; Un | 未知 | 官方·Workday、GitHub New Grad 列表 | valid |
| GlobalFoundries | [AI/ML Systems Engineer (2027 New College Graduate)](https://globalfoundries.wd1.myworkdayjobs.com/External/job/USA---Texas---Richardson/AI-ML-Systems-Engineer--2027-New-College-Graduate-_JR-2604163) | USA - Texas - Richardson; United States of America | 未知 | 官方·Workday、GitHub New Grad 列表 | valid |
| GlobalFoundries | [AI enabled PDK Development Engineer](https://globalfoundries.wd1.myworkdayjobs.com/External/job/USA---New-York---Malta/AI-enabled-PDK-Development-Engineer_JR-2606087) | USA - New York - Malta; Essex Junction; United States of Ame | 未知 | 官方·Workday | valid |
| HP | [AI Software Engineer - HP IQ](https://hp.wd5.myworkdayjobs.com/ExternalCareerSite/job/San-Francisco-California-United-States-of-America/AI-Software-Engineer---HP-IQ_3163597-2) | San Francisco, California, United States of America; United  | 未知 | 官方·Workday | valid |
| Intel | [Compiler Engineer for AI DSLs](https://intel.wd1.myworkdayjobs.com/External/job/US-California-Santa-Clara/Compiler-Engineer-for-AI-DSLs_JR0288433) | US, California, Santa Clara; US, Massachusetts, Beaver Brook | 未知 | 官方·Workday、GitHub New Grad 列表 | valid |
| Mastercard | [Data Engineer II](https://mastercard.wd1.myworkdayjobs.com/CorporateCareers/job/OFallon-Missouri/Data-Engineer-II_R-289305) | O'Fallon, Missouri; United States of America | 未知 | 官方·Workday | valid |
| NVIDIA | [Machine Learning Engineer, AI Safety](https://nvidia.wd5.myworkdayjobs.com/NVIDIAExternalCareerSite/job/US-CA-Santa-Clara/Machine-Learning-Engineer--AI-Safety_JR2021784-1) | US, CA, Santa Clara; US, CA, Remote; United States of Americ | 未知 | 官方·Workday | valid |
| NVIDIA | [Applied Machine Learning Engineer, AI for VLSI Design - New College Grad 2026](https://nvidia.wd5.myworkdayjobs.com/NVIDIAExternalCareerSite/job/US-CA-Santa-Clara/Applied-Machine-Learning-Engineer--AI-for-VLSI-Design---New-College-Grad-2026_JR2026576) | US, CA, Santa Clara; United States of America | 未知 | 官方·Workday、GitHub New Grad 列表 | valid |
| Verizon | [Associate Director -AI/ML Engineering](https://verizon.wd12.myworkdayjobs.com/verizon-careers/job/Irving-Texas/Associate-Director--AI-ML-Engineering_R-1100571-1) | Irving, Texas; Basking Ridge, New Jersey; United States of A | 未知 | 官方·Workday | valid |
| Fuel Cycle | [Associate AI Engineer (Onsite in Los Angeles)](https://jobs.ashbyhq.com/fuel-cycle/0d24c1b6-e79b-4880-890f-a8ddb53b6d0d) | Los Angeles Office; USA | 2026-10-27 | GitHub New Grad 列表、官方·Ashby | valid |
| Fab2 | [Computer Vision Software Engineer](https://jobs.ashbyhq.com/fab2/d9edb922-6cae-4e65-9b20-ba452f3e2edf) | Austin; United States | 2026-10-27 | GitHub New Grad 列表、官方·Ashby | valid |
| Jerry | [Data Scientist](https://jobs.ashbyhq.com/jerry.ai/74b5781f-8834-4e74-be8d-8be0fe895b99) | New York, New York; Chicago, Illinois; Boston, Massachusetts | 2026-10-26 | 官方·Ashby | valid |
| Jerry | [Associate Data Scientist](https://jobs.ashbyhq.com/jerry.ai/271b73bc-2b1a-4be6-b3dc-d72d806b8e35) | New York, New York; Chicago, Illinois; Boston, Massachusetts | 2026-10-26 | GitHub New Grad 列表、官方·Ashby | valid |
| Makai Labs | [AI Engineer](https://jobs.ashbyhq.com/makai-labs/a350e730-8d80-4528-9d41-497acbd01223) | New York; California; Massachusetts; Texas; New Jersey; Nort | 2026-10-23 | GitHub New Grad 列表、官方·Ashby | valid |
| Alchemi | [AI Engineer](https://jobs.ashbyhq.com/alchemi/0b6d993e-e29f-4102-a055-34db1f2797a0) | NYC preferred; United States | 2026-10-21 | GitHub New Grad 列表、官方·Ashby | valid |
| Brain Co. | [AI Product Engineer, 2027 New Grad](https://jobs.ashbyhq.com/brainco/c1788246-305f-4e4f-8b03-8444c76a466e) | San Francisco Bay Area; United States | 2026-10-20 | 官方·Ashby、GitHub New Grad 列表 | valid |
| Scopely | [Software Engineer, Machine Learning](https://job-boards.greenhouse.io/scopely/jobs/5456049008) | US - San Francisco, California, United States | 2026-10-19 | GitHub New Grad 列表、官方·Greenhouse | valid |
| Aurora Innovation | [Software Engineer II, Perception](https://jobs.ashbyhq.com/aurora-operations-inc/70b6130c-1207-47bc-8bba-06ad3a1d4154) | Pittsburgh, PA; United States | 2026-10-16 | GitHub New Grad 列表、官方·Ashby | valid |
| American Institutes for Research | [Data Scientist, Project Success and Innovation](https://job-boards.greenhouse.io/americaninstitutesforresearch/jobs/5454172008) | US-Remote \| US-VA-Arlington \| US-NC-Chapel Hill \| US-IL-Chic | 2026-10-16 | GitHub New Grad 列表、官方·Greenhouse | valid |

## 小公司 Outreach 队列

162 家公司（官方 Board 在招 ≤30 个岗位作为规模代理，或在 HN Who is hiring 发帖）。其中 30 家在公开招聘帖里写了联系邮箱；没有一个联系人是猜的或从别处查的。负责人姓名未核实一律留空。每家附一份草稿，经历部分留空待你填写，**没有发送任何邮件或私信**。详见 `outreach.json` / `outreach.csv`。

## 每日清单（`jh pending`）

- outreach_draft：30
- question：204
- drafted_answer：135
- submit_by_hand：15
- audit_disagreement：7
- approve_match：40

批准或驳回用 `jh label <清单 id> fit|not_fit`，你的每个决定都存进评测集（`data/labels/triage.jsonl`），以后改规则先在上面跑分。

## 局限

- 规则只看文本。审计给出的是抽样估计，样本量见上表的区间；没有你的标签前，无法算出真实的误筛/漏筛。
- Workday 是关键词搜索，不是全量；LinkedIn/Indeed/Glassdoor/Handshake 只能通过提醒邮件看到，覆盖取决于你订阅的提醒。
- Handshake 提醒邮件正文没有岗位链接，只能作为线索列出，不与其他来源合并（不按公司+职位名合并）。
- 公司规模是名单分组或在招岗位数代理，不是审计过的员工数。
- 匹配不等于你个人符合全部条件（毕业时间、具体技能等），申请前还要看原文。
