import { DECLINE, normalize } from "./text.ts";
import type { FormField } from "../domain/form.ts";
import type { Profile } from "../profile/schema.ts";
import { usLocation } from "../discover/triage.ts";

export const VETO: { pattern: RegExp; reason: string }[] = [
  { pattern: /\b(salary|compensation|pay expectation|desired pay|expected pay)\b/, reason: "compensation is never filled automatically" },
  { pattern: /\bemergency contact\b/, reason: "emergency contacts are someone else's data" },
  // Names and contacts of references are someone else's; "Are you able to provide references?" is hers (yes/no).
  { pattern: /^(?!.*\b(are you able|can you|will you be able|willing) to provide\b).*\breferences?\b/, reason: "references are someone else's data" },
  { pattern: /\b(signature|attest|certify)\b/, reason: "legal attestations need the candidate" },
];

export const COMPENSATION_VETO = VETO[0]!;
export const SALARY_EXPECTATION = /\b(expect|expectation|expectations|expected|desired|target|requirements?)\b/;
export const SALARY_HISTORY = /\b(current|previous|past|prior|last|history)\b/;

export const ATTESTATION_OPTION = /\b(i )?(acknowledge|acknowledged|agree|consent|accept|accepted|understand|understood|certify|attest|declare)\b/;

// A single-option "I have read the privacy policy / notice" box. Anything that
// also certifies answers, binds interview conduct or signs is not one.
export const PRIVACY_NOTICE = /\bprivacy (policy|notice|statement)\b|\bgdpr notice\b/;
// GlobalFoundries: "By submitting, you declare that you have read, understood, and accepted the terms in this policy".
export const TERMS_NOTICE = /\b(accept|agree to) the terms (and|&) conditions\b|\baccepted the terms in this policy\b/;
// What acceptApplicationAttestations covers, and the agreeing option to pick.
// Narrow on purpose: "certify" only next to accuracy, recording only of an interview, AI only in
// interview rules (a bare "Do you use AI tools?" or "criminal record" never matches).
// Workday's bare "Confirm Consent" box sits under the accuracy certification (Crowe).
// Adobe's "Check this box to confirm the statement above" closes its privacy, AI-use and accuracy terms.
export const ATTESTATION_ALLOWED = /^affirmation$|\bnot disclose or use\b.{0,160}\bconfidential or proprietary information of others\b|^confirm consent$|^check this box to confirm the statement above$|\bi certify that i have read\b.{0,60}\baccept all terms\b|\bai note ?taker\b|\bcertify\b.{0,120}\b(true|accurate|correct|complete)\b|\b(true (and|&) (complete|correct|accurate)|accurate and truthful|correct and complete)\b|\barbitration\b|\bhow we interview\b|\binterview (process|guidelines|expectations|policy|rules)\b|\b(ai|artificial intelligence) (during|in) (the |your )?interviews?\b|\b(interviews?|calls?|conversations?)\b.{0,60}\b(record(ed|ing)|transcri(be|bed|ption))\b|\b(record(ed|ing)|transcri(be|bed|ption))\b.{0,60}\binterviews?\b|\bconsent to .{1,40}\b(collecting|storing|processing)\b.{0,80}\b(responses|data|information)\b/;
export const AGREEING_OPTION = /^(yes|i agree|agree|i accept|accept|accepted|i acknowledge|acknowledge|i consent|consent|i certify|i understand)\b/i;
export const PRIVACY_EXCEPT = /\b(artificial intelligence|ai|certify|accurate|true|complete|signature|sign|arbitration|non compete|background|drug)\b/;

export const SENSITIVE =
  /\b(authori[sz]ed|authori[sz]ation|eligible to work|sponsor|sponsored|sponsorship|visa|citizen|citizenship|criminal|convicted|conviction|background check|disability|disabled|veteran|gender|sex|race|racial|ethnicity|hispanic|latino|previously (been )?employed|previously worked|worked (here|for) before|relatives?|related to|export control)\b/;

const COUNTRIES: { name: string; pattern: RegExp }[] = [
  { name: "Canada", pattern: /\bcanada\b/ },
  { name: "United Kingdom", pattern: /\b(united kingdom|uk|u k)\b/ },
  { name: "United States", pattern: /\b(united states|usa|u s a|u s|(in|within) the us|us (based )?(employer|company|companies))\b/ },
];

// "the country where the job is located" names no country; the posting does.
// Block: "the location posted for this position"; Stripe: "the location(s) you selected" (the job's country, filled before).
const JOB_COUNTRY = /\b(country|countries) (where|in which) (the|this) (job|position|role) is (located|based)\b|\bcountry in which you are applying\b|\blocation posted for this (position|role|job)\b|\blocations? (s )?you selected\b|\bpositions? (s )?country\b|\b(work|employed) in this (location|country)\b|\bcountry to which you are applying\b|\bcountry where the (job|position|role) (you are applying for |you applied for )?is (located|based)\b|\bcountry you are applying (to|for|in)\b|\bcountry (for which|where) you are applying\b/;

function countryIn(label: string, ctx: RuleContext): string | undefined {
  return COUNTRIES.find((c) => c.pattern.test(label))?.name ?? (JOB_COUNTRY.test(label) ? ctx.jobCountry : undefined);
}

export interface RuleContext {
  // YYYY-MM; tests pin it, runs use the current month.
  today?: string;
  // The field's choices, when it has any, so values can match their wording.
  options?: string[];
  // Set only when every location the posting lists is in that country.
  jobCountry?: string;
  // The hiring company, as the form names it.
  company?: string;
  // Where the posting is, as the form or catalog gives it.
  jobLocation?: string;
  // The page's own id for the field, for labels too bare to read alone (Workday's "From"/"To").
  fieldId?: string;
  // How many earlier applications to this employer the ledger holds.
  priorApplications?: number;
}

const STATES: Record<string, string> = { AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California", CO: "Colorado", CT: "Connecticut", DE: "Delaware", DC: "District of Columbia", FL: "Florida", GA: "Georgia", HI: "Hawaii", ID: "Idaho", IL: "Illinois", IN: "Indiana", IA: "Iowa", KS: "Kansas", KY: "Kentucky", LA: "Louisiana", ME: "Maine", MD: "Maryland", MA: "Massachusetts", MI: "Michigan", MN: "Minnesota", MS: "Mississippi", MO: "Missouri", MT: "Montana", NE: "Nebraska", NV: "Nevada", NH: "New Hampshire", NJ: "New Jersey", NM: "New Mexico", NY: "New York", NC: "North Carolina", ND: "North Dakota", OH: "Ohio", OK: "Oklahoma", OR: "Oregon", PA: "Pennsylvania", RI: "Rhode Island", SC: "South Carolina", SD: "South Dakota", TN: "Tennessee", TX: "Texas", UT: "Utah", VT: "Vermont", VA: "Virginia", WA: "Washington", WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming" };

