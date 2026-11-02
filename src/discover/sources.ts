// The one registry of every channel the candidate asked discovery to cover.
// Each row is exactly one channel from her list and carries an honest status:
//   live       fetched by code on every run
//   no_api     no approved or public jobs API exists; skipped and named, never
//              scraped behind a login
//   deferred   a route exists but is not worth building now; `reason` says why in
//              numbers (yield, size, cost). A deferred row without a reason is a bug.
//   not_built  a usable route exists (or has not been ruled out) but no code yet
// A channel that is not in this list is not being searched. Pure: data only.

export type SourceStatus = "live" | "no_api" | "deferred" | "not_built";

export interface SourceRow {
  id: string;
  name: string;
  status: SourceStatus;
  note: string;
  // Required when status is "deferred".
  reason?: string;
}

export const SOURCE_REGISTRY: readonly SourceRow[] = [
  { id: "official_greenhouse", name: "官方 Greenhouse", status: "live", note: "boards-api.greenhouse.io，监控名单内全部 board，带 first_published" },
  { id: "official_lever", name: "官方 Lever", status: "live", note: "api.lever.co postings，监控名单内全部 board，带 createdAt" },
  { id: "official_ashby", name: "官方 Ashby", status: "live", note: "Ashby posting-api，监控名单内全部 board，带 publishedAt" },
  { id: "official_workday", name: "官方 Workday", status: "live", note: "CXS 接口按关键词有界搜索，不是全量；发布时间是相对天数（Posted N Days Ago），30+ 只是下界" },
  {
    id: "official_smartrecruiters",
    name: "官方 SmartRecruiters",
    status: "live",
    note: "api.smartrecruiters.com/v1 公开 Posting API（无需密钥），按关键词有界搜索、仅美国；带 releasedDate。首次实测 13 家 137 条 AI/ML 标题，7 条符合",
  },
  {
    id: "official_oracle_hcm",
    name: "官方 Oracle HCM（Candidate Experience）",
    status: "live",
    note: "招聘站自己调用的 hcmRestApi（无需登录），按关键词有界搜索、仅美国；带发布日期。首次实测 16 家 255 条 AI/ML 标题，31 条符合（26 条库里没有）",
  },
  {
    id: "official_icims",
    name: "官方 iCIMS",
    status: "deferred",
    reason: "iCIMS 没有 JSON 接口，只有每家各异的 HTML 搜索页；库里已有 iCIMS 雇主 50 家、岗位 96 条（其中符合 16 条，都是经提醒邮件进库的），多为需许可的国防承包商和中小企业；要抓得逐家写 HTML 解析，成本高，对中大型公司的新增预计很少",
    note: "只在 URL 身份里识别；邮件/列表里的 iCIMS 链接仍进库",
  },
  {
    id: "official_workable",
    name: "官方 Workable",
    status: "deferred",
    reason: "公开 widget 接口单次请求即被 Cloudflare 限流（HTTP 429, 1015）；库里已有 Workable 雇主 83 家、岗位 168 条（符合 25 条，已在库），以小型初创和人力外包为主（Raydar 一家 30 条），属第二阶段外联线索；接口不稳，对中大型公司增量很少",
    note: "只在 URL 身份里识别；邮件/列表里的 Workable 链接仍进库",
  },
  {
    id: "official_amazon",
    name: "官方 Amazon 招聘站",
    status: "live",
    note: "amazon.jobs/en/search.json（招聘站自己的公开搜索，无需登录），关键词有界搜索、仅美国，最新优先；带发布日期。Amazon 没有 ATS board，此前只经列表/邮件覆盖。首次实测 1234 条美国结果、422 条 AI/ML 标题，116 条符合",
  },
  {
    id: "official_career_pages",
    name: "公司自有招聘页（其余无 ATS 接口者）",
    status: "deferred",
    reason: "除 Amazon 外逐个探测：Meta 429、Google careers 接口 404、Microsoft 跳转登录页且接口证书不符、TikTok 400，没有可用的公开 JSON；覆盖率样本 50 个漏项中 0 个属于这类；每家都要一份 HTML 抓取，违背“只用公开接口”，逐家出现真实漏项再加",
    note: "有 ATS 的公司已由上面各行覆盖；Amazon 单独成行",
  },
  { id: "github_newgrad", name: "GitHub New Grad 列表", status: "live", note: "SimplifyJobs 等公开仓库的 JSON/Markdown 列表" },
  { id: "gmail_alerts", name: "Gmail 提醒（LinkedIn、Indeed、Glassdoor、Handshake）", status: "live", note: "Gmail API 只读；LinkedIn/Glassdoor 只有标题、公司、地点，按同公司+同标题+地点唯一匹配对应官方页，匹配不到标为需官方页；Handshake 无岗位链接，只作线索" },
  { id: "direct_job_boards", name: "LinkedIn / Indeed / Glassdoor / Handshake 直连", status: "no_api", note: "没有授权的公开职位接口（Handshake 需账号集成）；不抓取页面，只经 Gmail 提醒覆盖" },
  {
    id: "yc",
    name: "YC（Work at a Startup）",
    status: "deferred",
    reason: "Work at a Startup 对非浏览器请求直接 406（账号登录后才有岗位），不抓取；YC 公开目录镜像 1504 家在招公司里 1243 家（83%）不超过 50 人，中大型的 261 家绝大多数（Stripe、DoorDash、Instacart 等）已在监控名单；增量是小型初创，属第二阶段外联",
    note: "目录里的公司仍可经其官方 ATS 进监控名单",
  },
  { id: "wellfound", name: "Wellfound", status: "no_api", note: "没有公开职位接口，页面在登录/反爬之后；不抓取" },
  {
    id: "vc_portfolio",
    name: "VC 投资组合招聘页",
    status: "no_api",
    note: "已逐个探测：Getro 板（Khosla、Insight、8VC 等）的搜索接口对非浏览器请求返回 406，页面服务端只带前 20 条；Consider 板（Sequoia、LSVP、BVP、USV 等）接口需页面 CSRF 令牌（412 INVALID_CSRF）；a16z 是自建站。均无公开/授权接口，不绕过；且投资组合以小型初创为主，属第二阶段外联",
  },
  { id: "hn_hiring", name: "Hacker News Who is hiring", status: "live", note: "Firebase 公开接口，当月帖子的顶层评论" },
  {
    id: "ai_ml_boards",
    name: "AI/ML 专业招聘平台",
    status: "deferred",
    reason: "逐个探测：ai-jobs.net/aijobs.net 的 feed 已改址并返回 foorilla 站点页（0 个 item）、weworkremotely 的 RSS 301 无内容、Kaggle/Hugging Face 跳转登录；唯一公开接口 Remote OK 全站仅 99 条、其中约 13 条沾 AI、均为远程小公司，且条款要求署名回链；增量约 0 条中大型",
    note: "这类平台的中大型雇主已经在 Greenhouse/Lever/Ashby/Workday 名单里",
  },
  {
    id: "network",
    name: "同行 / 竞品 / 融资网络",
    status: "deferred",
    reason: "没有已配置的融资数据源（Crunchbase/PitchBook 为付费接口，无密钥）；反推出来的对象是刚融资的小型初创，岗位少且无 ATS 接口，价值在第二阶段的人脉外联而不是投递；对中大型公司覆盖增量 0",
    note: "同类公司已通过 H-1B 申请量与监控名单重建（W3）覆盖",
  },
  {
    id: "brave_tavily",
    name: "Brave / Tavily（只补漏）",
    status: "deferred",
    reason: "需要付费 API 密钥：本环境未配置 BRAVE_API_KEY / TAVILY_API_KEY（Brave 接口无令牌直接 422）；搜索结果是第三方转载页而非官方岗位，只能当线索，配置密钥后再接",
    note: "只用于补漏，不当主来源",
  },
];

export const registryCounts = (rows: readonly SourceRow[] = SOURCE_REGISTRY) => ({
  live: rows.filter((r) => r.status === "live").length,
  no_api: rows.filter((r) => r.status === "no_api").length,
  deferred: rows.filter((r) => r.status === "deferred").length,
  not_built: rows.filter((r) => r.status === "not_built").length,
});

const STATUS_ZH: Record<SourceStatus, string> = { live: "已接入", no_api: "无授权接口，跳过", deferred: "推迟（有理由）", not_built: "未做" };
export const statusZh = (s: SourceStatus) => STATUS_ZH[s];
