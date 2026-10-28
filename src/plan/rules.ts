import type { FormField } from "../domain/form.ts";
import type { Profile } from "../profile/schema.ts";
import { usLocation } from "../discover/triage.ts";

export const VETO: { pattern: RegExp; reason: string }[] = [
  { pattern: /\b(salary|compensation|pay expectation|desired pay|expected pay)\b/, reason: "compensation is never filled automatically" },
  { pattern: /\bemergency contact\b/, reason: "emergency contacts are someone else's data" },
  { pattern: /\breferences?\b/, reason: "references are someone else's data" },
  { pattern: /\b(signature|attest|certify)\b/, reason: "legal attestations need the candidate" },
];

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
  { path: "education[0].degree", pattern: /^degree$/, resolve: (p) => firstEdu(p).degree },
  { path: "education[0].major", pattern: /^(discipline|major|field of study)$/, resolve: (p) => firstEdu(p).major },
  { path: "education[0].gradYear", pattern: /^(end|graduation) year$/, resolve: (p) => String(firstEdu(p).gradYear) },
  {
    path: "workAuthorization.authorizedCountries",
    pattern: /\b(legally authori[sz]ed|authori[sz]ed to work|eligible to work)\b/,
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
    pattern: /\b(current or former|previously (been )?employed|previously worked|worked (for|at) .{1,40} before|former) .{0,40}\b(employee|intern|contractor|employed|worked)\b|\bhave you (ever )?worked for .{1,60}\b(in the past|before)\b/,
    resolve: (p, label) => {
      const m = /\b(?:current or former|former) (.+?) (?:employee|intern)\b/.exec(label) ?? /\bworked (?:for|at) (.+?) (?:before|in the past|or a subsidiary)\b/.exec(label);
      const named = m?.[1]?.trim();
      if (!named) return undefined;
      return yesNo(p.workHistory.some((w) => w.employer.toLowerCase().includes(named) || named.includes(w.employer.toLowerCase())));
    },
  },
  {
    path: "workAuthorization.needsSponsorship",
    pattern: /\b(sponsorship|sponsor)\b/,
    resolve: (p) => yesNo(p.workAuthorization.needsSponsorship),
  },
  { path: "eeo.hispanicLatino", pattern: /\b(hispanic|latino)\b/, resolve: (p) => p.eeo.hispanicLatino },
  { path: "eeo.gender", pattern: /^(gender|sex)$|\b(indicate|select|describe) your gender\b|^gender identity$/, resolve: (p) => p.eeo.gender },
  { path: "eeo.race", pattern: /^(race|ethnicity|race ethnicity)$|\byour race\b|\brace ?\/? ?ethnic|\bethnic group\b/, resolve: (p) => p.eeo.race },
  { path: "eeo.veteran", pattern: /\bveteran\b/, resolve: (p) => p.eeo.veteran },
  { path: "eeo.disability", pattern: /\bdisability\b/, resolve: (p) => p.eeo.disability },
];

export const RESUME = /\b(resume|cv)\b/;
