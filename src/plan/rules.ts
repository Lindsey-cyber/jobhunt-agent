import type { FormField } from "../domain/form.ts";
import type { Profile } from "../profile/schema.ts";

export const VETO: { pattern: RegExp; reason: string }[] = [
  { pattern: /\b(salary|compensation|pay expectation|desired pay|expected pay)\b/, reason: "compensation is never filled automatically" },
  { pattern: /\bemergency contact\b/, reason: "emergency contacts are someone else's data" },
  { pattern: /\breferences?\b/, reason: "references are someone else's data" },
  { pattern: /\b(signature|attest|certify)\b/, reason: "legal attestations need the candidate" },
];

export const SENSITIVE =
  /\b(authori[sz]ed|authori[sz]ation|eligible to work|sponsor|sponsorship|visa|citizen|citizenship|criminal|convicted|conviction|background check|disability|disabled|veteran|gender|sex|race|racial|ethnicity|hispanic|latino|previously (been )?employed|previously worked|worked (here|for) before|relatives?|related to|export control)\b/;

const COUNTRIES: { name: string; pattern: RegExp }[] = [
  { name: "Canada", pattern: /\bcanada\b/ },
  { name: "United Kingdom", pattern: /\b(united kingdom|uk|u k)\b/ },
  { name: "United States", pattern: /\b(united states|usa|u s a|u s|(in|within) the us)\b/ },
];

function countryIn(label: string): string | undefined {
  return COUNTRIES.find((c) => c.pattern.test(label))?.name;
}

const yesNo = (b: boolean) => (b ? "Yes" : "No");

export interface ProfileRule {
  path: string;
  pattern: RegExp;
  kinds?: FormField["kind"][];
  resolve: (p: Profile, normalizedLabel: string) => string | undefined;
}

const firstEdu = (p: Profile) => p.education[0]!;

// Ordered: the first rule whose pattern matches the normalized label wins.
export const PROFILE_RULES: ProfileRule[] = [
  { path: "identity.preferredName", pattern: /\bpreferred (first )?name\b/, resolve: (p) => p.identity.preferredName },
  { path: "identity.firstName", pattern: /^(legal )?first name$|^given name$/, resolve: (p) => p.identity.firstName },
  { path: "identity.lastName", pattern: /^(legal )?last name$|^family name$|^surname$/, resolve: (p) => p.identity.lastName },
  { path: "contact.email", pattern: /^e ?mail( address)?$/, resolve: (p) => p.contact.email },
  { path: "contact.phone", pattern: /^(phone|mobile|phone number|mobile number)$/, resolve: (p) => p.contact.phone },
  { path: "contact.address.line1", pattern: /^(street )?address( line 1)?$/, resolve: (p) => p.contact.address.line1 },
  { path: "contact.address.line2", pattern: /^address line 2$|^(apt|apartment|suite|unit)\b/, resolve: (p) => p.contact.address.line2 },
  { path: "contact.address.city", pattern: /^city$/, resolve: (p) => p.contact.address.city },
  { path: "contact.address.state", pattern: /^(state|state province|province)$/, resolve: (p) => p.contact.address.state },
  { path: "contact.address.postalCode", pattern: /^(zip|zip code|postal code|postcode)$/, resolve: (p) => p.contact.address.postalCode },
  { path: "contact.address.country", pattern: /^country( of residence)?$/, resolve: (p) => p.contact.address.country },
  { path: "links.linkedin", pattern: /\blinkedin\b/, resolve: (p) => p.links.linkedin },
  { path: "links.github", pattern: /\bgithub\b/, resolve: (p) => p.links.github },
  { path: "links.website", pattern: /\b(website|portfolio|personal site)\b/, resolve: (p) => p.links.website },
  { path: "education[0].school", pattern: /^(school|university|college)( name)?$/, resolve: (p) => firstEdu(p).school },
  { path: "education[0].degree", pattern: /^degree$/, resolve: (p) => firstEdu(p).degree },
  { path: "education[0].major", pattern: /^(discipline|major|field of study)$/, resolve: (p) => firstEdu(p).major },
  { path: "education[0].gradYear", pattern: /^(end|graduation) year$/, resolve: (p) => String(firstEdu(p).gradYear) },
  {
    path: "workAuthorization.authorizedCountries",
    pattern: /\b(legally authori[sz]ed|authori[sz]ed to work|eligible to work)\b/,
    resolve: (p, label) => {
      const country = countryIn(label);
      return country ? yesNo(p.workAuthorization.authorizedCountries.includes(country)) : undefined;
    },
  },
  {
    path: "citizenship",
    pattern: /\b(citizen of|citizenship)\b/,
    resolve: (p, label) => {
      const country = countryIn(label);
      return country ? yesNo(p.citizenship.includes(country)) : undefined;
    },
  },
  {
    path: "workAuthorization.needsSponsorship",
    pattern: /\b(sponsorship|sponsor)\b/,
    resolve: (p) => yesNo(p.workAuthorization.needsSponsorship),
  },
  { path: "eeo.hispanicLatino", pattern: /\b(hispanic|latino)\b/, resolve: (p) => p.eeo.hispanicLatino },
  { path: "eeo.gender", pattern: /^(gender|sex)$/, resolve: (p) => p.eeo.gender },
  { path: "eeo.race", pattern: /^(race|ethnicity|race ethnicity)$/, resolve: (p) => p.eeo.race },
  { path: "eeo.veteran", pattern: /\bveteran\b/, resolve: (p) => p.eeo.veteran },
  { path: "eeo.disability", pattern: /\bdisability\b/, resolve: (p) => p.eeo.disability },
];

export const RESUME = /\b(resume|cv)\b/;
