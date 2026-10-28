import type { Page } from "playwright";
import type { AtsName, FormField, FormSnapshot } from "../domain/form.ts";
import type { Readback } from "../verify/compare.ts";

export interface Confirmation {
  text: string;
  url: string;
}

export interface AtsAdapter {
  name: AtsName;
  detect(page: Page): Promise<boolean>;
  extract(page: Page): Promise<FormSnapshot>;
  fill(page: Page, field: FormField, value: string): Promise<void>;
  readback(page: Page, fields: FormField[]): Promise<Readback>;
  submit(page: Page): Promise<void>;
  confirmation(page: Page, timeoutMs: number): Promise<Confirmation | null>;
}
