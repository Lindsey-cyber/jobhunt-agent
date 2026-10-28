import type { Page } from "playwright";
import type { AtsAdapter } from "./adapter.ts";
import { greenhouse } from "./greenhouse/adapter.ts";

export const ADAPTERS: AtsAdapter[] = [greenhouse];

export async function adapterFor(page: Page): Promise<AtsAdapter | undefined> {
  for (const a of ADAPTERS) if (await a.detect(page)) return a;
  return undefined;
}
