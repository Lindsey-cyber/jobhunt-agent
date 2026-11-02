// Trust per pipeline stage. "confirm" sends the stage's output to the
// candidate's review list; "auto" lets it flow on. Promotion is the candidate's
// decision alone. Pure.

export type StageLevel = "confirm" | "auto";
export type Stage = "triage" | "apply" | "outreach";

export interface AuditRecord {
  at: string;
  falseMatchRate: number | null;
  missRate: number | null;
  matchJudged: number;
  rejectJudged: number;
}

export interface StageState {
  level: StageLevel;
  since: string;
  reason: string;
  audits: AuditRecord[];
}

export function initialStage(at: string): StageState {
  return { level: "confirm", since: at, reason: "every stage starts at confirm", audits: [] };
}
