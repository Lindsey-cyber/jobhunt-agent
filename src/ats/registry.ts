import type { Page } from "playwright";
import type { AtsAdapter } from "./adapter.ts";
import { ashby } from "./ashby/adapter.ts";
import { greenhouse } from "./greenhouse/adapter.ts";
import { lever } from "./lever/adapter.ts";

export const ADAPTERS: AtsAdapter[] = [greenhouse, lever, ashby];

export async function adapterFor(page: Page): Promise<AtsAdapter | undefined> {
  for (const a of ADAPTERS) if (await a.detect(page)) return a;
  return undefined;
}
