# 66. Stricter type checks, file by file, the count only going down

Decided 2026-11-20 · In force

## Situation

Types come from JSDoc comments, checked by `npm run typecheck`
([1](0001-no-build-step.md)), but `jsconfig.json` has `strict: false`. The
check lets anything untyped through, and it never asks whether a value
can be null or missing. An outside review of the code on 19 November 2026
named that gap, and it was agreed with the rider as a To do after the Trip
page's state moved into a controller (roadmap Types · strict), so that
`tools/trip/client/main.js` would be fixed once, in its new shape.

Measured on 20 November 2026, after that move: with `strictNullChecks`,
667 errors in 85 files (`main.js` down to 29 from 155); with
`noImplicitAny`, 2,634 in 126.

## Decision

Agreed with the rider on 20 November 2026, every option as recommended.

- **`strictNullChecks` first**, the check that finds real bugs: a value
  that can be null or missing used as if it can't. `noImplicitAny` gets
  its own plan once this one is done.
- **Held file by file**: `types/strict-null-checks.json` lists each file's
  errors with `strictNullChecks`, and `npm run typecheck` runs TypeScript
  a second time with it on (`scripts/strict-nulls.js`, about a second)
  and fails when a file has more errors than its number. A file that
  isn't listed, a new one among them, is allowed none. It also fails when
  a file has fewer, until the number is written down
  (`node scripts/strict-nulls.js --write`), so the list stays exact and
  the count only goes down, as coverage only goes up
  ([20](0020-tests-and-when-they-run.md)).
- **A number that goes up** is written down only with its reason in the
  pull request: a type made exact can move errors to the code that uses it.
- **The order, a pull request each**: the check with the Trip page's
  small files; its controller, `main.js` and `render.js`; its worker's
  `buses.js` and `searcher.js`; `public/js/core/`; the Buses page; the
  Subway and Info pages; the server, the scripts and the relay. Then
  `strictNullChecks` goes on in `jsconfig.json`, and the list and its
  script go.
- **Types and guards only**: the fixes change no behaviour. A guard on a
  case that can't happen is fine. A real bug found on the way gets a pull
  request of its own with a test that fails on the code before it.

## What follows

- New code is held to `strictNullChecks` from now on, as a new file is
  allowed no errors.
- About seven pull requests, each one reviewable on its own; nothing a
  rider sees changes.
- The editor's own type check still runs with `strict: false` until the
  end, so the errors left show only with
  `node_modules/.bin/tsc -p jsconfig.json --strictNullChecks`.

## Look again when

- Every file is at none: `strictNullChecks` on in `jsconfig.json`, the
  list and the script deleted, and `noImplicitAny` planned the same way.
- A pull request needs to raise many numbers at once: then the order
  above is wrong, or the type behind them is.