// "NY" in the profile; "New York" when the form spells states out (or asks in free text).
function usStateName(state: string, options?: string[]): string {
  const full = STATES[state.toUpperCase()];
  if (!full) return state;
  if (!options || options.length === 0) return full;
  return options.some((o) => o.trim().toLowerCase() === full.toLowerCase()) ? full : state;
}

export function jobCountry(location: string | undefined): string | undefined {
  const parts = (location ?? "").split(/;|\||\bor\b|\n/).map((x) => x.trim()).filter(Boolean);
  return parts.length > 0 && parts.every((x) => usLocation(x) === "us") ? "United States" : undefined;
}

const yesNo = (b: boolean) => (b ? "Yes" : "No");

export interface ProfileRule {
  path: string;
  pattern: RegExp;
  kinds?: FormField["kind"][];
  resolve: (p: Profile, normalizedLabel: string, ctx: RuleContext) => string | undefined;
}

const firstEdu = (p: Profile) => p.education[0]!;

// Ordered: the first rule whose pattern matches the normalized label wins.
export const PROFILE_RULES: ProfileRule[] = [
  // Workday: an "I have a preferred name" box, ticked when the profile has one.
  { path: "identity.preferredName", pattern: /^i have a preferred name$/, kinds: ["checkbox"], resolve: (p, label, ctx) => (p.identity.preferredName ? ctx.options?.[0] : undefined) },
  { path: "identity.preferredName", pattern: /\bpreferred (first |given )?name\b/, kinds: ["text"], resolve: (p) => p.identity.preferredName },
  // "Full name" only: a bare "Name" is often an attestation signature (Lever's EEO block).
  { path: "identity.fullName", pattern: /^full (legal )?name$|\bfull legal name\b|\blegal name as it appears\b/, resolve: (p) => `${p.identity.firstName} ${p.identity.lastName}` },
  { path: "identity.lastName", pattern: /^preferred (last|family) name$/, resolve: (p) => p.identity.lastName },
  {
    // "Are you currently living in / based in the Bay Area?" from the state the candidate lives in.
    path: "contact.address.state",
    // Not a relocation question that names an office ("... a Lyft Office located in New York City or are you open to relocating?").
    pattern: /^(?!.*\brelocat)(?:.*\b(currently )?(living|based|located|residing|live) in (the )?(san francisco )?bay area\b|.*\b(currently )?(living|based|located|residing) in new york\b)/,
    resolve: (p, label) => yesNo(/bay area/.test(label) ? p.contact.address.state.toUpperCase() === "CA" : p.contact.address.state.toUpperCase() === "NY"),
  },
  {
    // "Are you currently pursuing a Masters Degree?" from the graduation date.
    path: "education",
    pattern: /^are you currently (pursuing|enrolled in) an? (masters?|ms|graduate) (degree|program)$/,
    resolve: (p, _label, ctx) => {
      const today = ctx.today ?? new Date().toISOString().slice(0, 7);
      const ms = p.education.find((e) => /master|m\.?s/i.test(e.degree));
      return ms ? yesNo(`${ms.gradYear}-${String(ms.gradMonth).padStart(2, "0")}` > today) : undefined;
    },
  },
  { path: "identity.firstName", pattern: /^(legal )?first name$|^given names?( s)?$|^what is your legal first name$/, resolve: (p) => p.identity.firstName },
  { path: "identity.lastName", pattern: /^(legal )?last name$|^family name$|^surname$|^what is your legal last name$/, resolve: (p) => p.identity.lastName },
  { path: "contact.email", pattern: /^e ?mail( address)?$/, resolve: (p) => p.contact.email },
  { path: "contact.phone", pattern: /^(phone|mobile|phone number|mobile number)$/, resolve: (p) => p.contact.phone },
  // Workday's phone block: her number is a mobile in the US.
  // Her number is a mobile: "Mobile", or a list's own word for it ("Personal Cell", "Cell Phone").
  {
    path: "contact.phoneType",
    pattern: /^phone device type$/,
    resolve: (_p, _l, ctx) => (ctx.options ?? []).find((o) => /^mobile\b/i.test(o.trim())) ?? (ctx.options ?? []).find((o) => /\b(cell|mobile)\b/i.test(o)) ??
      // Leidos offers only "Main/Home": it is her main number.
      (ctx.options ?? []).find((o) => /^(main|personal)\b/i.test(o.trim())) ?? "Mobile",
  },
  { path: "contact.address.country", pattern: /^country( region| territory)? phone code$/, resolve: (p) => (p.contact.address.country === "United States" ? "United States of America (+1)" : undefined) },
  {
    // "Legal Address", "Primary Residence Address", "Home address": the whole address on one line.
    path: "contact.address",
    pattern: /^(legal|home|mailing|residential|permanent|primary residence|current) (street )?address$|^(full|complete) address$/,
    kinds: ["text", "textarea"],
    resolve: (p) => {
      const a = p.contact.address;
      return a.line1 ? [a.line1, a.line2, a.city, `${a.state} ${a.postalCode ?? ""}`.trim(), a.country].filter(Boolean).join(", ") : undefined;
    },
  },
  { path: "contact.address.line1", pattern: /^(street )?address( line 1)?$/, resolve: (p) => p.contact.address.line1 },
  { path: "contact.address.line2", pattern: /^address line 2$|^(apt|apartment|suite|unit)\b/, resolve: (p) => p.contact.address.line2 },
  { path: "contact.address.city", pattern: /^city$|\b(current )?address city\b/, resolve: (p) => p.contact.address.city },
  {
    path: "contact.address.state",
    pattern: /^(state|state province|province)$|^state of residence$|\b(current )?address state\b|^which u ?s state are you located in$|\b(state|state region|state province)\b.{0,30}\b(you )?(currently )?(reside|live)\b|\bu ?s state\b.{0,30}\breside\b/,
    resolve: (p, _label, ctx) => usStateName(p.contact.address.state, ctx.options),
  },
  {
    path: "contact.address.county",
    pattern: /^(county|county of residence)$/,
    resolve: (p, _l, ctx) => {
      const c = p.contact.address.county;
      if (!c || !ctx.options?.length) return c;
      return ctx.options.find((o) => normalize(o).startsWith(normalize(c)));
    },
  },
  { path: "contact.address.postalCode", pattern: /^(zip|zip code|postal code|postcode|zip postal( code)?)$/, resolve: (p) => p.contact.address.postalCode },
  { path: "contact.address.country", pattern: /^country( of residence| region| territory)?$/, resolve: (p) => p.contact.address.country },
  { path: "links.linkedin", kinds: ["text"], pattern: /\blinkedin\b/, resolve: (p) => p.links.linkedin },
  { path: "links.github", kinds: ["text"], pattern: /\bgithub\b/, resolve: (p) => p.links.github },
  { path: "links.website", kinds: ["text"], pattern: /\b(website|portfolio|personal site)\b/, resolve: (p) => p.links.website },
  { path: "education[0].school", pattern: /^(school|university|college)( name)?$|^school or university$|^what (college|university|school)( ?\/? ?(college|university|school))? did you attend$/, resolve: (p) => firstEdu(p).school },
  {
    path: "education[0].degree",
    pattern: /^degree$/,
    // "Master of Science" onto a form's "Master's Degree".
    resolve: (p, _label, ctx) => {
      const degree = firstEdu(p).degree;
      const level = /^(master|bachelor|doctor)/i.exec(degree)?.[1]?.toLowerCase();
      const generic = level && (ctx.options ?? []).find((o) => new RegExp(`^${level}s( degree)?$`).test(normalize(o)));
      // Aerospace lists abbreviations ("MS", "BA").
      const abbr = { "master of science": "MS", "master of arts": "MA", "bachelor of science": "BS", "bachelor of arts": "BA" }[degree.toLowerCase()];
      const short = abbr && (ctx.options ?? []).find((o) => o.trim() === abbr);
      return generic ?? short ?? degree;
    },
  },
  { path: "education[0].major", pattern: /^(discipline|major|field of study|discipline field of study|major field of study)$/, resolve: (p) => firstEdu(p).major },
  // Ashby/Workday date pickers: the most recent degree's month and year, "05/2026".
  {
    path: "education[0].gradYear",
    pattern: /^(expected |anticipated )?graduation date( or anticipated graduation date)?$/,
    resolve: (p) => {
      const e = firstEdu(p);
      return e.gradMonth ? `${String(e.gradMonth).padStart(2, "0")}/${e.gradYear}` : undefined;
    },
  },
  {
    // Ashby's "Education History" block: "School | Degree | Field | MM/YYYY | MM/YYYY", most recent degree.
    path: "education[0]",
    pattern: /^education history$/,
    kinds: ["text"],
    resolve: (p) => {
      const e = firstEdu(p);
      const start = e.start ? `${e.start.slice(5, 7)}/${e.start.slice(0, 4)}` : "";
      return [e.school, e.degree, e.major, start, `${String(e.gradMonth).padStart(2, "0")}/${e.gradYear}`].join(" | ");
    },
  },
  {
    path: "education[0].gpa",
    pattern: /^(what is your )?(cumulative |overall )?gpa$|^overall result( gpa)?$/,
    // Klaviyo: ranges ("3.5 - 3.74", "4+", "Below 2").
    resolve: (p, _l, ctx) => {
      const gpa = firstEdu(p).gpa;
      const opts = ctx.options ?? [];
      if (!gpa || !opts.length) return gpa;
      const g = Number(gpa);
      const hit = opts.filter((o) => {
        const r = /^(\d+(?:\.\d+)?)\s*-\s*(\d+(?:\.\d+)?)$/.exec(o.trim());
        if (r) return g >= Number(r[1]) && g <= Number(r[2]) + 0.005;
        const plus = /^(\d+(?:\.\d+)?)\s*\+$/.exec(o.trim());
        return plus ? g >= Number(plus[1]) : false;
      });
      return hit.length === 1 ? hit[0] : undefined;
    },
  },
  {
    path: "education[0].gradYear",
    pattern: /^what is your (anticipated |expected )?graduation (month )?(and )?(year|month year|date)$|\bgraduation month ?\/? ?year for your masters? or highest completed degree\b/,
    resolve: (p, _l, ctx) => {
      const e = firstEdu(p);
      // Klaviyo: "May 2026" among choices.
      const named = `${new Date(Date.UTC(2000, e.gradMonth - 1, 1)).toLocaleString("en-US", { month: "long", timeZone: "UTC" })} ${e.gradYear}`;
      if (ctx.options?.length) return ctx.options.find((o) => normalize(o) === normalize(named));
      return `${String(e.gradMonth).padStart(2, "0")}/${e.gradYear}`;
    },
  },
  {
    // "Where did you complete your undergraduate degree?": the bachelor's school.
    path: "education",
    pattern: /\b(where did you (complete|earn|receive) your undergraduate|undergraduate (school|university|institution))\b/,
    kinds: ["text", "textarea"],
    resolve: (p) => p.education.find((e) => /bachelor|\bb\.?[as]\b/i.test(e.degree))?.school,
  },
  {
    // Bracebridge: "What year did/will you complete your undergraduate degree?"
    path: "education",
    pattern: /\byear did( ?\/? ?will)? you (complete|finish|graduate|earn) (from )?your (undergraduate|bachelor s?|masters?|graduate) (degree)?\b/,
    resolve: (p, label) => {
      const master = /\b(masters?|graduate) degree\b/.test(label);
      const b = p.education.find((e) => (master ? /master|\bm\.?s\b/i : /bachelor|\bb\.?[as]\b/i).test(e.degree));
      return b ? String(b.gradYear) : undefined;
    },
  },
  { path: "education[0].gradYear", pattern: /^(end|graduation) year$/, resolve: (p) => String(firstEdu(p).gradYear) },
  {
    path: "workAuthorization.authorizedCountries",
    pattern: /\b(legally authori[sz]ed|authori[sz]ed to (lawfully |legally )?work|eligible to work|right to work)\b|^(u s|us|united states) work authori[sz]ation$|\bhave (legal )?work authori[sz]ation in the country\b|\bunrestricted work authori[sz]ation\b/,
    resolve: (p, label, ctx) => {
      // "... in the country you currently reside in": hers, not the job's.
      const country = /\bcountry you (currently )?(reside|live) in\b/.test(label) ? p.contact.address.country : countryIn(label, ctx);
      if (!country) return undefined;
      const authorized = p.workAuthorization.authorizedCountries.includes(country);
      // Red Ventures: "Yes, and I am currently in F-1 status (if you currently have OPT ...)" among several Yes options.
      const status = p.workAuthorization.status ?? "";
      const f1 = /\bF-?1\b/i.test(status) ? (ctx.options ?? []).filter((o) => /\bF-?1 status\b/i.test(o)) : [];
      if (authorized && f1.length === 1) return f1[0];
      // ADI: "authorized to work ... on a fulltime and indefinite basis": OPT is not indefinite.
      if (/\b(indefinite|indefinitely|permanent basis|permanently|without (any )?(restriction|sponsorship|limitation)|unrestricted)\b/.test(label)) return yesNo(authorized && !p.workAuthorization.needsSponsorship);
      return yesNo(authorized);
    },
  },
  {
    path: "citizenship",
    // Sanctioned-country lists (Cuba, Iran, ...) have their own rule below.
    pattern: /^(?!.*\bcuba\b)(?!.*\bany (one )?of (the following|these) countries\b)(?!.*\bcountr(y|ies) of citizenship\b).*\b(citizen of|citizenship)\b/,
    resolve: (p, label, ctx) => {
      const country = countryIn(label, ctx);
      return country ? yesNo(p.citizenship.includes(country)) : undefined;
    },
  },
  {
    path: "restrictiveAgreements",
    pattern: /\bnon ?compete\b|\bnon ?solicitation\b|\brestrictive (covenant|agreement)s?\b|\bbound by any agreements?\b/,
    resolve: (p) => (p.restrictiveAgreements === undefined ? undefined : yesNo(p.restrictiveAgreements)),
  },
  {
    // "Are you a current or former Alphabet employee ...?" answered from the resume's employers.
    path: "workHistory",
    // (Government-employment questions have their own rule below.)
    pattern: /^(?!.*\bgovernment\b).*\b(current or former|previously (been )?employed|previously worked|worked (for|at) .{1,40} before|former) .{0,40}\b(employee|intern|contractor|employed|worked)\b|\bhave you (ever )?(worked for|been employed by) .{1,80}\b(in the past|before)\b|^have you (ever )?worked (at|for) [^ ]+( [^ ]+)?$|\bnow or have you previously been employed by\b|\bhave you previously worked as [a-z ]{1,40}? for\b|\bhave you (ever )?(previously )?been employed (at|by) .{1,60} for any length of time\b/,
    resolve: (p, label, ctx) => {
      const m =
        /\b(?:current or former|former) (.+?) (?:employee|intern)\b/.exec(label) ??
        // AEP: "Are you a former employee of AEP or any of AEP's subsidiary companies?"
        /\bformer (?:employee|intern|contractor) of (.+?)(?: or any\b| or its\b| or a\b|$)/.exec(label) ??
        // HP: "Have you previously been employed by HP? If you are currently employed by HP, ..."
        /\bpreviously been employed (?:by|at|with) (.+?)(?: if\b| as\b| in\b| for any\b|$)/.exec(label) ??
        // Atlas Air: "Are you a current or former contractor or vendor representative of Atlas Air?"
        /\bcurrent or former (?:employee|contractor|consultant|intern|vendor)[a-z ]{0,40}? (?:of|at|for) (.+)$/.exec(label) ??
        /\b(?:worked (?:for|at)|been employed by) (.+?) (?:before|in the past|or a subsidiary|or any subsidiary)\b/.exec(label) ??
        // Affirm: "Have you previously been employed at Affirm for any length of time?"
        /\bbeen employed (?:at|by) (.+?) for any length of time\b/.exec(label) ??
        // ADI: "Are you now or have you previously been employed by Analog Devices Inc. (ADI) or Maxim Integrated as a ..."
        /\bnow or have you previously been employed by (.+?) (?:as|in) a\b/.exec(label) ??
        // GlobalFoundries: "Have you previously worked as Employee or Intern for GlobalFoundries? If Yes, ..."
        /\bpreviously worked as [a-z ]{1,40}? for (.+?)(?: if\b|$)/.exec(label);
      // Bare "Have you worked at DoorDash?" only when it names the hiring company.
      const bare = /^have you (?:ever )?worked (?:at|for) (.+)$/.exec(label)?.[1];
      const company = (ctx.company ?? "").toLowerCase();
      // Otherwise the hiring company named anywhere in the question (GM: "... worked as an employee, Intern, contractor ... for General Motors or ...").
      const whole = company && new RegExp(`\\b${normalize(company)}\\b`).test(label) ? normalize(company) : undefined;
      const named = m?.[1]?.trim() ?? (bare && company && company.split(/\s+/)[0] === bare.split(" ")[0] ? bare : undefined) ?? whole;
      if (!named) return undefined;
      const worked = p.workHistory.some((w) => w.employer.toLowerCase().includes(named) || named.includes(w.employer.toLowerCase()));
      // Waymo: "Never worked at Alphabet" among current/former options; Home Depot: "Not Applicable".
      const never = (ctx.options ?? []).filter((o) => /^(never|i have never|i have not|no\b|not applicable$)/i.test(o.trim()));
      if (!worked && never.length === 1) return never[0];
      return yesNo(worked);
    },
  },
  {
    // "Are you currently serving or have you ever served as part of the military?" (P&G): she is on
    // F-1 status and her resume has no military service.
    path: "workHistory",
    pattern: /\b(serv(e|ed|ing)|service) (as part of|in|with) (the |any )?(u s |us )?(military|armed forces)\b/,
    kinds: ["select", "radio", "combobox"],
    resolve: (p, _l, ctx) => {
      if (p.workHistory.some((w) => /\b(army|navy|air force|marine|military|national guard)\b/i.test(w.employer))) return undefined;
      const no = (ctx.options ?? []).filter((o) => /^no\b/i.test(o.trim()));
      return ctx.options?.length ? (no.length === 1 ? no[0] : undefined) : "No";
    },
  },
  {
    // Asana: "Do you currently work for or have you ever worked for a U.S. government entity ...?" and its
    // "If you answered Yes, list the entity; if not applicable, type N/A": from the resume's employers.
    path: "workHistory",
    pattern: /\b(work(ed)? for|employed by) (a |an |any |the )?(u s |us |federal |state )?government\b|\bgovernment entity you worked for\b|\bemployee of (any |the )?(u s |us )?government\b|\b(current or former )?(u s |us |federal )?government employee\b/,
    resolve: (p, label, ctx) => {
      if (p.workHistory.some((w) => /\b(government|federal|department of|agency|u\.?s\.? army|navy|air force)\b/i.test(w.employer))) return undefined;
      if (/\bif you answered\b.*\bn ?a\b/.test(label)) return "N/A";
      const no = (ctx.options ?? []).filter((o) => /^no\b/i.test(o.trim()));
      return ctx.options?.length ? (no.length === 1 ? no[0] : undefined) : "No";
    },
  },
  {
    // Any other "have you worked for / been employed by / contracted with <this company>?":
    // the hiring company must be named, and her resume's employers decide.
    path: "workHistory",
    pattern: /\b(worked|been (previously )?employed|employed full time|engaged|contract work|contracted|provided services)\b.{0,60}\b(for|at|by|with)\b|\bare you a current employee (at|of)\b|\bare you currently an? (associate|employee|team member) (at|of)\b|\bare you currently employed (with|at|by)\b|\bare you an? (previous|former|prior) [a-z ]{0,40}\bemployee\b|\bbeen issued an? [a-z ]{1,30} (employee id|email address)\b/,
    kinds: ["select", "radio", "combobox", "checkbox"],
    resolve: (p, label, ctx) => {
      if (/\b(relative|family|familial|client|customer|government|partner|competitor)\b/.test(label)) return undefined;
      const first = normalize(ctx.company ?? "").replace(/^the /, "").split(" ")[0];
      // "American Institutes for Research" is also "AIR".
      const initials = (ctx.company ?? "").split(/\s+/).filter((w) => /^[A-Z]/.test(w)).map((w) => w[0]!.toLowerCase()).join("");
      const names = [first, initials.length >= 3 ? initials : ""].filter((x): x is string => Boolean(x && x.length >= 2));
      // Aerospace: "Have you previously worked for this organization?" names the hiring company too.
      const thisOne = /\bthis (organization|company|employer|firm)\b|\b(employed|worked) (with|for) us\b/.test(label);
      // "Hebrewseniorlife" in the catalog is "Hebrew SeniorLife" on the form.
      const squashed = normalize(ctx.company ?? "").replace(/ /g, "");
      const spaced = squashed.length >= 5 && label.replace(/ /g, "").includes(squashed);
      if (!thisOne && !spaced && !names.some((n) => new RegExp(`\\b${n}\\b`).test(label))) return undefined;
      if (p.workHistory.some((w) => normalize(w.employer).split(" ")[0] === first)) return undefined;
      const opts = ctx.options ?? [];
      const no = opts.filter((o) => /^(no\b|never\b|i have never\b|i have not\b|i am not\b|not\b)/i.test(o.trim()));
      if (opts.length && no.length !== 1) return undefined;
      return opts.length ? no[0] : "No";
    },
  },
  {
    // The candidate (2026-10-28): location answers say New York. "Do you have a location preference?" among the posting's offices.
    path: "contact.address.city",
    pattern: /\bmetropolitan area\b.{0,30}\b(closest|nearest)\b.{0,40}\bresidence\b|^(do you have a )?(preferred|location preference|preferred (work |office )?location)$|^do you have a location preference$|^which (office|location) (would you prefer|do you prefer)\b|^what is your preferred (work |office )?location$/,
    kinds: ["select", "radio", "combobox", "checkbox"],
    resolve: (p, _l, ctx) => {
      const metro = p.contact.address.state?.toUpperCase() === "NY" ? "new york" : normalize(p.contact.address.city ?? "");
      const hit = (ctx.options ?? []).filter((o) => normalize(o).startsWith(metro));
      return hit.length === 1 ? hit[0] : (ctx.options ?? []).find((o) => /^(no preference|either|any|open to any)\b/i.test(o.trim()));
    },
  },
  {
    // Coding-interview language: Python, from her resume (Quora's answer bank entry says the same).
    path: "interviewLanguage",
    pattern: /\b(programming languages?|coding (exercise|interview)s?)\b.{0,80}\bprefer/,
    kinds: ["select", "radio", "combobox"],
    resolve: (_p, _l, ctx) => (ctx.options ?? []).find((o) => /^python\b/i.test(o.trim())),
  },
  {
    // Age 18+: her B.A. ran 2019-2023 (answers.yaml over-18), in any wording.
    path: "age",
    pattern: /\b(over|at least|older than) (the age of )?18\b|\b18 (years|yrs) (of age )?(or older|and older|of age)\b|\blegal (working )?age\b|\b(current )?age range\b/,
    kinds: ["select", "radio", "combobox", "checkbox"],
    // Meijer: "18 years or older" among age ranges; Magna's menu that would not open: "Yes".
    resolve: (_p, _l, ctx) => {
      const opts = ctx.options ?? [];
      if (!opts.length) return "Yes";
      return opts.find((o) => /^yes\b/i.test(o.trim())) ?? opts.find((o) => /^18\b.*\b(older|over)\b|^18 ?\+/i.test(o.trim()));
    },
  },
  {
    // Start date in any wording: "November 15, 2026", or 11/15/2026 where the box asks for MM/DD/YYYY.
    path: "availableFrom",
    pattern: /\b(desired|earliest|anticipated|ideal|available|soonest|possible) (start|starting) date\b|\bstart date\b.{0,20}\b(for this role|availability)\b|\bwhen (can|could|would) you (start|begin)\b|\bavailable to (start|begin)\b|^start date$/,
    kinds: ["text", "textarea"],
    resolve: (p, label) => {
      const d = p.availableFrom;
      if (!d) return undefined;
      const [y, m, day] = d.split("-");
      if (/mm ?\/? ?dd/.test(label)) return `${m}/${day}/${y}`;
      return `${new Date(Date.UTC(Number(y), Number(m) - 1, Number(day))).toLocaleString("en-US", { month: "long", timeZone: "UTC" })} ${Number(day)}, ${y}`;
    },
  },
  {
    // Notice period as choices ("Immediately Available", "1 Month", ...): the shortest option that covers hers.
    path: "noticePeriodWeeks",
    pattern: /\bnotice period\b/,
    kinds: ["select", "radio", "combobox"],
    resolve: (p, _l, ctx) => {
      if (p.noticePeriodWeeks === undefined) return undefined;
      const weeks = (o: string) => {
        const t = normalize(o);
        if (/\bimmediate/.test(t)) return 0;
        const m = /(\d+)\s*(week|month)/.exec(t);
        return m ? Number(m[1]) * (m[2] === "month" ? 4.3 : 1) : undefined;
      };
      const fits = (ctx.options ?? []).map((o) => ({ o, w: weeks(o) })).filter((x) => x.w !== undefined && x.w >= p.noticePeriodWeeks! && !/\+/.test(x.o)).sort((a, b) => a.w! - b.w!);
      return fits[0]?.o;
    },
  },
  {
    // The candidate (2026-10-28): no other commitments; no outside work or business she would keep.
    path: "otherCommitments",
    pattern: /\b(outside employment|outside (professional|business) activit(y|ies)|engage in any outside)\b/,
    kinds: ["select", "radio", "combobox"],
    resolve: (_p, _l, ctx) => (ctx.options ?? []).find((o) => /^no$/i.test(o.trim())),
  },
  {
    // "Can you perform the essential functions of the job with or without reasonable accommodation?": she reports no disability.
    path: "eeo.disability",
    pattern: /\bperform (the|these) (essential|requisite) (functions|duties)\b|\bperform the (tasks|duties)( or functions)? (published|listed|described) in the job description\b|\bability to perform the requisite duties\b/,
    kinds: ["select", "radio", "combobox"],
    resolve: (p) => (p.eeo.disability === "no" ? "Yes" : undefined),
  },
  {
    // The candidate (2026-10-29) consented to AI resume screening and AI matching.
    path: "consentAiScreening",
    pattern: /\bai ?(assisted )?(resume )?screening\b|\bai assisted resume screening\b/,
    kinds: ["select", "radio", "combobox"],
    resolve: (p, _l, ctx) => (p.consentAiScreening ? (ctx.options ?? []).find((o) => /^(opt in|yes|i consent|i agree)\b/i.test(o.trim())) : undefined),
  },
  {
    // Text-message updates: the forms offer email instead; she has not opted in.
    path: "smsUpdates",
    pattern: /\b(sms|whatsapp|text messages?)\b/,
    kinds: ["select", "radio", "combobox", "checkbox"],
    resolve: (_p, _l, ctx) => ((ctx.options ?? []).filter((o) => /^no\b/i.test(o.trim())).length === 1 ? (ctx.options ?? []).find((o) => /^no\b/i.test(o.trim())) : undefined),
  },
  {
    // The candidate (2026-10-28): any US location; on-site five days, hybrid and relocation all work.
    // Yes/no only, and only for a posting located in the US.
    path: "workArrangement",
    pattern: /\b(on ?site|in office|in the office|in person|office (monday|five|5|four|4|three|3)|(five|5|four|4|three|3) days (a|per) week|relocat(e|ion|ing)|commute|commutable|work(ing)? (out of|from|in) our .{0,40}\b(office|hq|headquarters)|work in the specified (job )?location|(able|willing) to work (from|in|out of) [a-z ]{3,30}|fully in person|office hubs?)\b/,
    kinds: ["select", "radio", "combobox", "checkbox", "text"],
    resolve: (p, label, ctx) => {
      // A posting with any US location (Lila: Cambridge, London, San Francisco) has a place she would work.
      const anyUs = ctx.jobCountry === "United States" || (ctx.jobLocation ?? "").split(/;|\|/).some((x) => usLocation(x.trim()) === "us");
      if (!anyUs || /\b(legally|lawfully|authori[sz]|eligible|sponsor|visa)/.test(label)) return undefined;
      const opts = ctx.options ?? [];
      // A yes/no asked in a text box (Bot Auto: "Would you be able to work onsite at Houston, TX office?").
      if (!opts.length && !/^(are|would|will|can|do|is)\b|\b(are|would|will|can|do) you\b/.test(label)) return undefined;
      // Lyft: "I already reside near a Lyft office ..." / "I am willing to relocate ..." / "I am not willing ...".
      if (opts.length && !opts.some((o) => /^yes\b/i.test(o.trim()))) {
        // Near when the posting's place (or the office the question names) is her metro: New York for a NY address.
        const metro = p.contact.address.state?.toUpperCase() === "NY" ? "new york" : normalize(p.contact.address.city ?? "");
        const near = Boolean(metro) && normalize(`${ctx.jobLocation ?? ""} ${label}`).includes(metro) && !/\b(san francisco|seattle|boston|chicago|austin|los angeles)\b/.test(normalize(`${ctx.jobLocation ?? ""} ${label}`));
        // Expedia: "Nationally" / "Internationally" / "No": she relocates within the US.
        const national = p.workArrangement?.relocate ? opts.filter((o) => /^nationally$/i.test(o.trim())) : [];
        if (national.length === 1) return national[0];
        const pick = near ? opts.filter((o) => /\balready (reside|live)\b|\bable to commute\b/i.test(o)) : p.workArrangement?.relocate ? opts.filter((o) => /\b(willing|able) to relocate\b/i.test(o) && !/\bnot (willing|able)\b/i.test(o)) : [];
        return pick.length === 1 ? pick[0] : undefined;
      }
      // "Will you require relocation assistance?" is not a willingness question; a note that none is offered is.
      if (/\b(require|need|requesting|request|want)\b.{0,30}\b(support|assistance|package|stipend|reimburse)/.test(label)) return undefined;
      const relocation = /\brelocat/.test(label);
      const ok = relocation ? p.workArrangement?.relocate : p.workArrangement?.onsite;
      if (ok === undefined) return undefined;
      // Lyft: "Yes, I live nearby" / "Yes, I'm open to relocating": her willingness is the relocation one.
      const yes = (ctx.options ?? []).filter((o) => /^yes\b/i.test(o.trim()));
      if (ok && yes.length > 1) {
        const pick = yes.filter((o) => (relocation ? /relocat/i : /\b(on ?site|office|in person)\b/i).test(o));
        return pick.length === 1 ? pick[0] : undefined;
      }
      return yesNo(ok);
    },
  },
  {
    // "How did you hear about us?": the candidate does not mind which; the
    // agent finds postings on job lists, so the closest option says so.
    path: "howHeard",
    pattern: /^how did you (first )?(hear|learn) about |^what source s? of information influenced your decision to apply\b/,
    resolve: (_p, _label, ctx) => {
      const opts = ctx.options ?? [];
      // A search box (Workday) finds "LinkedIn" as one item; job-alert emails are one of the sources.
      if (!opts.length) return "LinkedIn";
      // On Workday the category that holds LinkedIn comes first ("Social Network" at RELX, whose
      // "Job Board" has no LinkedIn); the adapter chooses LinkedIn inside it.
      for (const want of [/^social (network|media)s?$/i, /^job ?boards?$/i, /\b(job|recruiting) boards?\b/i, /^github$/i, /^linkedin$/i, /careers? (site|page)|website/i, /^other$/i]) {
        const hit = opts.find((o) => want.test(o.trim()));
        if (hit) return hit;
      }
      return undefined;
    },
  },
  {
    // "What is your highest level of education earned?": the highest completed degree, in the form's wording.
    path: "education",
    pattern: /\bhighest (level of )?(education|degree)\b|^current level of education$/,
    resolve: (p, _label, ctx) => {
      const today = ctx.today ?? new Date().toISOString().slice(0, 7);
      const rank = (d: string) => (/doctor|ph\.?d/i.test(d) ? 3 : /master|m\.?s\b|mba/i.test(d) ? 2 : /bachelor|b\.?a\b|b\.?s\b/i.test(d) ? 1 : 0);
      const earned = p.education.filter((e) => `${e.gradYear}-${String(e.gradMonth).padStart(2, "0")}` <= today).sort((a, b) => rank(b.degree) - rank(a.degree))[0];
      if (!earned) return undefined;
      const want = ["", "bachelor", "master", "doctor"][rank(earned.degree)] ?? "";
      return (want && (ctx.options ?? []).find((o) => normalize(o).startsWith(want))) || earned.degree;
    },
  },
  {
    // "Did you graduate?": her most recent degree's end date has passed.
    path: "education",
    pattern: /^(did you graduate|have you graduated)$/,
    resolve: (p, _label, ctx) => {
      const today = ctx.today ?? new Date().toISOString().slice(0, 7);
      const e = firstEdu(p);
      return yesNo(`${e.gradYear}-${String(e.gradMonth).padStart(2, "0")}` <= today);
    },
  },
  {
    // ADI: "Are you currently enrolled in an accredited degree program?": any degree ending after today.
    path: "education",
    pattern: /^are you (currently )?(enrolled in|pursuing) an? (accredited )?(degree|university|college) program$|^are you currently a student$/,
    resolve: (p, _label, ctx) => {
      const today = ctx.today ?? new Date().toISOString().slice(0, 7);
      return yesNo(p.education.some((e) => `${e.gradYear}-${String(e.gradMonth).padStart(2, "0")}` > today));
    },
  },
  {
    // ADI: "Please add your Country of Citizenship or Countries of Citizenship if dual".
    path: "citizenship",
    pattern: /\bcountr(y|ies) of citizenship\b/,
    resolve: (p, _label, ctx) => {
      const opts = ctx.options ?? [];
      if (!opts.length) return p.citizenship.join(", ") || undefined;
      const hits = p.citizenship.map((c) => opts.find((o) => normalize(o) === normalize(c)) ?? opts.find((o) => normalize(o).startsWith(`${normalize(c)} `)));
      return hits.length === 1 ? hits[0] : undefined;
    },
  },
  {
    // ADI export control: "Are you a citizen of any of the following countries: Group D (Armenia, ..., China (PRC), ...)".
    path: "citizenship",
    pattern: /\bcitizen of any (one )?of (the following|these) countries\b/,
    resolve: (p, label) => yesNo(p.citizenship.some((c) => new RegExp(`\\b${normalize(c)}\\b`).test(label))),
  },
  {
    // ADI: "Are you any of the following: US Citizen, Permanent resident of the United States
    // (Green Card), or Protected person under 8 USC 1324b(a)(3)?" Needing sponsorship rules all three out.
    path: "workAuthorization.needsSponsorship",
    pattern: /\bus citizen\b.*\bpermanent resident\b.*\bprotected person\b/,
    resolve: (p) => (p.citizenship.includes("United States") ? "Yes" : p.workAuthorization.needsSponsorship ? "No" : undefined),
  },
  {
    // Asana: "Are you a citizen or legal permanent resident of Cuba, Iran, North Korea, Syria or Ukraine (Crimea region)?"
    path: "citizenship",
    pattern: /\bcitizen or (legal )?permanent resident of cuba\b/,
    resolve: (p) => yesNo(p.citizenship.some((c) => /cuba|iran|north korea|syria|ukraine/i.test(c))),
  },
  {
    // Lila Sciences: "Do you currently reside within the continental United States?"
    path: "contact.address.country",
    pattern: /^do you (currently )?(reside|live) (in|within) the (continental )?(united states|u s|us)$/,
    resolve: (p) => yesNo(p.contact.address.country === "United States" && !/alaska|hawaii|^ak$|^hi$/i.test(p.contact.address.state ?? "")),
  },
  {
    // Export-control "U.S. person" questions, from citizenship. Her F-1 status
    // makes her none of citizen, permanent resident, refugee or asylee.
    path: "citizenship",
    pattern: /\bexport (controls?|compliance)\b|\bu s persons?\b/,
    resolve: (p, _label, ctx) => {
      const opts = ctx.options ?? [];
      if (p.citizenship.includes("United States")) return opts.find((o) => /\bcitizen\b/i.test(o));
      // Relativity: "I am currently a U.S. Person" / "I am not a U.S. Person".
      const notPerson = opts.filter((o) => /\bnot an? .{0,3}u\.?\s?s\.? person\b/i.test(o));
      if (notPerson.length === 1) return notPerson[0];
      // CoreWeave: "Please indicate whether you are a U.S. person" with Yes/No.
      if (/\bu s person\b/.test(normalize(_label)) && opts.some((o) => /^no$/i.test(o.trim()))) return opts.find((o) => /^no$/i.test(o.trim()));
      return opts.find((o) => /^none of the above$/i.test(o.trim()));
    },
  },
  {
    // Eligibility for a U.S. security clearance requires U.S. citizenship;
    // "Yes, I am eligible" would be false, whatever checks she accepts.
    path: "citizenship",
    pattern: /\bsecurity clearance\b/,
    resolve: (p, label, ctx) => {
      const opts = ctx.options ?? [];
      if (p.citizenship.includes("United States")) return undefined;
      if (/\bheld\b|\bclearance level\b/.test(label)) return opts.find((o) => /\bnever held\b|^n ?\/? ?a\b/i.test(o.trim())) ?? opts.find((o) => /^no$/i.test(o.trim()));
      return opts.find((o) => /^(no|none)$/i.test(o.trim()));
    },
  },
  {
    // Workday's work-experience block: "From"/"To" (MM/YYYY) of the role filled above (the most recent finished one).
    path: "workHistory",
    pattern: /^(from|to)$/,
    resolve: (p, label, ctx) => {
      const id = ctx.fieldId?.split("-").pop() ?? "";
      // The education block's "From"/"To" are years attended of the most recent degree.
      if (/^(firstYearAttended|lastYearAttended)$/.test(id)) {
        const e = firstEdu(p);
        return id === "firstYearAttended" ? e.start?.slice(0, 4) : String(e.gradYear);
      }
      if (!/^(startDate|endDate)$/.test(id)) return undefined;
      const w = p.workHistory.filter((x) => x.start && x.end).sort((a, b) => b.end!.localeCompare(a.end!))[0];
      const d = w && (label === "from" ? w.start : w.end);
      return d ? `${d.slice(5, 7)}/${d.slice(0, 4)}` : undefined;
    },
  },
  {
    // Lyft's employment section: the most recent finished role on the resume.
    path: "workHistory",
    pattern: /^(company|company name|employer name|title|job title|(start|end) date (month|year))$/,
    resolve: (p, label, ctx) => {
      const w = p.workHistory.filter((x) => x.start && x.end).sort((a, b) => b.end!.localeCompare(a.end!))[0];
      if (!w) return undefined;
      if (/company|employer/.test(label)) return w.employer;
      if (/title/.test(label)) return w.title;
      const [y, m] = (label.startsWith("start") ? w.start! : w.end!).split("-");
      if (label.endsWith("year")) return y;
      return new Date(Date.UTC(2000, Number(m) - 1, 1)).toLocaleString("en-US", { month: "long", timeZone: "UTC" });
    },
  },
  // Workday's disability self-identification form: its language, and (only with her
  // permission) the typed name and date that sign it.
  { path: "language", pattern: /^language$/, resolve: (_p, _l, ctx) => ((ctx.options ?? []).includes("English") ? "English" : undefined) },
  // Workday's language block (English, filled above): read, speak and write proficiency. She studied and works in English.
  {
    path: "language",
    pattern: /^(read|speak|write|reading|speaking|writing)$/,
    resolve: (_p, _l, ctx) => (ctx.options ?? []).find((o) => /^(fluent|native|advanced|proficient)\b/i.test(o.trim())) ?? (ctx.options?.length ? undefined : "Fluent"),
  },
  {
    path: "signSelfIdentificationForms",
    pattern: /^self identification form signature (name|date)$/,
    resolve: (p, label, ctx) => {
      if (!p.signSelfIdentificationForms) return undefined;
      if (label.endsWith("name")) return `${p.identity.firstName} ${p.identity.lastName}`;
      const d = ctx.today && ctx.today.length >= 10 ? ctx.today : new Date().toISOString().slice(0, 10);
      return `${d.slice(5, 7)}/${d.slice(8, 10)}/${d.slice(0, 4)}`;
    },
  },
  {
    // GlobalFoundries: "Are you or have you in the past been a contingent work or contractor for X?",
    // "Have you previously worked for X, IBM Microelectronics, or Chartered Semiconductor (...)?":
    // No unless an employer from the resume is named.
    path: "workHistory",
    pattern: /\b(contingent work(er)?|contractor) for\b|^have you previously worked for\b/,
    resolve: (p, label) => yesNo(p.workHistory.some((w) => label.includes(normalize(w.employer)))),
  },
  {
    // The candidate (2026-10-28): she knows no one at any company, relatives included.
    path: "relativesAtEmployers",
    pattern: /\b(do you have|have any) relatives? (employed|working) (by|at|for)\b|\brelatives? (employed|working) (by|at|for)\b|\b(familial|romantic|close personal) .{0,40}relationship with an? .{1,40}\b(employee|applicant)\b|\bfamily members?\b.{0,80}\bwho work (for|at)\b|\bare you related to an? .{1,60}\b(employee|staff|team member)s?\b|\brelatives? who (are|is) (currently )?(employed|working)\b|\b(closely related to|close personal relationship with) anyone who (currently )?works (at|for)\b|\bare you related by blood\b.{0,40}\bto an? (current )?employee\b|\bare you related to\b.{0,120}\b(anyone|someone) who (is|was) (employed by|working (for|at))\b/,
    resolve: (p) => (p.relativesAtEmployers === false ? "No" : undefined),
  },
  {
    // "Have you applied to X within the past 6 months?": from the ledger.
    path: "ledger",
    pattern: /\bhave you applied (to|with) .{1,60} (within|in) the (past|last) .{1,20}\b/,
    resolve: (_p, _label, ctx) => (ctx.priorApplications === undefined ? undefined : yesNo(ctx.priorApplications > 0)),
  },
  {
    // Asana: "Current Company"; the work-history entry with no end date.
    path: "workHistory",
    kinds: ["text", "textarea", "combobox"],
    pattern: /^(name of (your )?)?(current|most recent|current or most recent) (company|employer)( name)?$|^where have you most recently worked$|^who is your (current|most recent|current or most recent) employer$/,
    resolve: (p) => p.workHistory.find((w) => !w.end)?.employer,
  },
  {
    path: "workHistory",
    pattern: /^(current|most recent|current or most recent) (job )?(title|position|role)$|^what is your (current|most recent) (job )?(title|position|role)$/,
    // (Not Greenhouse's "Current role" checkbox in the employment section.)
    kinds: ["text", "textarea"],
    resolve: (p) => p.workHistory.find((w) => !w.end)?.title,
  },
  {
    // Waymo, Lyft: "Work Authorization" with any-employer / needs-our-sponsorship / unknown options.
    path: "workAuthorization.needsSponsorship",
    pattern: /^work authori[sz]ation( status)?$/,
    resolve: (p, _label, ctx) => {
      const opts = ctx.options ?? [];
      const pick = p.workAuthorization.needsSponsorship
        ? opts.filter((o) => /\brequire\b.*\bsponsorship\b/i.test(o))
        : opts.filter((o) => /\bauthori[sz]ed to work for any employer\b/i.test(o));
      return pick.length === 1 ? pick[0] : undefined;
    },
  },
  {
    path: "workAuthorization.needsSponsorship",
    // Pinterest: "Will you require our assistance with work authorization now or in the future?"
    pattern: /\b(sponsorship|sponorship|sponsor|sponsored)\b|\bassistance with work authori[sz]ation\b|\bimmigration (assistance|support)\b/,
    // Options that split "now" from "in the future": authorized today and
    // needing sponsorship means the future one.
    resolve: (p, _label, ctx) => {
      const opts = ctx.options ?? [];
      const yes = opts.filter((o) => /^yes\b/i.test(o.trim()));
      if (p.workAuthorization.needsSponsorship && yes.length > 1) {
        if (!ctx.jobCountry) return undefined;
        const now = p.workAuthorization.authorizedCountries.includes(ctx.jobCountry);
        const pick = yes.filter((o) => (now ? /\bin the future\b/i : /\bnow\b/i).test(o));
        if (pick.length === 1) return pick[0];
        return undefined;
      }
      return yesNo(p.workAuthorization.needsSponsorship);
    },
  },
  { path: "eeo.hispanicLatino", pattern: /\b(hispanic|latino)\b/, resolve: (p) => p.eeo.hispanicLatino },
  // DoorDash: "Do you identify as transgender?" follows the gender choice (decline).
  // DoorDash: "Do you identify as transgender?" The candidate gave no answer: decline.
  // Pronouns follow her gender choice: undisclosed where the list lets her decline.
  { path: "eeo.gender", pattern: /\b(transgender|sexual orientation|lgbtq?i?a?)\b|^(your )?pronouns?$|^what are your (preferred )?(personal )?pronouns$/, kinds: ["select", "radio", "combobox"], resolve: () => "decline" },
  // The candidate (2026-10-29): decline when the form lets her; when it requires a choice, her genderIfRequired.
  {
    path: "eeo.gender",
    pattern: /^(gender|sex)$|^your (gender|sex)$|\b(indicate|select|describe|identify) your (gender|sex)\b|^gender identity$|\bidentify my gender\b|^what is your (gender|sex)$/,
    resolve: (p, _label, ctx) => {
      const opts = ctx.options ?? [];
      if (p.eeo.gender !== "decline" || !opts.length || opts.some((o) => DECLINE.test(normalize(o)))) return p.eeo.gender;
      return p.eeo.genderIfRequired ?? p.eeo.gender;
    },
  },
  { path: "eeo.race", pattern: /^(race|ethnicity|race ethnicity)$|^race\b|\byour (race|ethnicity)\b|\brace ?\/? ?ethnic|\bethnic group\b|\bracial ethnic background\b|\bidentify my ethnicity\b/, resolve: (p) => p.eeo.race },
  { path: "eeo.veteran", pattern: /\bveterans?\b/, resolve: (p) => p.eeo.veteran },
  { path: "eeo.disability", pattern: /\bdisability\b/, resolve: (p) => p.eeo.disability },
];

export const RESUME = /\b(resume|cv)\b/;
