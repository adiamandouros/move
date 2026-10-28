# 15. A Content-Security-Policy by hashes

Decided 2026-10-19 · In force

## Situation

Wayhop puts text it doesn't control on its pages (OASA's and STASY's names
and announcements). AdSense needs its own hosts and inline styles.

## Decision

- Every response carries a Content-Security-Policy, built at startup from
  the inline scripts the pages really have, each allowed by its hash
  ([csp.js](../../server/csp.js)). The pages have no other inline scripts,
  no `onclick="…"` and no inline styles (`test/csp.test.js`).
- AdSense's hosts are allowed only when AdSense is set up.
- `CSP_MODE` chooses `report-only` (the default) or `enforce`; browsers'
  reports show on `/admin/diagnostics`. The tests always enforce it.
- It stays report-only until the ads work, and is enforced once their
  reports are clean.

## What follows

- A new inline script fails the tests until it is moved into a file.
- Until it is enforced, the policy only reports.

## Look again when

- AdSense is approved, or dropped.
