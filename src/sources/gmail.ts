// Gmail API, read-only. Replaces copying alert emails through the session's
// connector: messages are saved by code, byte for byte. Credentials never live
// in the repo: the OAuth client file and the refresh token sit in
// ~/.config/jobhunt/ (or the paths in GMAIL_CLIENT_FILE / GMAIL_TOKEN_FILE).
import { createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { AlertMessage } from "../discover/parse.ts";
import { pool } from "./http.ts";

const SCOPE = "https://www.googleapis.com/auth/gmail.readonly";
const API = "https://gmail.googleapis.com/gmail/v1/users/me";
const REDIRECT = "http://localhost:8765";
const conf = (f: string) => join(homedir(), ".config", "jobhunt", f);
const clientFile = () => process.env.GMAIL_CLIENT_FILE ?? conf("gmail-client.json");
const tokenFile = () => process.env.GMAIL_TOKEN_FILE ?? conf("gmail-token.json");
const pendingFile = () => conf("gmail-auth-pending.json");

export const ALERT_QUERY = "newer_than:30d (from:linkedin.com OR from:indeed.com OR from:glassdoor.com OR from:joinhandshake.com)";

function client(): { client_id: string; client_secret: string } {
  if (!existsSync(clientFile())) throw new Error(`no Gmail OAuth client at ${clientFile()}; download the Desktop client JSON from Google Cloud there`);
  const j = JSON.parse(readFileSync(clientFile(), "utf8")) as Record<string, { client_id: string; client_secret: string }>;
  const c = j.installed ?? j.web;
  if (!c) throw new Error(`${clientFile()} is not an OAuth client file`);
  return c;
}

function writePrivate(path: string, data: unknown): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  writeFileSync(path, JSON.stringify(data, null, 2), { mode: 0o600 });
}

export const gmailConfigured = () => existsSync(clientFile()) && existsSync(tokenFile());

// Step 1: a consent URL. Google redirects the browser to localhost with a code;
// the page will not load, and the candidate pastes that address into step 2.
export function authUrl(): string {
  const verifier = randomBytes(32).toString("base64url");
  const state = randomBytes(12).toString("base64url");
  writePrivate(pendingFile(), { verifier, state });
  const u = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  u.search = new URLSearchParams({
    client_id: client().client_id,
    redirect_uri: REDIRECT,
    response_type: "code",
    scope: SCOPE,
    access_type: "offline",
    prompt: "consent",
    state,
    code_challenge: createHash("sha256").update(verifier).digest("base64url"),
    code_challenge_method: "S256",
  }).toString();
  return u.toString();
}

// Step 2: exchange the code from the pasted redirect address for a refresh token.
export async function finishAuth(redirected: string): Promise<string> {
  const pending = JSON.parse(readFileSync(pendingFile(), "utf8")) as { verifier: string; state: string };
  const u = new URL(redirected.trim());
  if (u.searchParams.get("state") !== pending.state) throw new Error("this address is from a different consent attempt; run jh gmail auth again");
  const code = u.searchParams.get("code");
  if (!code) throw new Error(`no code in the address (${u.searchParams.get("error") ?? "unknown error"})`);
  const c = client();
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ code, client_id: c.client_id, client_secret: c.client_secret, redirect_uri: REDIRECT, grant_type: "authorization_code", code_verifier: pending.verifier }),
  });
  const body = (await res.json()) as { refresh_token?: string; scope?: string; error?: string; error_description?: string };
  if (!res.ok || !body.refresh_token) throw new Error(`token exchange failed: ${body.error ?? res.status}${body.error_description ? ` (${body.error_description})` : ""}`);
  if (body.scope !== SCOPE) throw new Error(`unexpected scope granted: ${body.scope}`);
  writePrivate(tokenFile(), { refresh_token: body.refresh_token, scope: body.scope, created: new Date().toISOString() });
  writePrivate(pendingFile(), {});
  return tokenFile();
}

async function accessToken(): Promise<string> {
  const c = client();
  const { refresh_token } = JSON.parse(readFileSync(tokenFile(), "utf8")) as { refresh_token: string };
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: c.client_id, client_secret: c.client_secret, refresh_token, grant_type: "refresh_token" }),
  });
  const body = (await res.json()) as { access_token?: string; error_description?: string };
  if (!body.access_token) throw new Error(`Gmail token refresh failed: ${body.error_description ?? res.status}; run jh gmail auth again`);
  return body.access_token;
}

