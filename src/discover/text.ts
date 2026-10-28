const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", rsquo: "’", lsquo: "‘", ldquo: "“", rdquo: "”", ndash: "–", mdash: "—", hellip: "…" };

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (all, e: string) => {
    if (e[0] === "#") {
      const n = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : all;
    }
    return ENTITIES[e.toLowerCase()] ?? all;
  });
}

// Greenhouse sends its content HTML-escaped once more; decode until stable.
export function htmlToText(html: string): string {
  let s = html ?? "";
  for (let i = 0; i < 2 && /&lt;|&gt;/.test(s); i++) s = decodeEntities(s);
  return decodeEntities(
    s
      .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
      .replace(/<(br|\/p|\/div|\/li|\/h\d|\/tr)\b[^>]*>/gi, "\n")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/[ \t ]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .trim();
}

export function hrefs(html: string): string[] {
  const out = [...html.matchAll(/href\s*=\s*"([^"]+)"/gi)].map((m) => decodeEntities(m[1]!));
  out.push(...[...html.matchAll(/\]\((https?:\/\/[^\s)]+)\)/g)].map((m) => m[1]!));
  return [...new Set(out.filter((u) => /^https?:\/\//.test(u)))];
}
