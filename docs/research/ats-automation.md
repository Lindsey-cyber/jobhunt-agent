# 还能自动投哪些 ATS：调研与方案（2026-11-02）

标注：**实测** = 我今天看到的数据或页面；**推断** = 由实测推出；**猜测** = 未验证。
注意：`data/runs/` 在本机不存在（ledger 里的 runDir 指向 /opt 和 /home/user 下已不在的目录），所以截图、gate.json 没法复看，下面不引用截图。

## 一、按能放行的岗位数排序（docs/TODAY.md 第三节 691 行，按链接域名数；实测）

| ATS | 链接数 | 其中 TODAY 标"你投" | 说明 |
|---|---|---|---|
| Workday（含 myworkdaysite） | 196 | 109 + 78 已开始 + 少量标 company site（如 Snap） | 已有适配器，已开启 |
| Ashby | 127 | 92 + 35 已开始 | 已有适配器，被 CAPTCHA_ATS 开关挡住 |
| Greenhouse | 79 | 已自动 | 含 84 条"已填、等你答题" |
| Oracle Cloud (HCM) | 32 | company site | 无适配器 |
| Lever | 23 | 16 + 7 已开始 | 有适配器（只填不提交） |
| iCIMS 9、SmartRecruiters 8、Workable 3、Breezy 2、ADP 2、Jobvite/Eightfold/BambooHR/SuccessFactors 各 1 | 共 27 | company site | 无适配器，量小 |
| LinkedIn 73、Tesla 31、Glassdoor 16、Qualcomm 15、Amazon 7 等 | 约 160 | company site | 聚合页/自家站，不是一个 ATS；LinkedIn/Glassdoor 要登录，按规则不碰 |

（"company site 256"里：Oracle 32、iCIMS/SR/Workable 等约 27，其余是聚合页和各家自建站，没有单一适配器能覆盖。推断）

## 二、各 ATS 详情

### Ashby（127）
| 项 | 内容 |
|---|---|
| 无人值守提交的阻碍 | 页面用 reCAPTCHA Enterprise（不可见、按分数）。实测：打开 harvey 岗位 `https://jobs.ashbyhq.com/harvey/6c87b165-99ad-484e-b34b-1cf2ab0c92d5/application`，加载了 `recaptcha.net/recaptcha/enterprise.js?render=6LezdY0t...`，源码有 `recaptcha-badge`、`RecaptchaAutomatedLegal`。没有 hCaptcha/Turnstile。 |
| 之前的说法对吗 | **部分不对。** "提交后表单还在、所以被挡"不成立：ledger 里 Ashby 共 7 次点提交，全部记成 `unconfirmed`，但其中 Applied Intuition（`ashby:jobs.ashbyhq.com/applied/ef7fb9ed-…`）在 2026-11-01 被邮件确认（"Your Application to Applied Intuition…" 来自 no-reply@ashbyhq.com，ledger 里 state=confirmed，实测）。所以至少 1/7 真提交成功，其余 6 条（synhawk、tabs、deepgram、brainco 10-29；generalist、harvey 11-02）没有被查邮件确认，**状态未知，不是失败**。src/cli.ts 注释"0 of 5 went through"是只看页面得出的，与邮件证据矛盾。 |
| 另一个更大的阻碍 | 数据而非验证码：Ashby 152 次 held 中 142 条是"no answer in profile or answer bank"。最多的是 "Name"（105，旧 bug，10-29 已改成 Full Name，推断已过时）、"Education History"（39，10-29 已加 composite 填写，推断已修）、"Are you open to being in-office 5 days a week in Sunnyvale?"（39，单个雇主的地点题）。 |
| 证据 | data/ledger.jsonl（上述 key）；`.claude/skills/verify-apply/features/ashby.md`；src/ats/ashby/adapter.ts:217（只把可见的 bframe 挑战当 blocker）；fixtures/ashby/real-quora-40659fe7.html |
| 猜测 | 分数低的主要原因多半是机房 IP 和无头浏览器（docs/DEPLOY.md:13 也提到机房 IP 更易被挑战）。从候选人自己的住宅 IP + 有头 Chrome 跑，通过率可能明显更高。 |

