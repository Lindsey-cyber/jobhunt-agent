import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";

// The daily review list. Anything the agent cannot resolve lands here instead of
// blocking a run; the candidate reads it with `jh pending` at the end of the day.
// Append-only: the last line for an id is its current state.
export type ReviewKind = "submit_by_hand" | "approve_match" | "source_failure" | "question" | "audit_disagreement" | "outreach_draft" | "trust_change";

export interface ReviewItem {
  id: string;
  at: string;
  kind: ReviewKind;
  subject: string;
  detail: string;
  link?: string;
  status: "open" | "resolved";
  resolution?: string;
}

export class ReviewList {
  private readonly items = new Map<string, ReviewItem>();

  constructor(private readonly path: string) {
    if (existsSync(path)) for (const l of readFileSync(path, "utf8").split("\n").filter(Boolean)) {
      const item = JSON.parse(l) as ReviewItem;
      this.items.set(item.id, item);
    }
  }

  open(): ReviewItem[] {
    return [...this.items.values()].filter((i) => i.status === "open");
  }

  get(id: string): ReviewItem | undefined {
    return this.items.get(id);
  }

  // Adds an item unless one with this id already exists, so a daily run never
  // re-asks a question the candidate answered. Items the agent withdrew itself
  // (over the daily cap, no longer matching) may come back.
  add(item: Omit<ReviewItem, "at" | "status">): boolean {
    const was = this.items.get(item.id);
    if (was && !(was.status === "resolved" && was.resolution?.startsWith("withdrawn"))) return false;
    this.write({ ...item, at: new Date().toISOString(), status: "open" });
    return true;
  }

  // Replaces an open item's text, e.g. a source that is still failing.
  refresh(item: Omit<ReviewItem, "at" | "status">): void {
    const was = this.items.get(item.id);
    if (was?.status === "resolved") return;
    this.write({ ...item, at: new Date().toISOString(), status: "open" });
  }

  resolve(id: string, resolution: string): void {
    const was = this.items.get(id);
    if (!was) throw new Error(`no review item ${id}`);
    this.write({ ...was, at: new Date().toISOString(), status: "resolved", resolution });
  }

  private write(item: ReviewItem): void {
    mkdirSync(dirname(this.path), { recursive: true });
    appendFileSync(this.path, JSON.stringify(item) + "\n");
    this.items.set(item.id, item);
  }
}
