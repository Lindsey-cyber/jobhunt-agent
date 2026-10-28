import type { JobKey } from "../domain/job.ts";

const TRACKING = /^(utm_.*|ref|refid|source|src|gh_src|lever-source.*|trk.*|trackingid|embed|mode)$/i;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Unwraps link-protection wrappers (Proofpoint URL Defense) to the destination.
export function unwrap(url: string): string {
  const m = /^https?:\/\/urldefense(?:\.proofpoint)?\.com\/v3\/__(.+?)(?:__;.*)?$/.exec(url);
  return m ? m[1]!.replace(/\*/g, "%") : url;
}

export function canonicalUrl(raw: string): string {
  const u = new URL(unwrap(raw.trim()));
  u.hash = "";
  u.hostname = u.hostname.toLowerCase();
  for (const k of [...u.searchParams.keys()]) if (TRACKING.test(k)) u.searchParams.delete(k);
  u.pathname = u.pathname.replace(/\/+$/, "") || "/";
  return u.toString();
}

// The strongest identity a URL proves. ATS job ids are global within their ATS
// (Greenhouse ids are numeric database ids, Lever and Ashby ids are UUIDs), so a
// gh_jid on an employer's own domain is the same posting as the hosted board.
// Anything else keys on the canonical URL and merges only with that same URL.
export function jobKey(raw: string): JobKey {
  let u: URL;
  try {
    u = new URL(unwrap(raw.trim()));
  } catch {
    return `raw:${raw.trim()}` as JobKey;
  }
  const host = u.hostname.toLowerCase();
  const parts = u.pathname.split("/").filter(Boolean).map(decodeURIComponent);
  const q = (k: string) => u.searchParams.get(k);
  const key = (s: string) => s as JobKey;

  const ghj = q("gh_jid");
  if (ghj && /^\d+$/.test(ghj)) return key(`greenhouse:${ghj}`);
  if (host.endsWith("greenhouse.io")) {
    const i = parts.indexOf("jobs");
    if (i >= 0 && /^\d+$/.test(parts[i + 1] ?? "")) return key(`greenhouse:${parts[i + 1]}`);
    const token = q("token");
    if (token && /^\d+$/.test(token)) return key(`greenhouse:${token}`);
  }
  if (host === "jobs.lever.co" || host === "jobs.eu.lever.co") {
    if (UUID.test(parts[1] ?? "")) return key(`lever:${parts[1]!.toLowerCase()}`);
  }
  if (host === "jobs.ashbyhq.com") {
    if (UUID.test(parts[1] ?? "")) return key(`ashby:${parts[1]!.toLowerCase()}`);
  }
  if (host.endsWith(".myworkdayjobs.com")) {
    const last = parts.at(-1) ?? "";
    const m = /_([A-Za-z]*-?\d[\w-]*)$/.exec(last);
    if (parts.includes("job") && m) return key(`workday:${host.split(".")[0]}:${m[1]!.toLowerCase()}`);
  }
  if (host === "jobs.smartrecruiters.com" && /^\d+/.test(parts[1] ?? "")) {
    return key(`smartrecruiters:${parts[1]!.split("-")[0]}`);
  }
  if (host.endsWith("linkedin.com")) {
    const i = parts.indexOf("view");
    const m = /(\d{6,})$/.exec(parts[i + 1] ?? "") ?? /^(\d{6,})$/.exec(q("currentJobId") ?? "");
    if (m) return key(`linkedin:${m[1]}`);
  }
  if (host.endsWith("joinhandshake.com")) {
    const i = parts.indexOf("jobs");
    if (/^\d+$/.test(parts[i + 1] ?? "")) return key(`handshake:${parts[i + 1]}`);
  }
  if (host.endsWith("glassdoor.com") && q("jobListingId")) return key(`glassdoor:${q("jobListingId")}`);
  if (host.endsWith("indeed.com") && q("jk")) return key(`indeed:${q("jk")}`);
  if (host === "lifeattiktok.com" || host === "careers.tiktok.com") {
    const id = parts.find((p) => /^\d{10,}$/.test(p));
    if (id) return key(`tiktok:${id}`);
  }
  return key(`url:${canonicalUrl(u.toString())}`);
}

// The ATS a key belongs to, or undefined for a plain URL key.
export function atsOf(key: JobKey): string | undefined {
  const head = key.split(":")[0]!;
  return head === "url" || head === "raw" ? undefined : head;
}
