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

  it("reads Greenhouse's security code from the email text", async () => {
    const { parseSecurityCode } = await import("../src/sources/gmail.ts");
    const body = "Copy and paste this code into the security code field on your application:\n# tL24j2Rn\n\nAfter you enter the code, resubmit your application.";
    expect(parseSecurityCode(body)).toBe("tL24j2Rn");
    expect(parseSecurityCode("Your application was received.")).toBeUndefined();
  });
});

describe("account verification links", () => {
  it("finds a Workday activation link behind Columbia's urldefense wrapper", async () => {
    const { verificationLink } = await import("../src/sources/gmail.ts");
    const html = `<a href="https://urldefense.com/v3/__https://analogdevices.wd1.myworkdayjobs.com/External/activate/abc123/?redirect=*2FExternal*2Fjob*2Fx__;JSUl!!BDUf$">link</a>`;
    expect(verificationLink(html, "analogdevices.wd1.myworkdayjobs.com")).toBe("https://analogdevices.wd1.myworkdayjobs.com/External/activate/abc123/?redirect=/External/job/x");
  });
});
