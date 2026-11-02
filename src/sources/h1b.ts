// Looks an employer up in the public H-1B LCA disclosures (h1bdata.info, read-only).
// One query per year: the site's "All Years" view returns only its oldest year (seen 2026-11-02).
import { filerName, parseH1bTable, recordFrom, SINCE_YEAR, type H1bFiling, type H1bRecord } from "../discover/h1b.ts";
import { getText } from "./http.ts";

export async function lookupH1b(company: string, checkedAt: string): Promise<H1bRecord> {
  // Query the bare name ("DoorDash USA" files as "DOORDASH INC").
  const q = encodeURIComponent(filerName(company) || company.trim()).replace(/%20/g, "+");
  const filings: H1bFiling[] = [];
  for (let year = Number(checkedAt.slice(0, 4)); year >= SINCE_YEAR; year--) {
    const html = await getText(`https://h1bdata.info/index.php?em=${q}&job=&city=&year=${year}`, 60000);
    // A throttled or error page has no results table: that is a failed lookup, not "no filings".
    if (!/<th>EMPLOYER<\/th>/i.test(html) && !/no results|0 results/i.test(html)) throw new Error(`no results table for ${company} ${year}`);
    filings.push(...parseH1bTable(html));
    const r = recordFrom(company, filings, checkedAt);
    if (r.filings > 0) return r;
  }
  return recordFrom(company, filings, checkedAt);
}
