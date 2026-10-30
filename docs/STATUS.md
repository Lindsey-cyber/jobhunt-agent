# 求职投递进度

更新于 2026-10-30。数据来自 `data/ledger.jsonl`（每个申请取最新状态）。

## 总览

| 状态 | 数量 |
|---|---|
| 已确认投出（confirmed） | 66 |
| 已提交、未确认（unconfirmed，绝不重试） | 15 |
| 卡住（held）：Greenhouse，等下一轮重试 | 50 |
| 卡住（held）：其他（Workday / Ashby，交给你） | 132 |

已批准岗位 840 条：greenhouse 202、url 189、linkedin 134、ashby 126、workday 92、glassdoor 54、lever 21、smartrecruiters 13、lead 9。

## 接下来（有额度时）

1. 先投排队的 20 条：第三方来源的岗位，已在 Greenhouse 或 Lever 上找到同一个岗位，你已批准。清单在 `docs/HANDOFF-2026-10-30.md`。
2. 再跑 Greenhouse 批量投递（`JH_WORKDAY=off`）。上一轮卡住的 Stripe、Scale AI、Figma、Gusto、Oscar Health、Axon、Databricks、Coherent、Snorkel、CHAOS、Samsara 等，规则都已经修好。
3. 小公司外联：等你给一封 sample 邮件。
4. 等你决定：被某家公司拒后，要不要暂停投它的其他岗位；Workable / SmartRecruiters 要不要投。

## 文件索引

| 文件 | 内容 |
|---|---|
| `docs/apply-by-hand.md` | 你要亲自投的申请：Workday 账号问题、只有你能回答的问题 |
| `docs/manual-submit.md` | Ashby / Lever（有验证码），答案已备好 |
| `docs/workable-smartrecruiters.md` | 27 条，等你挑 |
| `docs/third-party-postings.md` | 第三方来源的岗位，按招聘系统分类 |
| `docs/pending-approval.md` | 10/30 的待批准清单（已全部批准，字节除外） |
| `docs/HANDOFF-2026-10-30.md` | 给下一个 agent 的交接：你的决定、怎么跑、怎么修 |
| `data/answers.yaml`、`data/answers.jsonl` | 答案库（推测的答案都标了 Inferred） |
| `data/ledger.jsonl` | 每份申请的状态记录 |

## 已确认投出（66）

