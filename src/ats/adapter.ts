import type { Page } from "playwright";
import type { AtsName, FormField, FormSnapshot } from "../domain/form.ts";
import type { Readback } from "../verify/compare.ts";

export interface Confirmation {
  text: string;
  url: string;
}

// What a submit may need from outside the page, e.g. a code the ATS emailed.
export interface SubmitHelpers {
  emailCode?(company: string, since: Date): Promise<string | undefined>;
  // A link the ATS emailed (account verification), newest after `since`, on `host`.
  emailLink?(host: string, since: Date, timeoutMs?: number): Promise<string | undefined>;
}

// What a sign-in step needs: the candidate's email and this site's password.
export interface Account {
  email: string;
  password: string;
}

export interface AtsAdapter {
  name: AtsName;
  detect(page: Page): Promise<boolean>;
  extract(page: Page): Promise<FormSnapshot>;
  fill(page: Page, field: FormField, value: string): Promise<void>;
  readback(page: Page, fields: FormField[]): Promise<Readback>;
  // Reasons this page must not be submitted by the agent at all (a captcha on
  // submit, a login wall). Every one becomes a hold that --approve cannot lift.
  blockers?(page: Page): Promise<string[]>;
  // Multi-page applications (Workday): get from the posting to the first form
  // page (create the account or sign in), then move page by page. advance()
  // saves the current page and returns "review" once the final page is reached;
  // submit() then submits from there.
  prepare?(page: Page, account: Account, helpers: SubmitHelpers): Promise<void>;
  advance?(page: Page): Promise<"next" | "review">;
  submit(page: Page, helpers?: SubmitHelpers, company?: string): Promise<void>;
  confirmation(page: Page, timeoutMs: number): Promise<Confirmation | null>;
}
