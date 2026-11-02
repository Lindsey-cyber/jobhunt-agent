// The one registry of every channel the candidate asked discovery to cover.
// Each row is exactly one channel from her list and carries an honest status:
//   live       fetched by code on every run
//   no_api     no approved or public jobs API exists; skipped and named, never
//              scraped behind a login
//   not_built  a usable route exists (or has not been ruled out) but no code yet
// A channel that is not in this list is not being searched. Pure: data only.

export type SourceStatus = "live" | "no_api" | "not_built";

export interface SourceRow {
  id: string;
  name: string;
  status: SourceStatus;
  note: string;
}

export const SOURCE_REGISTRY: readonly SourceRow[] = [
  { id: "official_greenhouse", name: "官方 Greenhouse", status: "live", note: "boards-api.greenhouse.io，监控名单内全部 board，带 first_published" },
  { id: "official_lever", name: "官方 Lever", status: "live", note: "api.lever.co postings，监控名单内全部 board，带 createdAt" },
  { id: "official_ashby", name: "官方 Ashby", status: "live", note: "Ashby posting-api，监控名单内全部 board，带 publishedAt" },
  { id: "official_workday", name: "官方 Workday", status: "live", note: "CXS 接口按关键词有界搜索，不是全量；发布时间是相对天数（Posted N Days Ago），30+ 只是下界" },
  { id: "official_other_ats", name: "其他 ATS（SmartRecruiters、iCIMS、Workable 等）", status: "not_built", note: "只在 URL 身份里识别，没有抓取代码" },
  { id: "official_career_pages", name: "公司自有招聘页（无 ATS 接口）", status: "not_built", note: "没有抓取代码；有 ATS 的公司已由上面各行覆盖" },
  { id: "github_newgrad", name: "GitHub New Grad 列表", status: "live", note: "SimplifyJobs 等公开仓库的 JSON/Markdown 列表" },
  { id: "gmail_alerts", name: "Gmail 提醒（LinkedIn、Indeed、Glassdoor、Handshake）", status: "live", note: "Gmail API 只读；LinkedIn/Glassdoor 只有标题、公司、地点，按同公司+同标题+地点唯一匹配对应官方页，匹配不到标为需官方页；Handshake 无岗位链接，只作线索" },
  { id: "direct_job_boards", name: "LinkedIn / Indeed / Glassdoor / Handshake 直连", status: "no_api", note: "没有授权的公开职位接口（Handshake 需账号集成）；不抓取页面，只经 Gmail 提醒覆盖" },
  { id: "yc", name: "YC（Work at a Startup）", status: "not_built", note: "未做；是否有可用的公开接口待 W6 核实" },
  { id: "wellfound", name: "Wellfound", status: "no_api", note: "没有公开职位接口，页面在登录/反爬之后；不抓取" },
  { id: "vc_portfolio", name: "VC 投资组合招聘页", status: "not_built", note: "未做；多数托管在 Getro/Consider 等，待 W6 核实接口" },
  { id: "hn_hiring", name: "Hacker News Who is hiring", status: "live", note: "Firebase 公开接口，当月帖子的顶层评论" },
  { id: "ai_ml_boards", name: "AI/ML 专业招聘平台", status: "not_built", note: "未做；待 W6 逐个核实接口" },
  { id: "network", name: "同行 / 竞品 / 融资网络", status: "not_built", note: "未做；从融资公告和同类公司反推招聘页" },
  { id: "brave_tavily", name: "Brave / Tavily（只补漏）", status: "not_built", note: "未做；有官方搜索接口，需要密钥；只用于补漏，不当主来源" },
];

export const registryCounts = (rows: readonly SourceRow[] = SOURCE_REGISTRY) => ({
  live: rows.filter((r) => r.status === "live").length,
  no_api: rows.filter((r) => r.status === "no_api").length,
  not_built: rows.filter((r) => r.status === "not_built").length,
});

const STATUS_ZH: Record<SourceStatus, string> = { live: "已接入", no_api: "无授权接口，跳过", not_built: "未做" };
export const statusZh = (s: SourceStatus) => STATUS_ZH[s];
