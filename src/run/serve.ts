// Serves the latest report on 127.0.0.1 only. On the VPS it is reached through
// an SSH tunnel (ssh -L 8787:127.0.0.1:8787 ...), never exposed publicly.
import { existsSync, readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { basename, join } from "node:path";
import { ReviewList } from "../store/review.ts";
import { paths, readLatest } from "../store/state.ts";

const TYPES: Record<string, string> = { html: "text/html; charset=utf-8", csv: "text/csv; charset=utf-8", json: "application/json", md: "text/plain; charset=utf-8" };

export function serve(dataDir: string, port = 8787): Server {
  const server = createServer((req, res) => {
    const latest = readLatest(dataDir);
    const send = (status: number, type: string, body: string) => {
      res.writeHead(status, { "content-type": type, "cache-control": "no-store" });
      res.end(body);
    };
    if (!latest) return send(404, TYPES.md!, "No discovery run yet. Run jh daily.");
    const path = new URL(req.url ?? "/", "http://localhost").pathname;
    if (path === "/") return send(200, TYPES.html!, `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">${readFileSync(join(latest.reportDir, "dashboard.html"), "utf8")}`);
    if (path === "/pending") {
      const items = new ReviewList(paths(dataDir).review).open();
      return send(200, TYPES.md!, items.map((i) => `[${i.kind}] ${i.id}\n  ${i.subject}\n  ${i.detail}${i.link ? `\n  ${i.link}` : ""}`).join("\n\n") || "Nothing waiting.");
    }
    // Files of the latest report by bare name: /REPORT.md, /matches.csv ...
    const name = basename(path);
    const file = join(latest.reportDir, name);
    const ext = name.split(".").pop() ?? "";
    if (path === `/${name}` && TYPES[ext] && existsSync(file)) return send(200, TYPES[ext]!, readFileSync(file, "utf8"));
    send(404, TYPES.md!, "Not found. Try /, /pending, /REPORT.md or /matches.csv.");
  });
  server.listen(port, "127.0.0.1");
  return server;
}
