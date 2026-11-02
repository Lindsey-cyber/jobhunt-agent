# 多渠道职位发现报告 · 2026-11-02

运行 2026-11-02 03:42 UTC → 2026-11-02 03:57 UTC，报告生成 2026-11-02 03:57 UTC。信任等级 `draft`：**本轮只发现和筛选，没有打开任何申请表，提交 0 份。**

| 项目 | 数量 |
| --- | ---: |
| 原始发现记录（sightings，含跨渠道重复） | 90176 |
| 去重后岗位（按 ATS Job ID / 官方链接） | 86915 |
| 合并掉的重复记录 | 3256 |
| 无链接线索（Handshake 提醒等，不参与合并） | 5 |
| 规则匹配 match | 870（官方页 384，仅第三方 486） |
| 待核实 review / 排除 reject | 781 / 85264 |
| 匹配岗位链接核验：有效 / 失效 / 受限 / 未能核验 | 789 / 40 / 41 / 0（共核验 870） |
| 匹配岗位中官方发布于近 7 / 30 天 | 13 / 55（596 个无官方发布日期） |
| 全部岗位中官方发布于近 7 / 30 天 | 5991 / 21162 |
| 观察到的公司 / 有匹配的公司 | 2446 / 397 |
| 匹配岗位中属于名单内中大型公司 | 117 / 870 |
| 来源成功 / 失败或跳过 | 1560 / 10 |

“近 7/30 天”只用雇主 ATS 给出的发布时间（Greenhouse `first_published`、Lever `createdAt`、Ashby `publishedAt`）。Workday 只给 start date，GitHub 列表和邮件只有转载/收件时间，这些都不当成发布时间。本仓库从今天开始记录每个来源的首次发现时间，下次运行起才能统计“我们新发现”的岗位。

## 渠道贡献

| 渠道 | 发现记录 | 岗位数 | 独有 | 与其他渠道共有 | 渠道内重复率 | 匹配 | 独有匹配 | 官方近7/30天（全部） | 匹配近7/30天 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| GitHub New Grad 列表 | 6373 | 5371 | 4103 | 1268 | 15.7% | 665 | 485 | 91/328 | 6/28 |
| Gmail · Glassdoor 提醒 | 97 | 75 | 75 | 0 | 22.7% | 0 | 0 | 0/0 | 0/0 |
| Gmail · Handshake 提醒 | 5 | 5 | 5 | 0 | 0.0% | 0 | 0 | 0/0 | 0/0 |
| Gmail · LinkedIn 提醒 | 51 | 50 | 50 | 0 | 2.0% | 0 | 0 | 0/0 | 0/0 |
| HN Who is hiring | 318 | 318 | 258 | 60 | 0.0% | 2 | 2 | 0/4 | 0/0 |
| 官方 Ashby | 10815 | 10704 | 10361 | 343 | 1.0% | 128 | 80 | 1003/3584 | 8/30 |
| 官方 Greenhouse | 59971 | 59971 | 59304 | 667 | 0.0% | 123 | 74 | 4722/16355 | 5/19 |
| 官方 Lever | 7321 | 7321 | 7152 | 169 | 0.0% | 22 | 4 | 266/1223 | 0/6 |
| 官方 Workday | 5225 | 4433 | 4285 | 148 | 15.2% | 110 | 45 | 0/0 | 0/0 |

“独有”= 本轮只有这个渠道报告了这个 Job ID。一个岗位可被多个渠道报告，各列不能相加。第三方渠道（GitHub、邮件、HN）的“官方近7/30天”来自同一岗位的官方记录，没有官方记录就算未知。

## 来源覆盖

