// Employer-site accounts (Workday creates one per employer). The candidate
// allowed the agent to create them. No password is stored: each is derived from
// JH_ACCOUNT_SECRET and the site's host, so the VPS and a cloud session that
// share the secret sign in to the same accounts, and nothing secret is in git.
import { createHmac } from "node:crypto";
import type { Account } from "../ats/adapter.ts";

export function accountFor(host: string, email: string, secret = process.env.JH_ACCOUNT_SECRET): Account {
  if (!secret || secret.length < 16) throw new Error("JH_ACCOUNT_SECRET (16+ characters) is not set; it derives employer-site passwords");
  const body = createHmac("sha256", secret).update(host.toLowerCase()).digest("base64url").slice(0, 16);
  // Workday's rules: upper, lower, digit, special, 8+ characters.
  return { email, password: `${body}Aa1!` };
}