export interface GmailPart { mimeType?: string; body?: { data?: string }; parts?: GmailPart[]; headers?: { name: string; value: string }[] }
export interface GmailMessage { id: string; threadId: string; internalDate?: string; payload?: GmailPart }

// The parts a parser needs: the plain-text alternative and the HTML one.
export function bodies(p: GmailPart | undefined, out: { text: string; html: string } = { text: "", html: "" }) {
  if (!p) return out;
  const data = p.body?.data ? Buffer.from(p.body.data, "base64url").toString("utf8") : "";
  if (p.mimeType === "text/plain" && !out.text) out.text = data;
  if (p.mimeType === "text/html" && !out.html) out.html = data;
  for (const c of p.parts ?? []) bodies(c, out);
  return out;
}

export function toAlert(m: GmailMessage): AlertMessage {
  const h = (n: string) => m.payload?.headers?.find((x) => x.name.toLowerCase() === n)?.value ?? "";
  const { text, html } = bodies(m.payload);
  return {
    id: m.id,
    date: m.internalDate ? new Date(Number(m.internalDate)).toISOString() : h("date"),
    sender: h("from"),
    subject: h("subject"),
    viewUrl: `https://mail.google.com/mail/#all/${m.threadId}`,
    body: text,
    html,
  };
}

// Saves every matching message as an AlertMessage file plus the raw API JSON.
// Read-only: the scope cannot modify, label or send mail.
export async function fetchAlerts(dir: string, query = ALERT_QUERY): Promise<{ saved: number }> {
  const token = await accessToken();
  const get = async <T>(url: string): Promise<T> => {
    const res = await fetch(url, { headers: { authorization: `Bearer ${token}` } });
    if (!res.ok) throw new Error(`Gmail API ${res.status} for ${url.split("?")[0]}`);
    return (await res.json()) as T;
  };
  const ids: string[] = [];
  let pageToken = "";
  do {
    const q = new URLSearchParams({ q: query, maxResults: "100", ...(pageToken ? { pageToken } : {}) });
    const page = await get<{ messages?: { id: string }[]; nextPageToken?: string }>(`${API}/messages?${q}`);
    ids.push(...(page.messages ?? []).map((m) => m.id));
    pageToken = page.nextPageToken ?? "";
  } while (pageToken);
  mkdirSync(join(dir, "raw"), { recursive: true });
  await pool(ids, 6, async (id) => {
    const m = await get<GmailMessage>(`${API}/messages/${id}?format=full`);
    writeFileSync(join(dir, "raw", `${id}.json`), JSON.stringify(m));
    writeFileSync(join(dir, `${id}.json`), JSON.stringify(toAlert(m)));
  });
  return { saved: ids.length };
}

// Greenhouse emails an 8-character code before it accepts some applications:
// "Copy and paste this code into the security code field on your application: tL24j2Rn".
export function parseSecurityCode(text: string): string | undefined {
  return /security code field on your application:\s*#?\s*([A-Za-z0-9]{6,10})\b/i.exec(text)?.[1];
}

// Polls for the newest security-code email for this company that arrived
// after `since` (the click that asked for it). Read-only.
export async function waitForSecurityCode(company: string, since: Date, timeoutMs = 180_000): Promise<string | undefined> {
  const deadline = Date.now() + timeoutMs;
  const q = new URLSearchParams({ q: `subject:"Security code for your application" newer_than:1d`, maxResults: "10" });
  while (Date.now() < deadline) {
    const token = await accessToken();
    const get = async <T>(url: string) => (await (await fetch(url, { headers: { authorization: `Bearer ${token}` } })).json()) as T;
    const list = await get<{ messages?: { id: string }[] }>(`${API}/messages?${q}`);
    for (const { id } of list.messages ?? []) {
      const m = await get<GmailMessage>(`${API}/messages/${id}?format=full`);
      const a = toAlert(m);
      if (Date.parse(a.date) < since.getTime() - 5000) continue;
      if (company && !a.subject.toLowerCase().includes(company.toLowerCase())) continue;
      const code = parseSecurityCode(a.body || a.html || "");
      if (code) return code;
    }
    await new Promise((r) => setTimeout(r, 5000));
  }
  return undefined;
}
