import type { FormField } from "../domain/form.ts";
import type { Profile } from "../profile/schema.ts";
import { usLocation } from "../discover/triage.ts";

export const VETO: { pattern: RegExp; reason: string }[] = [
  { pattern: /\b(salary|compensation|pay expectation|desired pay|expected pay)\b/, reason: "compensation is never filled automatically" },
  { pattern: /\bemergency contact\b/, reason: "emergency contacts are someone else's data" },
  { pattern: /\breferences?\b/, reason: "references are someone else's data" },
  { pattern: /\b(signature|attest|certify)\b/, reason: "legal attestations need the candidate" },
];

export const COMPENSATION_VETO = VETO[0]!;
export const SALARY_EXPECTATION = /\b(expect|expectation|expectations|expected|desired|target)\b/;
export const SALARY_HISTORY = /\b(current|previous|past|prior|last|history)\b/;

export const ATTESTATION_OPTION = /\b(i )?(acknowledge|agree|consent|accept|understand|certify|attest)\b/;

// A single-option "I have read the privacy policy / notice" box. Anything that
// also certifies answers, binds interview conduct or signs is not one.
export const PRIVACY_NOTICE = /\bprivacy (policy|notice|statement)\b/;
export const PRIVACY_EXCEPT = /\b(artificial intelligence|ai|certify|accurate|true|complete|signature|sign|arbitration|non compete|background|drug)\b/;

export const SENSITIVE =
  /\b(authori[sz]ed|authori[sz]ation|eligible to work|sponsor|sponsorship|visa|citizen|citizenship|criminal|convicted|conviction|background check|disability|disabled|veteran|gender|sex|race|racial|ethnicity|hispanic|latino|previously (been )?employed|previously worked|worked (here|for) before|relatives?|related to|export control)\b/;

const COUNTRIES: { name: string; pattern: RegExp }[] = [
  { name: "Canada", pattern: /\bcanada\b/ },
  { name: "United Kingdom", pattern: /\b(united kingdom|uk|u k)\b/ },
  { name: "United States", pattern: /\b(united states|usa|u s a|u s|(in|within) the us)\b/ },
];