### Workday（196）
| 项 | 内容 |
|---|---|
| 状态 | 已开启（`WORKDAY_READY`，src/cli.ts:111）。实测：3 次提交 3 次 confirmed（ADI、GlobalFoundries x2，页面 "Application Submitted"）。"每家要账号"已被 `JH_ACCOUNT_SECRET` 派生账号解决（docs/HANDOFF.md:67，推断；我没有创建任何账号）。 |
| 为什么还在手动清单 | 实测：Workday held 144 次，首因：缺答案 55、readback 不一致 27（如 "Phone Device Type" 期望 Mobile 得到 Main）、敏感题无精确答案 25、选项匹配不上 18、涉及薪资/法律声明 5。即瓶颈是 answers.yaml 覆盖度和下拉适配器 bug，不是验证码。 |
| 证据 | data/ledger.jsonl；features/workday.md；fixtures/workday/real-adi-apply-manually.html |
| 风险 | 每个新雇主要新账号，还可能要邮箱验证码（猜测，apply.ts:237 提到 security code）。 |

### Lever（23）
| 项 | 内容 |
|---|---|
| 阻碍 | hCaptcha。实测：打开 `https://jobs.lever.co/zoox/254559af-8372-403b-8220-9b49af400361/apply`，加载 `js.hcaptcha.com/1/secure-api.js`，源码有 `hcaptchaSubmitBtn`、`hcaptchaTokenExpired`、`hcaptchaResponseInput`，即提交按钮绑定 hCaptcha。适配器设计上永不点提交（features/lever.md）。 |
| 从未实际提交 | ledger 里 Lever 51 次 held（原因全是"hCaptcha: submit it yourself"）、15 verified，0 submitted。所以"Lever 必挡"来自代码设计而不是被拒的证据（实测：没有提交记录）。是否 invisible 通过未知。 |
| 结论 | 量最小（23），hCaptcha 比 reCAPTCHA 更难绕，且不应绕。保持人工。 |

### 其他
| ATS | 数量 | 阻碍 | 标注 |
|---|---|---|---|
| Oracle HCM | 32 | 多需注册/登录，无适配器，要从真实页面抓 | 猜测 |
| iCIMS | 9 | 通常要账号，多步 | 猜测 |
| SmartRecruiters / Workable | 8 / 3 | docs/workable-smartrecruiters.md 称公开表单不要账号；Workable 常带 hCaptcha/Turnstile | 部分猜测 |
| Breezy/ADP/Jobvite 等 | 1-2 各 | 太小，不值得做适配器 | 推断 |

## 三、建议（按解锁数 / 成本排序）

1. **先把 Workday 卡点清掉（解锁上限约 187，最快见效）。** 不用写新适配器：(a) 对 54+ 条"缺答案"汇总出现频率最高的题，进每日 pending 让她一次答完，写入 answers.yaml（要她确认，规则：不猜）；(b) 修 27 条 readback 不一致（先修 Phone Device Type 下拉）和 18 条选项匹配。验证：按 verify-apply 先跑 fixtures/workday，再对一个已被 hold 的雇主 `jh apply`（草稿，不 approve），看 verify.json 无失败项；再 approve 一个看 `confirmed`。风险：账号锁定、同雇主多次投递（apply.ts:149 已有去重）。
2. **Ashby 先核实再决定（127，成本最低）。** 步骤：用现有邮件确认流程对 synhawk/tabs/deepgram/brainco/generalist/harvey 查 no-reply@ashbyhq.com 的确认信。若 ≥50% 确认：把 Ashby 提交成功判定改成"提交后等邮件确认"（不重试 unconfirmed 的规则不变），去掉 CAPTCHA_ATS 对 Ashby 的限制，保留 Lever 的限制。若 0 确认：试从她自己机器（住宅 IP、有头）跑一次，对比。风险：低分被静默拒绝会留下 unconfirmed 且不可重试，所以每次只批准少量，先看邮件再放量；严禁绕过验证码。
3. **Lever、Oracle、iCIMS 等：现在不做。** Lever 23 个有 hCaptcha 且无成功先例；其余无适配器、单个平台 < 33 个，按 add-ats-adapter 从真实页面抓取成本高。等 1、2 完成再从 Oracle（32）开始评估。

## 四、最强的三条证据
1. ledger：Applied Intuition Ashby 先 unconfirmed，后被 ashbyhq 邮件确认 -> Ashby 提交并非必被挡。
2. ledger：Workday 3/3 提交均 confirmed，144 次 hold 的首因是缺答案/readback，不是验证码。
3. Lever 页面源码含 `hcaptchaSubmitBtn`（hCaptcha 绑定提交），Ashby 用 reCAPTCHA Enterprise 不可见分数制。
