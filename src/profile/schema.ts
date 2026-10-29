import { z } from "zod";

// "decline" maps onto an option like "I don't wish to answer"; "no" onto "No" or
// "I am not a protected veteran"; anything else must match an option's text.
const EeoChoice = z.string().default("decline");

export const Profile = z.object({
  identity: z.object({
    firstName: z.string().min(1),
    lastName: z.string().min(1),
    preferredName: z.string().optional(),
  }),
  contact: z.object({
    email: z.email(),
    phone: z.string().min(7),
    address: z.object({
      line1: z.string().min(1),
      line2: z.string().optional(),
      city: z.string().min(1),
      state: z.string().min(1),
      postalCode: z.string().optional(),
      country: z.string().min(1),
    }),
  }),
  citizenship: z.array(z.string().min(1)).min(1),
  links: z
    .object({
      linkedin: z.url().optional(),
      github: z.url().optional(),
      website: z.url().optional(),
    })
    .default({}),
  education: z
    .array(
      z.object({
        school: z.string().min(1),
        degree: z.string().min(1),
        major: z.string().min(1),
        // YYYY-MM, from the resume.
        start: z.string().regex(/^\d{4}-\d{2}$/).optional(),
        gradMonth: z.number().int().min(1).max(12),
        gradYear: z.number().int().min(1950).max(2100),
        gpa: z.string().optional(),
      }),
    )
    .min(1),
  // The candidate (2026-10-28): bound by no non-compete, non-solicitation or similar agreement.
  restrictiveAgreements: z.boolean().optional(),
  // New-grad cohorts she applies to (2026-10-28: "2027年的也投"), even though she graduated in 2026.
  newGradCohorts: z.array(z.number().int()).default([]),
  // The candidate (2026-10-29): consents to AI resume screening and AI job matching.
  consentAiScreening: z.boolean().optional(),
  // The candidate (2026-10-28): on-site (five days or hybrid) and relocation anywhere in the US.
  workArrangement: z.object({ onsite: z.boolean().optional(), relocate: z.boolean().optional() }).optional(),
  // The candidate (2026-10-28): no relatives at any employer she applies to.
  relativesAtEmployers: z.boolean().optional(),
  // The candidate lets the agent tick "I have read the privacy policy" boxes.
  // Other acknowledgements (interview rules, accuracy certifications) still need her.
  acknowledgePrivacyPolicies: z.boolean().default(false),
  // The candidate lets the agent tick an application's "I accept the Terms and Conditions".
  acceptApplicationTerms: z.boolean().default(false),
  // The candidate (2026-10-29: "都允许") lets the agent agree to an application's
  // accuracy certification, arbitration agreement, interview-conduct rules (AI use)
  // and interview recording or transcription. A typed signature still needs her.
  acceptApplicationAttestations: z.boolean().default(false),
  // The candidate lets the agent type her name and today's date on the voluntary
  // disability self-identification form (CC-305). Nothing else is signed for her.
  signSelfIdentificationForms: z.boolean().default(false),
  // The candidate's own range for "salary expectations" text questions. Current
  // or past pay and range dropdowns still go to her.
  salaryExpectation: z.string().min(1).optional(),
  // Employers from the resume, for "have you worked for X before?" questions.
  workHistory: z.array(z.object({ employer: z.string().min(1), title: z.string().optional(), start: z.string().optional(), end: z.string().optional() })).default([]),
  workAuthorization: z.object({
    authorizedCountries: z.array(z.string().min(1)),
    needsSponsorship: z.boolean(),
  }),
  eeo: z
    .object({
      gender: EeoChoice,
      // Used when a form requires a gender and offers no way to decline.
      genderIfRequired: z.string().optional(),
      hispanicLatino: EeoChoice,
      race: EeoChoice,
      veteran: EeoChoice,
      disability: EeoChoice,
    })
    .default({ gender: "decline", hispanicLatino: "decline", race: "decline", veteran: "decline", disability: "decline" }),
  documents: z.object({
    resume: z.string().min(1),
    // Filled by the loader from data/cover-letters/<company>.pdf: one letter per employer,
    // used only where a form requires a cover letter.
    coverLetters: z.record(z.string(), z.string()).default({}),
  }),
});
export type Profile = z.infer<typeof Profile>;

export const AnswerEntry = z.object({
  id: z.string().min(1),
  question: z.string().min(1),
  aliases: z.array(z.string()).default([]),
  answer: z.string().min(1),
  company: z.string().optional(),
  // A drafted answer is written for one posting and only used there.
  jobTitle: z.string().optional(),
  origin: z.enum(["human", "generated"]).default("human"),
  // Generated answers: the resume and profile passages every fact came from.
  evidence: z.array(z.string()).optional(),
});
export type AnswerEntry = z.infer<typeof AnswerEntry>;

export const AnswerBank = z.object({ answers: z.array(AnswerEntry).default([]) });
export type AnswerBank = z.infer<typeof AnswerBank>;

export const TrustLevel = z.enum(["draft", "auto"]);
export type TrustLevel = z.infer<typeof TrustLevel>;

export const Config = z.object({
  trust: TrustLevel.default("draft"),
  autoSubmitAts: z.array(z.enum(["greenhouse", "lever", "ashby", "workday"])).default([]),
  allowGeneratedAnswers: z.boolean().default(false),
  dailySubmitCap: z.number().int().min(0).default(10),
});
export type Config = z.infer<typeof Config>;

export const SearchPrefs = z.object({ excludeCompanies: z.array(z.string().min(1)).default([]) });
export type SearchPrefs = z.infer<typeof SearchPrefs>;
