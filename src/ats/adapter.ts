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
  submit(page: Page, helpers?: SubmitHelpers, company?: string): Promise<void>;
  confirmation(page: Page, timeoutMs: number): Promise<Confirmation | null>;
}
