// Looks an employer up in the public H-1B LCA disclosures (h1bdata.info, read-only).
import { parseH1bTable, recordFrom, type H1bRecord } from "../discover/h1b.ts";
import { getText } from "./http.ts";

export async function lookupH1b(company: string, checkedAt: string): Promise<H1bRecord> {
  const q = encodeURIComponent(company.trim()).replace(/%20/g, "+");
  const html = await getText(`https://h1bdata.info/index.php?em=${q}&job=&city=&year=All+Years`, 60000);
  return recordFrom(company, parseH1bTable(html), checkedAt);
}
