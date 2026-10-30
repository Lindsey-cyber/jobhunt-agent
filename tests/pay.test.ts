import { describe, expect, it } from "vitest";
import { expectationFloor, payBelowExpectation, payRanges } from "../src/discover/pay.ts";

describe("pay ranges", () => {
  it("reads annual, K and hourly ranges", () => {
    expect(payRanges("The base pay range is $60,000 - $100,000 per year.")).toEqual([{ min: 60000, max: 100000 }]);
    expect(payRanges("Salary: $60K–$100K")).toEqual([{ min: 60000, max: 100000 }]);
    expect(payRanges("$60-100K DOE")).toEqual([{ min: 60000, max: 100000 }]);
    expect(payRanges("$28.50 - $45.00 per hour")).toEqual([{ min: 59280, max: 93600 }]);
    expect(payRanges("We have 50-100 employees and $5 lunches")).toEqual([]);
  });

  it("skips only postings that top out at or below her floor", () => {
    const floor = expectationFloor("$100K–$150K");
    expect(floor).toBe(100000);
    expect(payBelowExpectation("Pay: $60,000 - $100,000", floor)).toBe(true);
    expect(payBelowExpectation("Pay: $90,000 - $130,000", floor)).toBe(false);
    expect(payBelowExpectation("NY: $70K-$95K; SF: $85K-$120K", floor)).toBe(false);
    expect(payBelowExpectation("$25 - $40 per hour", floor)).toBe(true);
    expect(payBelowExpectation("Competitive pay", floor)).toBe(false);
  });
});
