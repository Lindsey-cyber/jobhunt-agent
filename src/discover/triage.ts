// Rule triage: is this posting a New Grad / 0-2 year AI/ML role the candidate
// can take? Pure. Every verdict carries a rule id so audits and the eval set can
// count errors per rule. Ported and extended from the Python criteria.py.
import type { Sighting, Triage } from "../domain/job.ts";

export interface CandidateFacts {
  needsSponsorship: boolean;
  usCitizen: boolean;
  hasPhd: boolean;
}

export interface TriageInput {
  title: string;
  location: string;
  description: string;
  official: boolean;
  hints: Sighting["hints"];
}

export const ROLE =
  /deep learning|computer vision|machine learning|\bml\b|\bmlops\b|\bai\b|\bagi\b|artificial intelligence|\bllms?\b|gen(?:erative)? ?ai|research engineer|research scientist|applied scientist|\bdata engineer|\binference\b|recommend(?:ation|er)|\branking\b|\bnlp\b|natural language|perception|robot learning|reinforcement learning|data (?:platform|infra(?:structure)?|arch(?:itecture)?)|model (?:training|serving|evaluation)|foundation model|\bai\/ml\b|\bml\/ai\b/i;
// Titles that are AI/ML only when the work is: a "Research Scientist" in
// pharmacology or materials is not. These need ML words in the title or text.
const RESEARCH_ONLY = /research engineer|research scientist|applied scientist/i;
const ML_WORDS = /video generation|world models?|neural|multimodal|speech|robot learning|\bvision\b|perception|machine learning|deep learning|\bml\b|\bai\b|artificial intelligence|\bllms?\b|neural network|reinforcement learning|computer vision|\bnlp\b|natural language|generative|foundation model|transformer/i;
// In the description, a company blurb ("we use AI to transform drug discovery")
// is not evidence; technical ML work is.
const ML_WORK = /deep learning|neural net|\bllms?\b|large language model|reinforcement learning|computer vision|\bnlp\b|natural language processing|transformers?\b|pytorch|tensorflow|\bjax\b|(?:train|training|fine-tun\w*|evaluat\w*|deploy\w*)\s+(?:\w+\s+){0,3}models?|(?:ml|machine learning|generative|foundation|multimodal|vision|language) models?/i;
const DATA_SCIENCE = /data scien|\bquantitative researcher\b|\bstatistician\b/i;
const SENIOR = /\b(senior|sr\.?|staff|principal|lead|director|manager|head of|distinguished|architect|vp|vice president|chief|founding)\b|\b(engineer|scientist|developer)\s+(ii|iii|iv|2|3|4)\b|\b(l[5-9]|e[5-9]|ic[4-9])\b/i;
const INTERN = /\bintern(ship)?s?\b|\bco-?op\b|summer 20\d\d|\bapprentice/i;
const ENGINEERING = /\bengineer(ing)?\b|scientist|researcher|\bdeveloper\b|\bswe\b|\bmts\b|member of technical staff|programmer/i;
const NON_ENGINEERING = /\b(advocate|evangelist|sales|account|recruit|marketing|product manager|program manager|project manager|designer|writer|counsel|legal|support specialist|customer success|operations|analyst|consultant|teacher|instructor|tutor|trainer|annotator|labell?er)\b/i;
// A PhD stated as the requirement (not "preferred"), e.g. "Pursuing PhD in CS",
// "new college grad PhD researcher", "PhD in machine learning ... required".
const PHD_REQUIRED_BODY = /(?:pursuing|currently enrolled in|completed|hold|have|holds|earned|requires?|required:?|minimum:?)\s+(?:an?\s+|your\s+)?ph\.?\s?d\b|\bph\.?\s?d\.?\s+(?:is\s+)?required|\bph\.?\s?d\.?\s+(?:degree\s+)?in\s+[a-z ,/&]{3,60}(?:or equivalent industry experience|required|is required)|\bph\.?\s?d\.?\s+(?:student|researcher|candidate|graduate)s?\b(?![^.]{0,40}(?:or|and) (?:ms|m\.s|master))/i;
const MASTERS_BODY = /master'?s|\bm\.s\.|\bms\b(?! office| excel| word| teams)|\bmsc\b|\bms\/phd|graduate degree/i;
const EXPERIENCED_ONLY = /(?:intended|designed|meant) for experienced\b[^.]{0,40}|not (?:an? )?(?:entry[- ]level|new grad)[^.]{0,20}(?:role|position)/i;
const PHD_TITLE = /\bph\.?\s?d\b|doctoral|doctorate|post-?doc/i;
const MASTERS_OK = /\bm\.?s\.?\b|master'?s|\bms\/phd\b|ms or phd|bs\/ms/i;
const EARLY_TITLE =
  /new (?:college )?grad|\bgraduate\b|\bgrad\b|entry.?level|\bjunior\b|\bjr\.?\b|early.?career|university|campus|\bassociate\b|\b(?:engineer|scientist|developer)\s*(?:i|1)\b|\b(?:202[6-8])\b|\bresidency\b|\bresident\b|\bl3\b|\be3\b/i;
