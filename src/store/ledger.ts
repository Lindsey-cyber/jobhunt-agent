import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import type { ApplicationKey } from "../domain/form.ts";

export type AppState = "planned" | "held" | "verified" | "submitted" | "confirmed" | "unconfirmed";

// A run that dies before "submitted" may simply start over. "submitted" never
// goes back to "planned": an application whose confirmation we could not see is
// "unconfirmed", and only a human resolves it. Retrying it automatically is how
// candidates apply twice.
const NEXT: Record<AppState | "new", readonly AppState[]> = {
  new: ["planned"],
  planned: ["planned", "held", "verified"],
  held: ["planned"],
  verified: ["planned", "held", "submitted"],
  submitted: ["confirmed", "unconfirmed"],
  confirmed: [],
  // A confirmation can arrive later (an email, a finished security-code step);
  // it never sends the application back to planned.
  unconfirmed: ["confirmed"],
};

export interface LedgerEvent {
  key: ApplicationKey;
  state: AppState;
  at: string;
  runDir: string;
  detail?: unknown;
}

export class Ledger {
  private readonly events: LedgerEvent[];

  constructor(private readonly path: string) {
    this.events = existsSync(path)
      ? readFileSync(path, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as LedgerEvent)
      : [];
  }

  state(key: ApplicationKey): AppState | undefined {
    return this.events.findLast((e) => e.key === key)?.state;
  }

  canStart(key: ApplicationKey): boolean {
    return NEXT[this.state(key) ?? "new"].includes("planned");
  }

  submittedOn(day: string): number {
    return this.events.filter((e) => e.state === "submitted" && e.at.startsWith(day)).length;
  }

  history(key: ApplicationKey): LedgerEvent[] {
    return this.events.filter((e) => e.key === key);
  }

  latest(): LedgerEvent[] {
    const byKey = new Map<ApplicationKey, LedgerEvent>();
    for (const e of this.events) byKey.set(e.key, e);
    return [...byKey.values()];
  }

  transition(key: ApplicationKey, to: AppState, runDir: string, detail?: unknown): void {
    const from = this.state(key) ?? "new";
    if (!NEXT[from].includes(to)) throw new Error(`illegal transition ${from} -> ${to} for ${key}`);
    const event: LedgerEvent = { key, state: to, at: new Date().toISOString(), runDir, ...(detail === undefined ? {} : { detail }) };
    mkdirSync(dirname(this.path), { recursive: true });
    appendFileSync(this.path, JSON.stringify(event) + "\n");
    this.events.push(event);
  }
}
