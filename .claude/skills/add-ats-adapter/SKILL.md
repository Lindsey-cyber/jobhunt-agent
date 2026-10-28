---
name: add-ats-adapter
description: Add or fix an ATS adapter in jobhunt-agent from a captured page, with a fixture test proving it. Use when a new ATS appears (Lever, Ashby, Workday, iCIMS...) or when an apply run held on a readback mismatch or fill error.
---

# Add or fix an ATS adapter

## Steps

1. **Capture first.** Save the live form with Playwright (`await page.content()`) after it has rendered. Scrub names, emails, phones and tokens. Put it in `fixtures/<ats>/<case>.html` and record its origin in `fixtures/<ats>/README.md`. A synthetic fixture is allowed only when no capture is possible, and it is labelled SYNTHETIC there and in the feature map.
2. **Write the feature map** at `.claude/skills/verify-apply/features/<ats>.md` using the four H2s in the map's README. List every field type you saw, and list what you have not verified under `Gotchas`.
3. **Fail first.** Add an end-to-end case to `tests/apply.e2e.test.ts` (or a new `tests/<ats>.e2e.test.ts`) that drives the fixture and asserts on the fixture server's recorded submission. Run it and watch it fail for the reason you expect.
4. **Implement** `src/ats/<ats>/adapter.ts` against `AtsAdapter` in `src/ats/adapter.ts`, and add it to `src/ats/registry.ts`. Browser-side code that defines inner functions goes in a plain `.browser.js` file, as Greenhouse does, because tsx breaks those functions in the page.
5. `npm run check`. The structure test fails until the adapter is registered and has a feature map.
6. Drive it once through the CLI per the `verify-apply` skill and cite the run dir.

## Trust

A new adapter starts outside `autoSubmitAts`. Suggest promoting it to the candidate only after 10 real applications on that ATS were approved and confirmed, with no hold reason other than trust. The candidate makes the change.