const EARLY_BODY =
  /new (?:college )?grad|recent (?:college |university )?grad|entry.?level|early.?career|university graduate|graduating (?:in|by)|\b0\s*(?:[-–]|to)\s*[1-3]\s*years?|\b[12]\+?\s*years?\s+(?:of\s+)?(?:relevant |professional |industry |work |hands-on )?experience|no (?:prior )?(?:professional )?experience (?:is )?required/i;
const EXPERIENCE =
  /\b([3-9]|1\d)\s*(?:\+|[-–]\s*\d+|\s*or more)?\s*(?:years?|yrs?)\s+(?:of\s+)?(?:[\w/+-]+\s+){0,3}?(?:experience|exp\b)/gi;
// A stated minimum of two years ("2+ years of experience ... required",
// "minimum of 2 years"), unless marked preferred.
const TWO_YEARS_REQUIRED = /(?:minimum of |at least |requires? |required:? )2\+?\s*(?:years?|yrs)|\b2\+\s*(?:years?|yrs)\s+(?:of\s+)?(?:\w+\s+){0,3}(?:experience|exp\b)(?![^.]{0,60}(?:prefer|nice to have|a plus|bonus))/i;
const NO_SPONSOR = new RegExp(
  [
    String.raw`(?:no|without)\s+(?:visa\s+|immigration\s+)?sponsorship`,
    String.raw`(?:cannot|can't|unable to|not able to|will not|won't|do not|does not|don't|doesn't|is not able to)\s+(?:currently\s+)?(?:provide|offer|support|consider)?\s*(?:visa\s+|immigration\s+|employment\s+)?sponsor`,
    String.raw`sponsorship\s+(?:(?:is|will be)\s+)?(?:not (?:available|provided|offered|supported|possible)|unavailable)`,
    String.raw`not (?:eligible|able) (?:for|to receive) (?:visa |immigration )?sponsorship`,
    String.raw`(?:must|require[sd]?).{0,80}unrestricted.{0,40}(?:authorization|right to work)`,
    String.raw`(?:authorized|eligible|authorization)\s+to\s+work.{0,90}without.{0,40}(?:the need for |requiring )?(?:visa\s+)?sponsorship`,
  ].join("|"),
  "gi",
);
const CITIZENSHIP = /(?:must|require[sd]?|only).{0,60}\b(?:u\.?s\.?|united states)\s+(?:citizen(?:ship)?|person)|us citizens? only|\b(?:active|current|ability to obtain)\b.{0,30}(?:security|ts\/sci|secret) clearance|clearance (?:is )?required/i;

const US_STATES =
  "AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY|DC";
