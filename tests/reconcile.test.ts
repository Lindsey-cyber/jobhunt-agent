import { describe, expect, it } from "vitest";
import { receiptFor } from "../src/verify/reconcile.ts";

describe("receipt emails", () => {
  const at = "2026-10-29T09:20:00Z";
  it("matches the employer's thank-you after the submit, and nothing else", () => {
    const mail = [
      { subject: "Security code for your application to Asana", sender: "no-reply@us.greenhouse-mail.io", date: "2026-10-29T09:20:30Z" },
      { subject: "Thank you for your application to Asana!", sender: "no-reply@asana.com", date: "2026-10-29T09:21:00Z" },
      { subject: "Thank you for applying to Tubi!", sender: "no-reply@us.greenhouse-mail.io", date: "2026-10-29T09:22:00Z" },
    ];
    expect(receiptFor("Asana", at, mail)?.subject).toBe("Thank you for your application to Asana!");
    expect(receiptFor("Klaviyo Campus", at, mail)).toBeUndefined();
    expect(receiptFor("Asana", "2026-10-29T10:00:00Z", mail)).toBeUndefined();
    expect(receiptFor("DoorDash USA", at, [{ subject: "Thanks for applying to DoorDash", sender: "x@doordash.com", date: "2026-10-29T09:30:00Z" }])).toBeDefined();
  });
});
