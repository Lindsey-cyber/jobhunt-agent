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
        gradMonth: z.number().int().min(1).max(12),
        gradYear: z.number().int().min(1950).max(2100),
        gpa: z.string().optional(),
      }),
    )
    .min(1),
  workAuthorization: z.object({
    authorizedCountries: z.array(z.string().min(1)),
    needsSponsorship: z.boolean(),
  }),
  eeo: z
    .object({
      gender: EeoChoice,
      hispanicLatino: EeoChoice,
      race: EeoChoice,
      veteran: EeoChoice,
      disability: EeoChoice,
    })
    .default({ gender: "decline", hispanicLatino: "decline", race: "decline", veteran: "decline", disability: "decline" }),
  documents: z.object({
    resume: z.string().min(1),
  }),
});
export type Profile = z.infer<typeof Profile>;

export const AnswerEntry = z.object({
  id: z.string().min(1),
  question: z.string().min(1),
  aliases: z.array(z.string()).default([]),
  answer: z.string().min(1),
  company: z.string().optional(),
  origin: z.enum(["human", "generated"]).default("human"),
});
export type AnswerEntry = z.infer<typeof AnswerEntry>;

export const AnswerBank = z.object({ answers: z.array(AnswerEntry).default([]) });
export type AnswerBank = z.infer<typeof AnswerBank>;

export const TrustLevel = z.enum(["draft", "auto"]);
export type TrustLevel = z.infer<typeof TrustLevel>;

export const Config = z.object({
  trust: TrustLevel.default("draft"),
  autoSubmitAts: z.array(z.enum(["greenhouse"])).default([]),
  allowGeneratedAnswers: z.boolean().default(false),
  dailySubmitCap: z.number().int().min(0).default(10),
});
export type Config = z.infer<typeof Config>;