- 长期监控名单（`config/watchlist.yaml`）：官方 Greenhouse 656 家，官方 Lever 90 家，官方 Ashby 277 家，官方 Workday 523 家，共 83019 个在招岗位。Workday 没有全量接口，每家用固定关键词做有界搜索，召回不完整。
- 从第三方列表顺藤摸瓜抓取的官方 Board：2 个（成功 2），让官方要求而不是转载内容决定筛选。
- SimplifyJobs/New-Grad-Positions：3120 条（15784 rows marked closed by the list were skipped）
- speedyapply/2027-AI-College-Jobs：521 条（0 rows marked closed by the list were skipped）
- Tar-ive/ML_Newgrad_2027：687 条（0 rows marked closed by the list were skipped）
- cvrve/New-Grad：830 条（1068 rows marked closed by the list were skipped）
- speedyapply/2027-SWE-College-Jobs：869 条（0 rows marked closed by the list were skipped）
- zapplyjobs/New-Grad-Data-Science-Jobs-2027：346 条（0 rows marked closed by the list were skipped）
- HN Who is hiring：318 条（Ask HN: Who is hiring? (October 2026); 319 of 319 top-level posts read）
- Gmail：读取近 30 天 34 封 LinkedIn/Glassdoor/Handshake/Indeed 提醒邮件（Gmail API，只读授权）。
  - Gmail linkedin alerts：51 条（20 alert emails）
  - Gmail glassdoor alerts：97 条（12 alert emails）
  - Gmail handshake alerts：5 条（2 alert emails）
  - Gmail indeed alerts：0 条（0 alert emails）
  - Gmail emails without job cards：0 条（11 of 34 emails had no job listing (newsletters, invitations, application receipts)）

失败的来源：

