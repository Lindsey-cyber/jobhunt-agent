import { describe, expect, it } from "vitest";
import { toAlert } from "../src/sources/gmail.ts";

const b64 = (s: string) => Buffer.from(s).toString("base64url");

describe("Gmail API messages", () => {
  it("keeps the plain-text and HTML alternatives and the headers the parsers read", () => {
    const a = toAlert({
      id: "m1",
      threadId: "t1",
      internalDate: "1793154240000",
      payload: {
        mimeType: "multipart/alternative",
        headers: [{ name: "From", value: "LinkedIn Job Alerts <jobalerts-noreply@linkedin.com>" }, { name: "Subject", value: "Kargo ML Engineer" }],
        parts: [
          { mimeType: "text/plain", body: { data: b64("Machine Learning Engineer\nKargo\nNew York, NY\nView job: https://www.linkedin.com/comm/jobs/view/4483753691/") } },
          { mimeType: "text/html", body: { data: b64("<a href=\"https://x\">job</a>") } },
        ],
      },
    });
    expect(a).toMatchObject({ id: "m1", sender: "LinkedIn Job Alerts <jobalerts-noreply@linkedin.com>", subject: "Kargo ML Engineer", date: "2026-10-28T02:24:00.000Z", html: '<a href="https://x">job</a>' });
    expect(a.body).toContain("View job:");
  });
});
