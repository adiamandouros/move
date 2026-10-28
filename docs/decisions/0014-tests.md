# 14. Tests with every change, and no flaky tests

Decided 2026-10-18 · In force

## Situation

One person merges quickly and deploys the same day. The tests are what stop
a mistake from reaching riders.

## Decision

- New functionality comes with tests, changed functionality updates them,
  and a bug fix comes with a test that would have caught it, all in the same
  pull request ([CLAUDE.md](../../CLAUDE.md)).
- Test as early as possible: in Node if the code can run there, in a
  browser only for what needs one ([test/README.md](../../test/README.md)).
- A test that passes only on its second try fails the run.
- The server code's coverage may not fall below its floor (95% of lines,
  85% of branches, 93% of functions).
- Git runs the quick tests before every commit and the browser tests on one
  phone before every push; GitHub runs everything on every pull request and
  every night.

## What follows

- Changes are made with confidence, at the price of time on each one.
- The browser tests, on three engines, are the slow part and where flaky
  tests come from.

## Look again when

- The time a pull request waits, or the flaky tests, cost more than they
  catch.
