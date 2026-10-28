// The only network client discovery uses. Read-only GETs and the Workday search
// POST; bounded retries with backoff; a polite user agent.
const UA = "jobhunt-agent/2 (personal job search; read-only)";

export class HttpError extends Error {
  constructor(readonly status: number, url: string) {
    super(`HTTP ${status} for ${url}`);
  }
}

async function request(url: string, init: RequestInit = {}, timeoutMs = 45000, tries = 3): Promise<Response> {
  let last: unknown;
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, { ...init, headers: { "user-agent": UA, accept: "application/json, text/plain, */*", ...init.headers }, signal: AbortSignal.timeout(timeoutMs) });
      if (res.status === 429 || res.status >= 500) throw new HttpError(res.status, url);
      return res;
    } catch (e) {
      last = e;
      if (e instanceof HttpError && e.status < 500 && e.status !== 429) throw e;
      await new Promise((r) => setTimeout(r, 1500 * 2 ** i));
    }
  }
  throw last;
}

export async function getJson<T>(url: string, timeoutMs?: number): Promise<T> {
  const res = await request(url, {}, timeoutMs);
  if (!res.ok) throw new HttpError(res.status, url);
  return (await res.json()) as T;
}

export async function getText(url: string, timeoutMs?: number): Promise<string> {
  const res = await request(url, {}, timeoutMs);
  if (!res.ok) throw new HttpError(res.status, url);
  return res.text();
}

export async function postJson<T>(url: string, body: unknown, timeoutMs?: number): Promise<T> {
  const res = await request(url, { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } }, timeoutMs);
  if (!res.ok) throw new HttpError(res.status, url);
  return (await res.json()) as T;
}

// Status of a job page without downloading it all: used by the link check.
export async function probe(url: string): Promise<{ status: number; finalUrl: string; body: string }> {
  const res = await request(url, { redirect: "follow", headers: { accept: "text/html,application/json" } }, 30000, 2);
  const body = (await res.text()).slice(0, 400_000);
  return { status: res.status, finalUrl: res.url, body };
}

export async function pool<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]!);
      }
    }),
  );
  return out;
}
