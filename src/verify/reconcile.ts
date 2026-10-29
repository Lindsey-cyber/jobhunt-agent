// Matches an employer's "thank you for applying" email to an application whose
// confirmation page never showed. Pure: the caller fetches the mail.
export interface MailHeader {
  subject: string;
  sender: string;
  date: string;
}

const RECEIVED = /\b(thanks?( you)? for (applying|your (application|interest))|application (received|submitted|confirmation)|we('ve| have) received your application|your application (to|for|at|with)|you('ve| have) applied)\b/i;
const NOT_RECEIPT = /\b(security code|verify|verification|update on your application|unfortunately|next steps|interview)\b/i;

// The company's own words: "DoorDash USA" -> "doordash"; "Black Canyon Consulting" -> "black canyon".
function names(company: string): string[] {
  const words = company.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").split(/\s+/).filter((w) => w && !/^(inc|llc|usa|us|the|campus|careers|corp|corporation|co)$/.test(w));
  return [...new Set([words.slice(0, 2).join(" "), words[0] ?? ""].filter((x) => x.length >= 3))];
}

export function receiptFor(company: string, submittedAt: string, mail: MailHeader[]): MailHeader | undefined {
  const keys = names(company);
  const since = Date.parse(submittedAt) - 60_000;
  return mail.find((m) => {
    if (Date.parse(m.date) < since || !RECEIVED.test(m.subject) || NOT_RECEIPT.test(m.subject)) return false;
    const where = `${m.subject} ${m.sender}`.toLowerCase().replace(/[^a-z0-9 ]+/g, " ");
    return keys.some((k) => where.includes(k));
  });
}
