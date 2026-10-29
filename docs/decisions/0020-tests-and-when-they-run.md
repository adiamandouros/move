# 20. Tests with every change, no flaky tests, and when each kind runs

Decided 2026-10-29 · In force

## Situation

[Decision 14](0014-tests.md) said to look again once the time a pull
request waits, or the flaky tests, cost more than they catch. By 29 October
a pull request waited about 8½ minutes for its checks, nearly all of it one
job running the browser tests on three devices; the push hook took about a
minute, and the Node tests 7 seconds, most of it waiting for their own test
servers to close. Some checks were also made twice: in Node and again in a
browser, or on every device and in both languages where neither changes
what they find (roadmap item 41).

## Decision

- New functionality comes with tests, changed functionality updates them,
  and a bug fix comes with a test that would have caught it, all in the same
  pull request ([CLAUDE.md](../../CLAUDE.md)).
- Test as early as possible: in Node if the code can run there, in a
  browser only for what needs one ([test/README.md](../../test/README.md)).
  A check is made once, where it costs least: a browser test doesn't repeat
  what a Node test checks, and a check whose result doesn't depend on the
  device or the language runs on one of them.
- A test that passes only on its second try fails the run.
- The server code's coverage may not fall below its floor (95% of lines,
  85% of branches, 93% of functions), and the floor is raised as the
  coverage goes up.
- What runs when:
  - before every commit: lint, type checks and the Node tests, in a few
    seconds;
  - before every push: the browser tests on one phone, without the checks
    of every page (`@every-page`: axe-core, the keyboard and 200% text on
    each page);
  - on every pull request: all of it, each device (phone, desktop, iPhone)
    a job of its own, side by side;
  - every night, on `main`: all of it, every browser test twice more, and
    the live site.

## What follows

- A pull request waits for its slowest device, not for all three.
- A page's accessibility problem shows on the pull request rather than
  before the push; nothing reaches `main` without every check.
- The browser tests are still the slow part and where flaky tests come
  from.

## Look again when

- The slowest device's job, or the flaky tests, cost more than they catch.
- The repository becomes private: three jobs would then cost GitHub
  minutes.