- Choice Hotels（官方 Workday）：HTTP 500 for https://choicehotels.wd5.myworkdayjobs.com/wday/cxs/choicehotels/external/jobs
- Huntington Bank（官方 Workday）：HTTP 500 for https://huntington.wd12.myworkdayjobs.com/wday/cxs/huntington/hnbcareers/jobs
- Nordstrom（官方 Workday）：HTTP 500 for https://nordstrom.wd501.myworkdayjobs.com/wday/cxs/nordstrom/nordstrom_careers/jobs
- Tommy Bahama（官方 Workday）：HTTP 500 for https://oxford.wd5.myworkdayjobs.com/wday/cxs/oxford/tommybahamaus/jobs
- Signet Jewelers（官方 Workday）：HTTP 500 for https://signetjewelers.wd1.myworkdayjobs.com/wday/cxs/signetjewelers/SignetCorporateCareers/jobs

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
| reject | `role.out_of_scope` | 69143 | Title is not an AI/ML, research or data-engineering role |
| reject | `level.senior` | 5036 | Senior, staff, lead or manager title |
| reject | `role.non_engineering` | 4515 | Not an engineering, scientist or research title |
| reject | `company.excluded` | 3149 | The candidate excluded OpenAI |
| reject | `location.non_us` | 1162 | Location outside the US |
| match | `match` | 795 | Official posting; early-career |
| reject | `experience.too_senior` | 792 | Requires 5+ years |
| reject | `type.internship` | 647 | Internship or co-op, not a full-time role |
| review | `level.unclear` | 582 | No new-grad or 0-2 year signal in title, description or source |
| reject | `auth.citizenship` | 394 | Requires US citizenship or clearance |
| reject | `role.research_not_ml` | 150 | Research title, but the posting describes no ML work |
| reject | `auth.no_sponsorship` | 140 | Posting says no sponsorship |
| review | `location.unknown` | 114 | US location not established |
| reject | `degree.phd_required` | 92 | Description requires a PhD and never mentions a master's |
| match | `model.fit` | 75 | Model triage (level.unclear) |
| reject | `model.not_fit` | 38 | Model triage (level.unclear) |
| review | `role.research_unclear` | 26 | Research title; the text given does not show whether the work is ML |
| review | `experience.conflict` | 23 | Early-career title but asks 3+ years |
| review | `lead.unresolved` | 16 | Alert or hiring-post lead; find the official posting before judging |
| review | `auth.list_says_no_sponsorship` | 11 | New-grad list says …; confirm on the official posting |
| reject | `eligibility.school_only` | 6 | Open only to UF; not one of her schools |
| review | `role.adjacent` | 6 | Quant or statistician title (early-career |
| review | `auth.no_sponsorship_unverified` | 2 | A third-party copy says no sponsorship |
| review | `degree.phd_mentioned` | 1 | PhD mentioned; check whether a master's qualifies |

## 筛选审计（独立审核 agent 盲评）

本轮尚未完成审计。

## 链接抽样核验

对本轮全部匹配岗位（官方优先）逐个请求岗位页：870 个中有效 789、失效 40、站点拒绝自动访问 41、未能核验 0。“有效”= HTTP 200、没有跳回 Board 首页、页面没有“职位已关闭”字样；官方 API 本轮仍列出该岗位是更强的在招证据。页面有效不等于申请表能提交成功。

| 状态 | 岗位 | 说明 |
| --- | --- | --- |
| invalid | [Cursor (Anysphere) · Software Engineer, ML Platform](https://jobs.ashbyhq.com/cursor/167f0e93-6915-4d56-803a-be89d1441fb5) | HTTP 404 |
| invalid | [Cursor (Anysphere) · Software Engineer, Model Routing & Inference](https://jobs.ashbyhq.com/cursor/45c815b0-5100-4934-8558-0e750b8aed79) | HTTP 404 |
| invalid | [Cursor (Anysphere) · Research Scientist](https://jobs.ashbyhq.com/cursor/cd4bad0a-e2f6-4a8d-9b57-ce1780efedae) | HTTP 404 |
| invalid | [Idler · Research Scientist](https://jobs.ashbyhq.com/idler/3a8b02ec-c567-4f75-bf73-ec763e06d6eb) | HTTP 404 |
| invalid | [Figma · Data Scientist, Core Data](https://job-boards.greenhouse.io/figma/jobs/5976930004?gh_jid=5976930004) | job URL redirected to the board index |
| invalid | [Adobe · 2027 University Graduate - Machine Learning Engineer](https://careers.adobe.com/us/en/job/R172085/2027-University-Graduate-Machine-Learning-Engineer) | page says: "job you are trying to apply for has been filled" |
| invalid | [Avathon · Associate AI Engineer - Physical AI](https://avathon.com/company/careers-job-listing?gh_jid=4736834005) | HTTP 404 |
| blocked | [Study.com · Software Engineer New Grad - AI-Native](https://study.com/pages/jobApplication.html?gh_jid=5429313008) | HTTP 403; site refuses automated reads |
| invalid | [Conviva · AI/ML Engineer](https://www.conviva.ai/careers/job/8036615003?gh_jid=8036615003) | HTTP 404 |
| blocked | [SOSi · Data Scientist II](https://jobs.smartrecruiters.com/SOSi1/3743990015026636-data-scientist-ii?oga=true) | HTTP 403; site refuses automated reads |
| blocked | [SBT Global · Jr. AI Developer - Korean Bilingual MUST](https://jobs.smartrecruiters.com/SBTGlobalInc/3743990016165776-jr-ai-developer-korean-bilingual-must?oga=true) | HTTP 403; site refuses automated reads |
| blocked | [About You · Backend Engineer - Recommendation - all genders](https://jobs.smartrecruiters.com/ABOUTYOUGmbH/744000151832959-backend-engineer-recommendation-all-genders-?oga=true) | HTTP 403; site refuses automated reads |
| blocked | [Eversana · AI Security Engineer I](https://jobs.smartrecruiters.com/EVERSANA1/744000151855805-ai-security-engineer-i?oga=true) | HTTP 403; site refuses automated reads |
| blocked | [M3 USA · AI Software Engineer - Remote](https://jobs.smartrecruiters.com/M3USA/744000152758649-ai-software-engineer-remote-?oga=true) | HTTP 403; site refuses automated reads |
| blocked | [Versant Media · Data Engineer II](https://jobs.smartrecruiters.com/Versant3/744000153488694-data-engineer-ii?oga=true) | HTTP 403; site refuses automated reads |
| blocked | [Sopra Steria I2S · AI Requirements Engineer Public Sector - m/w/d](https://jobs.smartrecruiters.com/SopraSteria1/744000158465629-ai-requirements-engineer-public-sector-m-w-d-?oga=true) | HTTP 403; site refuses automated reads |
| blocked | [Sopra Steria I2S · AI Engineer Cybersecurity - m/w/d](https://jobs.smartrecruiters.com/SopraSteria1/744000158492839-ai-engineer-cybersecurity-m-w-d-?oga=true) | HTTP 403; site refuses automated reads |
| invalid | [Johns Hopkins Applied Physics Laboratory · 2027 Graduate - Software Engineer; Machine Learning Engineer; Data Scientist - Tactical Intelligence Systems](http://careers.jhuapl.edu/jobs/59653) | page says: "job may be no longer available" |
| invalid | [Johns Hopkins Applied Physics Laboratory · 2027 Graduate – Software Engineer; Data Scientist; Ontologist – Threat Analytic Systems](http://careers.jhuapl.edu/jobs/59849) | page says: "job may be no longer available" |
| invalid | [Johns Hopkins Applied Physics Laboratory · 2027 Graduate - Junior AI Platform Engineer](http://careers.jhuapl.edu/jobs/60364) | page says: "job may be no longer available" |
| invalid | [Anthony & Sylvan Pools · AI Solutions Developer](https://ats.rippling.com/anthony-sylvan-pools/jobs/1cda6c1a-ec72-4356-afd4-15e13c45d015) | page says: "jobNotFoundMessage":"This job post is no longer available" |
| invalid | [Cruise Planners · Data & AI Engineer](https://ats.rippling.com/cruiseplanners/jobs/414d04d4-f099-4a35-8fbc-1cc7bec70462) | page says: "jobNotFoundMessage":"This job post is no longer available" |
| invalid | [Go Fish Digital · Media and Marketing Data Scientist](https://ats.rippling.com/gofishdigital/jobs/38101c5d-0279-4f4b-83b0-dd176bff7fc2) | page says: "jobNotFoundMessage":"This job post is no longer available" |
| invalid | [Oxbridge Health · AI Engineer](https://ats.rippling.com/oxbridge-health/jobs/196c59b6-8360-4766-a205-f873a3d2c2f4) | page says: "jobNotFoundMessage":"This job post is no longer available" |
| invalid | [Tavern Research · Data Scientist 1](https://ats.rippling.com/tavernresearch/jobs/1a3cfbeb-973a-4528-8fc6-43c04e179ea8) | page says: "jobNotFoundMessage":"This job post is no longer available" |

## 匹配岗位（前 80，官方页优先）

完整列表见 `matches.csv`（含全部来源、各来源日期类型、首次发现时间、链接核验）。

| 公司 | 岗位 | 地点 | 官方发布 | 来源 | 链接 |
| --- | --- | --- | --- | --- | --- |
| Zocdoc | [Data Scientist](https://job-boards.greenhouse.io/zocdoc/jobs/8335345) | New York, NY | 2026-10-29 | 官方·Greenhouse | valid |
| Applied Intuition | [Software Engineer - Dana for Physical AI](https://jobs.ashbyhq.com/applied/2f3f027d-9f9e-4469-955b-229b04db1141) | Sunnyvale; United States | 2026-10-28 | 官方·Ashby | valid |
| Twilio | [Machine Learning Engineer 2](https://job-boards.greenhouse.io/twilio/jobs/8240487) | Remote - US | 2026-10-28 | 官方·Greenhouse、GitHub New Grad 列表 | valid |
| Together AI | [(Senior/Junior AI Inference Reliability Engineer, Compute Infra](https://job-boards.greenhouse.io/togetherai/jobs/5268939007) | San Francisco | 2026-10-27 | 官方·Greenhouse | valid |
| Lyft | [Data Scientist, Algorithms - Pricing - Rider Engagement](https://job-boards.greenhouse.io/lyft/jobs/8908005002) | San Francisco, CA | 2026-10-22 | 官方·Greenhouse、GitHub New Grad 列表 | valid |
| Quora | [Machine Learning Engineer, New Grad - Quora (Remote)](https://jobs.ashbyhq.com/quora/40659fe7-545e-4b08-b6d7-2567b18b9ed3) | Remote - Multiple Locations; United States; Canada; United S | 2026-10-15 | 官方·Ashby、GitHub New Grad 列表 | valid |
| DoorDash USA | [Software Engineer, ML Infrastructure (MDX)](https://job-boards.greenhouse.io/doordashusa/jobs/8283735) | San Francisco, CA; Sunnyvale, CA; Seattle, WA | 2026-10-15 | 官方·Greenhouse | valid |
| Asana | [Software Engineer - AI Teammates Platform](https://job-boards.greenhouse.io/asana/jobs/8194522) | San Francisco | 2026-10-14 | 官方·Greenhouse | valid |
| DoorDash USA | [Software Engineer, Data Platform](https://job-boards.greenhouse.io/doordashusa/jobs/8191886) | San Francisco, CA; Sunnyvale, CA; Seattle, WA; New York City | 2026-10-13 | 官方·Greenhouse | valid |
| Stripe | [Machine Learning Engineer, Radar](https://job-boards.greenhouse.io/stripe/jobs/8243617) | Seattle | 2026-10-07 | 官方·Greenhouse | valid |
| Anduril Industries | [Supplier Quality Data Analytics Engineer](https://job-boards.greenhouse.io/andurilindustries/jobs/5244483007) | Costa Mesa, California, United States | 2026-10-06 | 官方·Greenhouse | valid |
| Sierra | [Software Engineer, Inference](https://jobs.ashbyhq.com/sierra/b8666a78-fcb1-47bb-ad07-5edb6cd3ad71) | San Francisco, CA; United States | 2026-10-05 | 官方·Ashby | valid |
| Elastic | [Analytics Engineer, HR Analytics](https://job-boards.greenhouse.io/elastic/jobs/8244449) | United States | 2026-10-05 | 官方·Greenhouse | valid |
| Lyft | [Data Scientist, Algorithms - Dynamic Pricing](https://job-boards.greenhouse.io/lyft/jobs/8856443002) | San Francisco, CA | 2026-10-01 | 官方·Greenhouse、GitHub New Grad 列表 | valid |
| Pinterest | [Master's University Grad Machine Learning Engineer 2027 (USA)](https://job-boards.greenhouse.io/pinterest/jobs/8140219) | San Francisco, CA, US; Palo Alto, CA, US; Seattle, WA, US; N | 2026-10-01 | 官方·Greenhouse、GitHub New Grad 列表 | valid |
| Pinterest | [Master's University Grad Data Scientist (USA)](https://job-boards.greenhouse.io/pinterest/jobs/8140389) | San Francisco, CA, US; Palo Alto, CA, US; Seattle, WA, US; N | 2026-10-01 | 官方·Greenhouse、GitHub New Grad 列表 | valid |
| Snowflake | [Software Engineer - SnowConvert AI](https://jobs.ashbyhq.com/snowflake/2a928b93-a5d4-4285-a92c-032fb389faa2) | US-CA-Menlo Park; Sydney, Australia; United States | 2026-09-29 | 官方·Ashby | valid |
| Quora | [Software Engineer New Grad, Machine Learning Platform - Quora (Remote)](https://jobs.ashbyhq.com/quora/cf34f80e-fe5c-454d-bc9a-4c59993ffda0) | Remote - Multiple Locations; United States; Canada; United S | 2026-09-25 | 官方·Ashby、GitHub New Grad 列表 | valid |
| Roblox | [Software Engineer, GenAI Platform](https://job-boards.greenhouse.io/roblox/jobs/8171283) | San Mateo, CA, United States | 2026-09-25 | 官方·Greenhouse、GitHub New Grad 列表 | valid |
| Block | [Data Scientist, Payments](https://job-boards.greenhouse.io/block/jobs/5214784008) | Bay Area, CA, United States of America | 2026-09-24 | 官方·Greenhouse、GitHub New Grad 列表 | valid |
| Perplexity | [Member of Technical Staff, AI Products (Early Career - Industry)](https://jobs.ashbyhq.com/perplexity/daa9120e-94ff-46e0-b4bd-4d2d290cb409) | San Francisco; United States | 2026-09-23 | 官方·Ashby | valid |
| Applied Intuition | [Robot Learning Engineer - Manipulation](https://jobs.ashbyhq.com/applied/ef7fb9ed-e254-4b90-aef2-efa9c30e7cd8) | Sunnyvale; United States | 2026-09-21 | 官方·Ashby | valid |
| Waymo | [Research Scientist, Map Scalability](https://job-boards.greenhouse.io/waymo/jobs/8180692) | Mountain View, CA, U.S.A ; San Francisco, CA, U.S.A ; New Yo | 2026-09-08 | 官方·Greenhouse、GitHub New Grad 列表 | valid |
| Snowflake | [AI Research Scientist, New Grad – Agents & Reinforcement Learning](https://jobs.ashbyhq.com/snowflake/1bad12df-f443-426f-9d09-e96fc780d698) | US-WA-Bellevue; United States | 2026-09-03 | 官方·Ashby、GitHub New Grad 列表 | valid |
| Lyft | [Data Scientist](https://job-boards.greenhouse.io/lyft/jobs/8772592002) | Seattle, WA | 2026-09-02 | 官方·Greenhouse | valid |
| Pinterest | [Machine Learning Engineer II, Responsible AI](https://job-boards.greenhouse.io/pinterest/jobs/8162046) | San Francisco, CA, US; Remote, US | 2026-08-27 | 官方·Greenhouse | valid |
| Scale AI | [Machine Learning Research Scientist, Evaluations](https://job-boards.greenhouse.io/scaleai/jobs/4728014005) | San Francisco, CA; Seattle, WA; New York, NY | 2026-08-26 | 官方·Greenhouse、GitHub New Grad 列表 | valid |
| Notion | [Data Scientist, Growth](https://jobs.ashbyhq.com/notion/9fc52821-c394-4a80-85ba-5f1d7c36fb2b) | San Francisco, California; United States | 2026-08-25 | 官方·Ashby | valid |
| Applied Intuition | [Research Scientist - Humanoid Robotics](https://jobs.ashbyhq.com/applied/4cd7cf1d-717c-4887-93b4-520a40a906b1) | Sunnyvale; United States | 2026-08-22 | 官方·Ashby、GitHub New Grad 列表 | valid |
| Lyft | [Machine Learning Engineer](https://job-boards.greenhouse.io/lyft/jobs/8689127002) | New York, NY | 2026-08-18 | 官方·Greenhouse | valid |
| Lyft | [Machine Learning Engineer, Fulfillment](https://job-boards.greenhouse.io/lyft/jobs/8688633002) | San Francisco, CA | 2026-08-18 | 官方·Greenhouse | valid |
| Roblox | [Software Engineer, Foundation AI](https://job-boards.greenhouse.io/roblox/jobs/8123004) | San Mateo, CA, United States | 2026-08-17 | 官方·Greenhouse、GitHub New Grad 列表 | valid |
| Applied Intuition | [Research Engineer - New Grad (2027)](https://jobs.ashbyhq.com/applied/45fc41cd-8280-4010-ba1f-def6114b3e39) | Sunnyvale; United States | 2026-08-14 | 官方·Ashby、GitHub New Grad 列表 | valid |
| Nuro | [Software Engineer, ML Inference Platform](https://job-boards.greenhouse.io/nuro/jobs/8122537) | Mountain View, California (HQ) | 2026-08-11 | 官方·Greenhouse、GitHub New Grad 列表 | valid |
| Nuro | [Software Engineer, ML Infrastructure Platform](https://job-boards.greenhouse.io/nuro/jobs/8122483) | Mountain View, California (HQ) | 2026-08-11 | 官方·Greenhouse、GitHub New Grad 列表 | valid |
| Affirm | [Machine Learning Engineer II (Underwriting ML)](https://job-boards.greenhouse.io/affirm/jobs/7822387003) | Remote US | 2026-08-06 | 官方·Greenhouse | valid |
| Glean | [Machine Learning Engineer, Assistant Quality](https://job-boards.greenhouse.io/gleanwork/jobs/4711484005) | San Francisco, CA | 2026-08-03 | 官方·Greenhouse、GitHub New Grad 列表 | valid |
| Applied Intuition | [Machine Learning Engineer - Behavior and Planning](https://jobs.ashbyhq.com/applied/129325ce-77e6-4d2a-a24a-6726acb53749) | Sunnyvale; United States | 2026-07-29 | 官方·Ashby | valid |
| Ramp | [Software Engineer, Forward Deployed AI Solutions](https://jobs.ashbyhq.com/ramp/b614563f-3ce6-4dca-b5ba-0e5a6c8bda27) | New York, NY (HQ); USA | 2026-07-28 | 官方·Ashby | valid |
| NewsBreak | [Applied AI Engineer, Advertising Agents (New Grad)](https://job-boards.greenhouse.io/newsbreak/jobs/4700278006) | Mountain View, California, United States | 2026-07-27 | 官方·Greenhouse、GitHub New Grad 列表 | valid |
| Applied Intuition | [Research Scientist - 3D Vision and Generation, Self-Driving](https://jobs.ashbyhq.com/applied/5f15c171-ae5a-496b-a8eb-c6a351d55b6b) | Sunnyvale; United States | 2026-07-24 | 官方·Ashby、GitHub New Grad 列表 | valid |
| NewsBreak | [Machine Learning Engineer, Local Search & Marketplace](https://job-boards.greenhouse.io/newsbreak/jobs/4699218006) | Mountain View, California, United States | 2026-07-22 | 官方·Greenhouse | valid |
| Together AI | [[Junior / Senior / Staff] Software Engineer, Inference / Compute Infrastructure Engineering](https://job-boards.greenhouse.io/togetherai/jobs/5186628007) | San Francisco | 2026-07-16 | 官方·Greenhouse | valid |
| NewsBreak | [NewsBreak Venture, AI Growth Intelligence Engineer (New Grad）](https://job-boards.greenhouse.io/newsbreak/jobs/4694899006) | Mountain View, California, United States | 2026-07-06 | 官方·Greenhouse、GitHub New Grad 列表 | valid |
| Notion | [Software Engineer, Early Career (AI)](https://jobs.ashbyhq.com/notion/85947779-6b87-466a-98bc-30a640448c28) | San Francisco, California; United States | 2026-07-06 | 官方·Ashby、GitHub New Grad 列表 | valid |
| Together AI | [Research Engineer, Post-Training Inference](https://job-boards.greenhouse.io/togetherai/jobs/5179372007) | San Francisco | 2026-07-06 | 官方·Greenhouse | valid |
| NewsBreak | [AI Engineer, Agentic Ad Creative (Multimodal)](https://job-boards.greenhouse.io/newsbreak/jobs/4691989006) | Mountain View, California, United States | 2026-06-24 | 官方·Greenhouse | valid |
| Ramp | [Applied AI Engineer, Fullstack](https://jobs.ashbyhq.com/ramp/6a7e382f-240a-4952-b9e5-7fe2b3856bc9) | New York, NY (HQ); San Francisco, CA; USA | 2026-06-24 | 官方·Ashby | valid |
| NewsBreak | [Applied AI Engineer, Advertising Agents](https://job-boards.greenhouse.io/newsbreak/jobs/4690262006) | Mountain View, California, United States | 2026-06-17 | 官方·Greenhouse、GitHub New Grad 列表 | valid |
| Nuro | [Software Engineer, ML Infrastructure, Optimization](https://job-boards.greenhouse.io/nuro/jobs/6916236) | Mountain View, California (HQ) | 2026-06-16 | 官方·Greenhouse | valid |
| Anduril Industries | [Software Engineer, Perception](https://job-boards.greenhouse.io/andurilindustries/jobs/5165250007) | Costa Mesa, California, United States | 2026-06-15 | 官方·Greenhouse | valid |
| Toast | [Data Scientist II](https://job-boards.greenhouse.io/toast/jobs/7984730) | Remote, USA | 2026-06-12 | 官方·Greenhouse | valid |
| NewsBreak | [Machine Learning Engineer, LLM Post-Training](https://job-boards.greenhouse.io/newsbreak/jobs/4688409006) | Mountain View, California, United States | 2026-06-10 | 官方·Greenhouse | valid |
| NewsBreak | [AI Engineer, Agent Platform](https://job-boards.greenhouse.io/newsbreak/jobs/4683873006) | Mountain View, California, United States | 2026-05-27 | 官方·Greenhouse | valid |
| Snowflake | [Software Engineer (AI-Native), Database Engineering](https://jobs.ashbyhq.com/snowflake/073c91f2-0758-4544-9297-3f48a81fb04d) | US-CA-Menlo Park; United States | 2026-05-27 | 官方·Ashby | valid |
| Scale AI | [Research Scientist, Safety Post Training](https://job-boards.greenhouse.io/scaleai/jobs/4696595005) | San Francisco, CA; New York, NY | 2026-05-18 | 官方·Greenhouse | valid |
| Cohere | [Software Engineer, Data Infrastructure](https://jobs.ashbyhq.com/cohere/6aa3cb2b-ee8b-4c92-b505-3a7509f80d7f) | New York; San Francisco; Canada; United States; Toronto; Mon | 2026-05-14 | 官方·Ashby | valid |
| Databricks | [AI Engineer – Forward Deployed Engineering (AI FDE)](https://job-boards.greenhouse.io/databricks/jobs/8546367002) | United States | 2026-05-13 | 官方·Greenhouse | valid |
| Scale AI | [Research Scientist, Frontier Risk Evaluations](https://job-boards.greenhouse.io/scaleai/jobs/4677657005) | San Francisco, CA; New York, NY | 2026-03-25 | 官方·Greenhouse | valid |
| Applied Intuition | [Software Engineer - AI Engineering](https://jobs.ashbyhq.com/applied/981054d6-d6d9-4553-9db8-38e56939d3b8) | Sunnyvale; United States | 2026-03-25 | 官方·Ashby | valid |
| Scale AI | [Research Scientist, AI Controls and Monitoring](https://job-boards.greenhouse.io/scaleai/jobs/4675694005) | San Francisco, CA; New York, NY | 2026-03-20 | 官方·Greenhouse | valid |
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
| Applied Intuition | [Research Scientist - World-Action Foundation Model, Robotics](https://jobs.ashbyhq.com/applied/a6c99f37-545a-46f2-8222-02ad43c1e2c3) | Sunnyvale; United States | 2025-08-19 | 官方·Ashby | valid |
| Applied Intuition | [Research Scientist (Research)](https://jobs.ashbyhq.com/applied/39846b2a-1f0e-4f97-b463-75fd37f217ce) | Sunnyvale; United States | 2025-08-19 | 官方·Ashby | valid |
| Waymo | [Machine Learning Engineer, Prediction & Planning](https://job-boards.greenhouse.io/waymo/jobs/6506689) | Mountain View, CA, USA; San Francisco, CA, USA | 2025-04-28 | 官方·Greenhouse | valid |
| Scale AI | [ML Research Engineer, ML Systems](https://job-boards.greenhouse.io/scaleai/jobs/4534631005) | San Francisco, CA; Seattle, WA; New York, NY | 2025-03-10 | 官方·Greenhouse | valid |
| Scale AI | [Machine Learning Research Scientist, Post-Training](https://job-boards.greenhouse.io/scaleai/jobs/4528009005) | San Francisco, CA; Seattle, WA; New York, NY | 2025-02-11 | 官方·Greenhouse | valid |
| Scale AI | [Software Engineer, Enterprise AI](https://job-boards.greenhouse.io/scaleai/jobs/4513943005) | New York, NY; San Francisco, CA | 2025-01-07 | 官方·Greenhouse | valid |
| Glean | [Software Engineer, AI/ML Infrastructure](https://job-boards.greenhouse.io/gleanwork/jobs/4501783005) | Mountain View, CA | 2024-11-26 | 官方·Greenhouse | valid |
| Applied Intuition | [Research Scientist - Reinforcement Learning, Robotics](https://jobs.ashbyhq.com/applied/52a070cf-4e1b-4fcc-bf73-727da8fb6d46) | Sunnyvale; United States | 2024-09-17 | 官方·Ashby | valid |
| Applied Intuition | [Research Engineer - AI/RL Infrastructure](https://jobs.ashbyhq.com/applied/091ed808-95c9-420b-8061-0ff2eb9342bc) | Sunnyvale; United States | 2024-09-17 | 官方·Ashby | valid |

## 小公司 Outreach 队列

230 家公司（官方 Board 在招 ≤30 个岗位作为规模代理，或在 HN Who is hiring 发帖）。其中 26 家在公开招聘帖里写了联系邮箱；没有一个联系人是猜的或从别处查的。负责人姓名未核实一律留空。每家附一份草稿，经历部分留空待你填写，**没有发送任何邮件或私信**。详见 `outreach.json` / `outreach.csv`。

## 每日清单（`jh pending`）

- outreach_draft：31
- question：707
- drafted_answer：107
- submit_by_hand：28
- audit_disagreement：11
- approve_match：84
- source_failure：5

批准或驳回用 `jh label <清单 id> fit|not_fit`，你的每个决定都存进评测集（`data/labels/triage.jsonl`），以后改规则先在上面跑分。

## 局限

- 规则只看文本。审计给出的是抽样估计，样本量见上表的区间；没有你的标签前，无法算出真实的误筛/漏筛。
- Workday 是关键词搜索，不是全量；LinkedIn/Indeed/Glassdoor/Handshake 只能通过提醒邮件看到，覆盖取决于你订阅的提醒。
- Handshake 提醒邮件正文没有岗位链接，只能作为线索列出，不与其他来源合并（不按公司+职位名合并）。
- 公司规模是名单分组或在招岗位数代理，不是审计过的员工数。
- 匹配不等于你个人符合全部条件（毕业时间、具体技能等），申请前还要看原文。
