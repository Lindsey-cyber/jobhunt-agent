// Trust per pipeline stage. "confirm" sends the stage's output to the
// candidate's review list; "auto" lets it flow on. A failed audit demotes
// automatically; promotion is only ever proposed, and the candidate decides. Pure.
import type { AuditScore } from "./audit.ts";

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

export const THRESHOLDS = { demoteAbove: 0.1, promoteAtMost: 0.05, minJudged: 15, cleanAuditsToPromote: 3 } as const;

export function initialStage(at: string): StageState {
  return { level: "confirm", since: at, reason: "every stage starts at confirm", audits: [] };
}

const failing = (a: AuditRecord) =>
  (a.matchJudged >= THRESHOLDS.minJudged && (a.falseMatchRate ?? 0) > THRESHOLDS.demoteAbove) ||
  (a.rejectJudged >= THRESHOLDS.minJudged && (a.missRate ?? 0) > THRESHOLDS.demoteAbove);

const clean = (a: AuditRecord) =>
  a.matchJudged >= THRESHOLDS.minJudged && a.rejectJudged >= THRESHOLDS.minJudged && (a.falseMatchRate ?? 1) <= THRESHOLDS.promoteAtMost && (a.missRate ?? 1) <= THRESHOLDS.promoteAtMost;

export function recordAudit(state: StageState, score: AuditScore, at: string): { state: StageState; demoted: boolean; promotable: boolean } {
  const rec: AuditRecord = { at, falseMatchRate: score.falseMatchRate, missRate: score.missRate, matchJudged: score.matchJudged, rejectJudged: score.rejectJudged };
  const audits = [...state.audits, rec];
  if (failing(rec)) {
    const pct = (x: number | null) => (x == null ? "n/a" : `${(x * 100).toFixed(1)}%`);
    const demoted = state.level === "auto";
    return {
      state: { level: "confirm", since: demoted ? at : state.since, reason: `audit ${at}: false-match ${pct(rec.falseMatchRate)}, miss ${pct(rec.missRate)} (limit ${THRESHOLDS.demoteAbove * 100}%)`, audits },
      demoted,
      promotable: false,
    };
  }
  const last = audits.slice(-THRESHOLDS.cleanAuditsToPromote);
  const promotable = state.level === "confirm" && last.length === THRESHOLDS.cleanAuditsToPromote && last.every(clean);
  return { state: { ...state, audits }, demoted: false, promotable };
}
