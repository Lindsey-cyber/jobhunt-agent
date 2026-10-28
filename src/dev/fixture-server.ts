import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export interface Submission {
  path: string;
  body: Record<string, string>;
}

export interface FixtureServer {
  origin: string;
  submissions: Submission[];
  close(): Promise<void>;
}

const ROOT = join(import.meta.dirname, "../../fixtures");

// Serves fixtures/<ats>/<name>.html at /<board>/jobs/<name> and records every
// submission, so a test can check the side effect and not just the screen.
export function startFixtureServer(port = 0): Promise<FixtureServer> {
  const submissions: Submission[] = [];
  const server = createServer((req, res) => {
    const path = new URL(req.url ?? "/", "http://x").pathname;
    const send = (status: number, type: string, body: string) => res.writeHead(status, { "content-type": type }).end(body);
    try {
      if (path === "/static/widget.js") return send(200, "text/javascript", readFileSync(join(ROOT, "greenhouse/widget.js"), "utf8"));
      if (path === "/__submissions") return send(200, "application/json", JSON.stringify(submissions));
      // Lever captures: /lever/<case>/apply serves fixtures/lever/<case>.html.
      const lv = /^\/lever\/([\w-]+)\/apply$/.exec(path);
      if (lv) return send(200, "text/html", readFileSync(join(ROOT, "lever", `${lv[1]}.html`), "utf8"));
      const m = /^\/[\w-]+\/jobs\/([\w-]+)(\/submit|\/confirmation)?$/.exec(path);
      if (!m) return send(404, "text/plain", "not found");
      const [, name, tail] = m;
      if (tail === "/submit" && req.method === "POST") {
        let raw = "";
        req.on("data", (c: Buffer) => (raw += c.toString()));
        req.on("end", () => {
          submissions.push({ path, body: JSON.parse(raw) as Record<string, string> });
          send(200, "application/json", "{}");
        });
        return;
      }
      const file = tail === "/confirmation" ? "confirmation" : name!;
      return send(200, "text/html", readFileSync(join(ROOT, "greenhouse", `${file}.html`), "utf8"));
    } catch {
      return send(404, "text/plain", "not found");
    }
  });
  return new Promise((resolve) =>
    server.listen(port, "127.0.0.1", () => {
      const { port: p } = server.address() as AddressInfo;
      resolve({ origin: `http://127.0.0.1:${p}`, submissions, close: () => new Promise((r) => server.close(() => r())) });
    }),
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const s = await startFixtureServer(Number(process.env.PORT ?? 4173));
  console.log(`fixtures at ${s.origin}/acmerobotics/jobs/basic  (submissions: ${s.origin}/__submissions)`);
}
