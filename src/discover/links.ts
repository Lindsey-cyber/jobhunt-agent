import type { LinkCheck } from "../domain/job.ts";

const CLOSED = /(job|position|posting|role|requisition)[^.<]{0,40}(no longer (available|open|accepting)|has (expired|been filled|closed)|is closed)|page you are looking for (doesn.t|does not) exist|job not found|this job is no longer/i;

// Classifies one fetched job page. A 200 is "valid" only when the page shows no
// closed-posting text and did not bounce to a board index.
export function classifyLink(url: string, res: { status: number; finalUrl: string; body: string }, checkedAt: string): LinkCheck {
  const base = { http: res.status, finalUrl: res.finalUrl, checkedAt };
  if (res.status === 404 || res.status === 410) return { ...base, status: "invalid", note: `HTTP ${res.status}` };
  if ([401, 403, 429, 999].includes(res.status)) return { ...base, status: "blocked", note: `HTTP ${res.status}; site refuses automated reads` };
  if (res.status >= 400) return { ...base, status: "unverified", note: `HTTP ${res.status}` };
  if (/[?&]error=true/.test(res.finalUrl)) return { ...base, status: "invalid", note: "redirected to the board with error=true (posting closed)" };
  const from = new URL(url);
  const to = new URL(res.finalUrl || url);
  if (from.hostname.endsWith("greenhouse.io") && /\/jobs\/\d+/.test(from.pathname) && !/\/jobs\/\d+/.test(to.pathname) && !to.searchParams.get("gh_jid")) {
    return { ...base, status: "invalid", note: "job URL redirected to the board index" };
  }
  const closed = CLOSED.exec(res.body);
  if (closed) return { ...base, status: "invalid", note: `page says: "${closed[0].slice(0, 100)}"` };
  return { ...base, status: "valid", note: res.finalUrl !== url ? "200 after redirect" : "200" };
}