const US = new RegExp(
  [
    String.raw`\bunited states\b|\bu\.s\.a?\b|\busa\b|\bus\b|\bamericas?\b|\(US\)`,
    String.raw`new york|\bnyc\b|san francisco|\bsf\b|bay area|seattle|boston|austin|chicago|los angeles|mountain view|palo alto|sunnyvale|san jose|santa clara|menlo park|redmond|bellevue|cambridge, ma|pittsburgh|atlanta|denver|washington|philadelphia|san diego|irvine|dallas|houston|miami|raleigh|salt lake|portland|detroit|minneapolis|phoenix|nashville|baltimore|ann arbor|madison|columbus|charlotte|richmond|mclean|arlington|reston|herndon|princeton|jersey city|hoboken|stamford|cupertino|san mateo|redwood city|foster city|emeryville|oakland|berkeley|south san francisco|brooklyn|manhattan|lancaster, ca`,
    String.raw`\b(?:alabama|alaska|arizona|arkansas|california|colorado|connecticut|delaware|florida|georgia|hawaii|idaho|illinois|indiana|iowa|kansas|kentucky|louisiana|maine|maryland|massachusetts|michigan|minnesota|mississippi|missouri|montana|nebraska|nevada|new hampshire|new jersey|new mexico|north carolina|north dakota|ohio|oklahoma|oregon|pennsylvania|rhode island|south carolina|south dakota|tennessee|texas|utah|vermont|virginia|washington state|west virginia|wisconsin|wyoming)\b`,
  ].join("|"),
  "i",
);
// State codes only after a comma or as Workday's US-XX prefix, and only in
// capitals: "IN-Pune" is India, not Indiana.
const US_STATE_CODE = new RegExp(String.raw`(?:,\s*|\bUS-)(?:${US_STATES})\b(?![a-z])`);
const NON_US =
  /canada|toronto|vancouver|montr[eé]al|ottawa|waterloo|london|united kingdom|\buk\b|england|scotland|ireland|dublin|germany|berlin|munich|hamburg|france|paris|netherlands|amsterdam|switzerland|z[uü]rich|india|bangalore|bengaluru|hyderabad|pune|chennai|gurgaon|gurugram|noida|mumbai|delhi|singapore|japan|tokyo|china|beijing|shanghai|shenzhen|hangzhou|hong kong|taiwan|taipei|korea|seoul|australia|sydney|melbourne|israel|tel aviv|poland|warsaw|krak[oó]w|spain|madrid|barcelona|brazil|s[aã]o paulo|mexico|argentina|buenos aires|romania|bucharest|serbia|belgrade|portugal|lisbon|sweden|stockholm|denmark|copenhagen|finland|helsinki|norway|oslo|italy|milan|czech|prague|hungary|budapest|ukraine|philippines|manila|vietnam|malaysia|kuala lumpur|indonesia|jakarta|uae|dubai|abu dhabi|saudi|riyadh|emea|apac|latam|europe|belgium|brussels|austria|vienna|greece|athens|costa rica|colombia|bogot[aá]|chile|santiago|new zealand|estonia|tallinn|lithuania|bulgaria|sofia|egypt|cairo|nigeria|lagos|kenya|nairobi|south africa|turkey|istanbul|pakistan|thailand|bangkok|luxembourg|cyprus|croatia|slovakia|latvia|uruguay|peru|lima|edinburgh|cambridge, uk|oxford|manchester|bristol|belfast|munich|stuttgart|lyon|zagreb|\((?!US\))[A-Z]{2}\)/i;

const v = (verdict: Triage["verdict"], rule: string, reason: string): Triage => ({ verdict, rule, reason });

export function sponsorshipRestriction(body: string): string | undefined {
  for (const m of body.matchAll(NO_SPONSOR)) {
    const before = body.slice(Math.max(0, m.index - 40), m.index);
    const after = body.slice(m.index + m[0].length, m.index + m[0].length + 40);
    if (/with or\s*$/i.test(before)) continue;
    if (/^\s+(?:restrictions|limitations|required|needed)/i.test(after)) continue;
    if (/\b(?:may|might|can) (?:be )?(?:available|provided|offered)/i.test(after)) continue;
    return body.slice(Math.max(0, m.index - 60), m.index + m[0].length + 40).replace(/\s+/g, " ").trim();
  }
  return undefined;
}