1. 2026-10-28 · Scale AI · Machine Learning Research Scientist, Evaluations
2. 2026-10-28 · Nuro · Software Engineer, ML Infrastructure Platform
3. 2026-10-28 · Nuro · Software Engineer, AI Platform - New Grad
4. 2026-10-28 · Together AI · [Junior / Senior / Staff] Software Engineer, Inference / Compute Infrastructure Engineering
5. 2026-10-28 · Scopely · Software Engineer, Machine Learning
6. 2026-10-28 · Nuro · Software Engineer, ML Infrastructure, Optimization
7. 2026-10-28 · Waymo · Research Scientist, Map Scalability
8. 2026-10-28 · Nuro · Software Engineer, ML Inference Platform
9. 2026-10-28 · NewsBreak · Applied AI Engineer, Advertising Agents (New Grad)
10. 2026-10-28 · NewsBreak · Applied AI Engineer, Advertising Agents
11. 2026-10-28 · Together AI · (Senior/Junior AI Inference Reliability Engineer, Compute Infra
12. 2026-10-28 · Glean · Machine Learning Engineer, Assistant Quality
13. 2026-10-28 · Together AI · Research Engineer, Post-Training Inference
14. 2026-10-28 · Anduril Industries · Software Engineer, Perception
15. 2026-10-28 · NewsBreak · Software Engineer, ML Infra (Junior & New Grad)
16. 2026-10-28 · Waymo · Machine Learning Engineer, Prediction & Planning
17. 2026-10-28 · NewsBreak · NewsBreak Venture, AI Growth Intelligence Engineer (New Grad）
18. 2026-10-28 · Stripe · Machine Learning Engineer, Radar
19. 2026-10-28 · Waymo · Software Engineer, Perception Scaling Evaluation
20. 2026-10-29 · Analog Devices · Associate Machine Learning Engineer
21. 2026-10-29 · GlobalFoundries · AI Software Engineer (2027 New College Graduate)
22. 2026-10-29 · GlobalFoundries · AI/ML Systems Engineer (2027 New College Graduate)
23. 2026-10-29 · Tubi · Data Scientist
24. 2026-10-29 · DoorDash USA · Software Engineer, ML Infrastructure (MDX)
25. 2026-10-29 · Databricks · AI Engineer – Forward Deployed Engineering (AI FDE)
26. 2026-10-29 · Asana · Software Engineer - AI Teammates Platform
27. 2026-10-29 · DoorDash USA · Software Engineer, Data Platform
28. 2026-10-29 · Affirm · Machine Learning Engineer II (Underwriting ML)
29. 2026-10-29 · OneImaging · Associate Data Engineer (UMiami Only)
30. 2026-10-29 · AppLovin · ML Data Infrastructure Engineer
31. 2026-10-29 · CHAOS Industries · Applied AI Engineer
32. 2026-10-29 · Bertram Capital Management · Forward Deployed AI Engineer
33. 2026-10-29 · Lila Sciences · Senior / Engineer II, AI Lab Research Engineer
34. 2026-10-29 · Black Canyon Consulting · Junior Data Scientist
35. 2026-10-29 · MAP · Associate Data Engineer
36. 2026-10-29 · Cleveland Guardians - Baseball Operations · Data Scientist
37. 2026-10-29 · Evolver · Research Scientist - Information Theory and Statistical Inference
38. 2026-10-29 · AppLovin · Data Scientist – Analytics
39. 2026-10-29 · Scale AI · Machine Learning Research Scientist, Post-Training
40. 2026-10-29 · Schonfeld  · AI Engineer (Junior/Senior)
41. 2026-10-29 · Lila Sciences · Machine Learning Scientist I / II, Protein Design
42. 2026-10-29 · Evolver · Research Scientist - Autonomous Systems
43. 2026-10-29 · AppLovin · ML Infrastructure Engineer
44. 2026-10-29 · Scale AI · ML Research Engineer, ML Systems
45. 2026-10-29 · Lila Sciences · ML Scientist I/II, AI for Protein Engineering
46. 2026-10-29 · DoorDash USA · Data Scientist / Senior Data Scientist
47. 2026-10-29 · Amira Learning · Machine Learning Engineer / AI Systems Engineer
48. 2026-10-29 · Bot Auto · Algorithm Engineer, Deep Learning & Vision (New Grad)
49. 2026-10-29 · Evolver · GenAI Engineer (Python)
50. 2026-10-29 · Lila Sciences · Research Engineer, Scientific Data & Workflow Infrastructure
51. 2026-10-29 · Relativity Space · AI Software Engineer I
52. 2026-10-29 · Glean · Software Engineer, AI/ML Infrastructure
53. 2026-10-29 · careers · 
54. 2026-10-29 · Accenture Federal Services · SAP AI Developer
55. 2026-10-30 · Verkada · Software Engineer - Data Platform
56. 2026-10-30 · Together AI · Systems Research Engineer, GPU Programming
57. 2026-10-30 · NewsBreak · AI Engineer, Agent Platform
58. 2026-10-30 · AppLovin · Measurement Data Scientist
59. 2026-10-30 · Accenture Federal Services · Data Engineer
60. 2026-10-30 · Black Canyon Consulting · Data Engineer
61. 2026-10-30 · Bot Auto · Algorithm Engineer, Reinforcement Learning
62. 2026-10-30 · Nuro · Machine Learning Research Scientist, Behavior Planning and Prediction
63. 2026-10-30 · Waymo · Machine Learning Engineer / Applied Scientist, Prediction & Planning
64. 2026-10-30 · Schonfeld  · AI Data Scientist
65. 2026-10-30 · DRW  · Quantitative Researcher
66. 2026-10-30 · Airbnb · Machine Learning Engineer, Assistance Engineering

## 已提交、未确认（15）

Billtrust 和 AFS 已收到确认邮件；Pinterest 和 Ashby 的请你自己查一下。

- Pinterest · Master's University Grad Machine Learning Engineer 2027 (USA)
- Pinterest · Machine Learning Engineer, Core Engineering
- Pinterest · Machine Learning Engineer, EPD Ads
- Pinterest · Master's University Grad Data Scientist (USA)
- Applied Intuition · Robot Learning Engineer - Manipulation
- Synhawk · Member of Technical Staff: Junior AI Researcher
- Tabs · Research Engineer, AI/ML
- Klaviyo Campus · AI Engineer I
- Deepgram · People AI & Automation Engineer
- Pinterest · Machine Learning Engineer II, Responsible AI
- Pinterest · Machine Learning Engineer II, Visual AI
- Pinterest · Machine Learning Engineer II, Core Engineering
- Brain Co. · AI Platform Engineer, 2027 New Grad
- Accenture Federal Services · Jr. Data Scientist
- careers · 