// "the country where the job is located" names no country; the posting does.
const JOB_COUNTRY = /\b(country|countries) (where|in which) (the|this) (job|position|role) is (located|based)\b|\bcountry in which you are applying\b/;

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
  { path: "identity.preferredName", pattern: /\bpreferred (first )?name\b/, resolve: (p) => p.identity.preferredName },
  // "Full name" only: a bare "Name" is often an attestation signature (Lever's EEO block).
  { path: "identity.fullName", pattern: /^full (legal )?name$|\bfull legal name\b|\blegal name as it appears\b/, resolve: (p) => `${p.identity.firstName} ${p.identity.lastName}` },
  { path: "identity.lastName", pattern: /^preferred last name$/, resolve: (p) => p.identity.lastName },
  {
    // "Are you currently living in / based in the Bay Area?" from the state the candidate lives in.
    path: "contact.address.state",
    pattern: /\b(currently )?(living|based|located|residing|live) in (the )?(san francisco )?bay area\b|\b(currently )?(living|based|located|residing) in new york\b/,
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
  { path: "identity.firstName", pattern: /^(legal )?first name$|^given name$/, resolve: (p) => p.identity.firstName },
  { path: "identity.lastName", pattern: /^(legal )?last name$|^family name$|^surname$/, resolve: (p) => p.identity.lastName },
  { path: "contact.email", pattern: /^e ?mail( address)?$/, resolve: (p) => p.contact.email },
  { path: "contact.phone", pattern: /^(phone|mobile|phone number|mobile number)$/, resolve: (p) => p.contact.phone },
  { path: "contact.address.line1", pattern: /^(street )?address( line 1)?$/, resolve: (p) => p.contact.address.line1 },
  { path: "contact.address.line2", pattern: /^address line 2$|^(apt|apartment|suite|unit)\b/, resolve: (p) => p.contact.address.line2 },
  { path: "contact.address.city", pattern: /^city$/, resolve: (p) => p.contact.address.city },
  {
    path: "contact.address.state",
    pattern: /^(state|state province|province)$|\b(state|state region|state province)\b.{0,30}\b(you )?(currently )?(reside|live)\b|\bu ?s state\b.{0,30}\breside\b/,
    resolve: (p, _label, ctx) => usStateName(p.contact.address.state, ctx.options),
  },
  { path: "contact.address.postalCode", pattern: /^(zip|zip code|postal code|postcode)$/, resolve: (p) => p.contact.address.postalCode },
  { path: "contact.address.country", pattern: /^country( of residence)?$/, resolve: (p) => p.contact.address.country },
  { path: "links.linkedin", kinds: ["text"], pattern: /\blinkedin\b/, resolve: (p) => p.links.linkedin },
  { path: "links.github", kinds: ["text"], pattern: /\bgithub\b/, resolve: (p) => p.links.github },
  { path: "links.website", kinds: ["text"], pattern: /\b(website|portfolio|personal site)\b/, resolve: (p) => p.links.website },
  { path: "education[0].school", pattern: /^(school|university|college)( name)?$/, resolve: (p) => firstEdu(p).school },
  {
    path: "education[0].degree",
    pattern: /^degree$/,
    // "Master of Science" onto a form's "Master's Degree".
    resolve: (p, _label, ctx) => {
      const degree = firstEdu(p).degree;
      const level = /^(master|bachelor|doctor)/i.exec(degree)?.[1]?.toLowerCase();
      const generic = level && (ctx.options ?? []).find((o) => new RegExp(`^${level}'?s( degree)?$`, "i").test(o.trim()));
      return generic ?? degree;
    },
  },
  { path: "education[0].major", pattern: /^(discipline|major|field of study)$/, resolve: (p) => firstEdu(p).major },
  { path: "education[0].gradYear", pattern: /^(end|graduation) year$/, resolve: (p) => String(firstEdu(p).gradYear) },
  {
    path: "workAuthorization.authorizedCountries",
    pattern: /\b(legally authori[sz]ed|authori[sz]ed to work|eligible to work)\b|^(u s|us|united states) work authori[sz]ation$/,
    resolve: (p, label, ctx) => {
      const country = countryIn(label, ctx);
      return country ? yesNo(p.workAuthorization.authorizedCountries.includes(country)) : undefined;
    },
  },
  {
    path: "citizenship",
    pattern: /\b(citizen of|citizenship)\b/,
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
    pattern: /\b(current or former|previously (been )?employed|previously worked|worked (for|at) .{1,40} before|former) .{0,40}\b(employee|intern|contractor|employed|worked)\b|\bhave you (ever )?(worked for|been employed by) .{1,80}\b(in the past|before)\b|^have you (ever )?worked (at|for) [^ ]+( [^ ]+)?$/,
    resolve: (p, label, ctx) => {
      const m =
        /\b(?:current or former|former) (.+?) (?:employee|intern)\b/.exec(label) ??
        /\b(?:worked (?:for|at)|been employed by) (.+?) (?:before|in the past|or a subsidiary|or any subsidiary)\b/.exec(label);
      // Bare "Have you worked at DoorDash?" only when it names the hiring company.
      const bare = /^have you (?:ever )?worked (?:at|for) (.+)$/.exec(label)?.[1];
      const company = (ctx.company ?? "").toLowerCase();
      const named = m?.[1]?.trim() ?? (bare && company && company.split(/\s+/)[0] === bare.split(" ")[0] ? bare : undefined);
      if (!named) return undefined;
      const worked = p.workHistory.some((w) => w.employer.toLowerCase().includes(named) || named.includes(w.employer.toLowerCase()));
      // Waymo: "Never worked at Alphabet" among current/former options.
      const never = (ctx.options ?? []).filter((o) => /^(never|i have never|no\b)/i.test(o.trim()));
      if (!worked && never.length === 1) return never[0];
      return yesNo(worked);
    },
  },
  {
    // "How did you hear about us?": the candidate does not mind which; the
    // agent finds postings on job lists, so the closest option says so.
    path: "howHeard",
    pattern: /^how did you (hear|learn) about /,
    resolve: (_p, _label, ctx) => {
      const opts = ctx.options ?? [];
      if (!opts.length) return "Job board";
      for (const want of [/^job ?boards?$/i, /\bjob board\b/i, /^github$/i, /^linkedin$/i, /careers? (site|page)|website/i, /^other$/i]) {
        const hit = opts.find((o) => want.test(o.trim()));
        if (hit) return hit;
      }
      return undefined;
    },
  },
  {
    // Export-control "U.S. person" questions, from citizenship. Her F-1 status
    // makes her none of citizen, permanent resident, refugee or asylee.
    path: "citizenship",
    pattern: /\bexport controls?\b/,
    resolve: (p, _label, ctx) => {
      const opts = ctx.options ?? [];
      if (p.citizenship.includes("United States")) return opts.find((o) => /\bcitizen\b/i.test(o));
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
      if (/\bheld\b|\bclearance level\b/.test(label)) return opts.find((o) => /\bnever held\b|^n ?\/? ?a\b/i.test(o.trim()));
      return opts.find((o) => /^no$/i.test(o.trim()));
    },
  },
  {
    // Lyft's employment section: the most recent finished role on the resume.
    path: "workHistory",
    pattern: /^(company name|employer name|title|job title|(start|end) date (month|year))$/,
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
  {
    // Asana: "Current Company"; the work-history entry with no end date.
    path: "workHistory",
    pattern: /^(current|most recent) (company|employer)( name)?$/,
    resolve: (p) => p.workHistory.find((w) => !w.end)?.employer,
  },
  {
    path: "workHistory",
    pattern: /^(current|most recent) (job )?(title|position|role)$/,
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
    pattern: /\b(sponsorship|sponsor)\b/,
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
  { path: "eeo.gender", pattern: /^(gender|sex)$|\b(indicate|select|describe) your gender\b|^gender identity$/, resolve: (p) => p.eeo.gender },
  { path: "eeo.race", pattern: /^(race|ethnicity|race ethnicity)$|\byour race\b|\brace ?\/? ?ethnic|\bethnic group\b/, resolve: (p) => p.eeo.race },
  { path: "eeo.veteran", pattern: /\bveteran\b/, resolve: (p) => p.eeo.veteran },
  { path: "eeo.disability", pattern: /\bdisability\b/, resolve: (p) => p.eeo.disability },
];

export const RESUME = /\b(resume|cv)\b/;