export function requiredExperience(body: string): { years: number; context: string } | undefined {
  for (const m of body.matchAll(EXPERIENCE)) {
    const context = body.slice(Math.max(0, m.index - 80), m.index + m[0].length + 80).replace(/\s+/g, " ");
    // "0-3 years" / "1 to 3 years": the range's floor is what is required.
    const floor = /(\d+)\s*(?:[-–]|to)\s*$/.exec(body.slice(Math.max(0, m.index - 8), m.index));
    if (floor && Number(floor[1]) <= 2) continue;
    if (/prefer|nice to have|bonus|plus\b|ideally/i.test(context)) continue;
    // "3+ years (Master's)" / "Master's with 3 years": the years apply to the candidate's degree.
    const after = body.slice(m.index + m[0].length, m.index + m[0].length + 40);
    const before = body.slice(Math.max(0, m.index - 40), m.index);
    const forMasters = /^[^.]{0,25}(?:\(|with an? |for )?(?:master'?s|m\.?s\.?\b)/i.test(after) || /(?:master'?s|m\.?s\.?)(?: degree)?(?: and| with| plus)\s*$/i.test(before);
    // "PhD or 3+ years" / "BS with 5 or MS with 3": another degree path may waive it.
    if (!forMasters && /\b(?:ph\.?d|master'?s|m\.?s\.?)\b.{0,30}\bor\b/i.test(context)) continue;
    return { years: Number(m[1]), context: context.trim() };
  }
  return undefined;
}

export function usLocation(location: string): "us" | "non_us" | "unknown" {
  const l = location.trim();
  if (!l) return "unknown";
  if (US.test(l) || US_STATE_CODE.test(l)) return "us";
  if (NON_US.test(l)) return "non_us";
  return "unknown";
}

export function triage(job: TriageInput, me: CandidateFacts): Triage {
  const { title, location, description: body, official, hints } = job;
  if (hints.closed) return v("reject", "source.closed", "Source marks the posting closed");
  if (hints.unresolved && !title.trim()) return v("review", "lead.unresolved", "Lead without a role title; find the official posting");

  const dataScience = DATA_SCIENCE.test(title) && !ROLE.test(title);
  if (!ROLE.test(title) && !dataScience) return v("reject", "role.out_of_scope", "Title is not an AI/ML, research or data-engineering role");
  if (INTERN.test(title)) return v("reject", "type.internship", "Internship or co-op, not a full-time role");
  // "[Junior / Senior / Staff] Engineer" hires at every level, including entry.
  const multiLevel = /\b(junior|new grad|entry[- ]level|early[- ]career)\b/i.test(title);
  if (SENIOR.test(title) && !multiLevel) return v("reject", "level.senior", "Senior, staff, lead or manager title");
  if (NON_ENGINEERING.test(title) && !/\bengineer(ing)?\b|scientist|researcher/i.test(title)) {
    return v("reject", "role.non_engineering", "AI-adjacent but not an engineering or research role");
  }
  if (!ENGINEERING.test(title) && !dataScience) return v("reject", "role.non_engineering", "Not an engineering, scientist or research title");
  if (PHD_TITLE.test(title) && !MASTERS_OK.test(title) && !me.hasPhd) {
    return v("reject", "degree.phd_required", "Title asks for a PhD; the candidate's highest degree is a master's");
  }

  const researchOnly = RESEARCH_ONLY.test(title) && !ROLE.test(title.replace(new RegExp(RESEARCH_ONLY, "gi"), ""));
  const listSaysMl = /^List category: .*(AI|ML)/m.test(body);
  if (researchOnly && !ML_WORDS.test(title) && !ML_WORK.test(body) && !listSaysMl) {
    // Only a full official description can show the work is not ML.
    return official && body.length > 600
      ? v("reject", "role.research_not_ml", "Research title, but the posting describes no ML work")
      : v("review", "role.research_unclear", "Research title; the text given does not show whether the work is ML");
  }
  const nonUs = usLocation(location) === "non_us";
  if (nonUs) return v("reject", "location.non_us", `Location outside the US: ${location.slice(0, 80)}`);

  const restriction = sponsorshipRestriction(body);
  if (restriction && me.needsSponsorship) {
    return official
      ? v("reject", "auth.no_sponsorship", `Posting says no sponsorship: "${restriction}"`)
      : v("review", "auth.no_sponsorship_unverified", `A third-party copy says no sponsorship: "${restriction}"`);
  }
  if (hints.sponsorship && /not offer|citizenship/i.test(hints.sponsorship) && me.needsSponsorship) {
    return v("review", "auth.list_says_no_sponsorship", `New-grad list says "${hints.sponsorship}"; confirm on the official posting`);
  }
  const citizenship = [...body.matchAll(new RegExp(CITIZENSHIP, "gi"))].find((m) => !/prefer|nice to have|a plus|bonus/i.test(body.slice(Math.max(0, m.index - 40), m.index + m[0].length + 20)));
  if (citizenship && !me.usCitizen) {
    const ctx = body.slice(Math.max(0, citizenship.index - 40), citizenship.index + citizenship[0].length + 30).replace(/\s+/g, " ");
    return official ? v("reject", "auth.citizenship", `Requires US citizenship or clearance: "${ctx.trim()}"`) : v("review", "auth.citizenship_unverified", `Third-party copy mentions citizenship or clearance: "${ctx.trim()}"`);
  }

  const phdBody = PHD_REQUIRED_BODY.exec(body);
  if (phdBody && !me.hasPhd && !MASTERS_BODY.test(body)) {
    const ctx = body.slice(Math.max(0, phdBody.index - 50), phdBody.index + phdBody[0].length + 50).replace(/\s+/g, " ").trim();
    return official ? v("reject", "degree.phd_required", `Description requires a PhD and never mentions a master's: "${ctx}"`) : v("review", "degree.phd_mentioned", `Copy mentions a PhD requirement: "${ctx}"`);
  }
  const experienced = EXPERIENCED_ONLY.exec(body);
  if (experienced) return v("reject", "experience.too_senior", `Posting is for experienced hires: "${experienced[0]}"`);

  const exp = requiredExperience(body);
  const earlyTitle = EARLY_TITLE.test(title);
  const two = TWO_YEARS_REQUIRED.exec(body);
  if (two && !(exp && exp.years >= 3)) {
    const ctx = body.slice(Math.max(0, two.index - 40), two.index + two[0].length + 60).replace(/\s+/g, " ").trim();
    return v("review", "experience.two_years", `Asks for at least 2 years: "${ctx}"; in scope only if the candidate counts 2-year minimums`);
  }
  if (exp && exp.years >= 3) {
    if (earlyTitle) return v("review", "experience.conflict", `Early-career title but asks ${exp.years}+ years: "${exp.context}"`);
    return v("reject", "experience.too_senior", `Requires ${exp.years}+ years: "${exp.context}"`);
  }
  if ((PHD_TITLE.test(title) && !MASTERS_OK.test(title)) || (/\bph\.?d\.?\b[^.]{0,40}\brequired\b/i.test(body) && !MASTERS_BODY.test(body))) {
    return v("review", "degree.phd_mentioned", "PhD mentioned; check whether a master's qualifies");
  }
  if (hints.unresolved) return v("review", "lead.unresolved", "Alert or hiring-post lead; find the official posting before judging");
  if (usLocation(location) === "unknown") return v("review", "location.unknown", `US location not established: "${location.slice(0, 80) || "none given"}"`);
  const bodyEarly = EARLY_BODY.exec(body);
  const signal = earlyTitle ? `title "${EARLY_TITLE.exec(title)![0]}"` : bodyEarly ? `description "${bodyEarly[0]}"` : hints.earlyCareerList ? "listed on a new-grad list" : "";
  if (!signal) return v("review", "level.unclear", "No new-grad or 0-2 year signal in title, description or source");
  if (dataScience) return v("review", "role.data_science", `Data-science title (early-career: ${signal}); in scope only if the candidate wants DS roles`);
  return v("match", "match", `${official ? "Official posting" : "Third-party listing only"}; early-career: ${signal}`);
}
