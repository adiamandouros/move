# 70. The rest of the strict type check, file by file, written `any` counted

Decided 2026-11-22 · In force

## Situation

Since [66](0066-strict-null-checks-step-by-step.md) `npm run typecheck`
checks with `strictNullChecks`, but `jsconfig.json` still has
`strict: false`. So a value with no type, like an untyped parameter or an
empty `let`, is `any`, and nothing about it is checked. Record 66 left
`noImplicitAny` for a plan of its own (roadmap Types · any).

Measured on 22 November 2026, on `main` at 7a3898a with TypeScript 7.0.2:

- `noImplicitAny`: 2,352 errors in 128 files. 1,816 of them are
  untyped parameters and 154 untyped destructured ones; the rest are
  objects indexed by a string, objects built up from `{}` and lists
  started empty.
- The rest of `strict`: 61 from `useUnknownInCatchVariables` (a
  `catch (err)` gives an `unknown`, so `err.message` needs a check) and
  4 from `noImplicitThis` and `strictFunctionTypes`. All of `strict`:
  2,417.
- 140 `any`s are written into the types, mostly a plain `{any}`. No
  setting catches those.

## Decision

Agreed with the rider on 22 November 2026, every option as recommended.

- **All of `strict`**, not `noImplicitAny` alone, so the end is
  `"strict": true` in `jsconfig.json`, with nothing else to turn on.
- **Written `any` counted too**: a file's number is its errors with
  `--strict` plus the `any`s written in its JSDoc (or anywhere in a
  `.d.ts` but its comments). They get replaced by real types or
  `unknown`, and none can be added to silence an error.
- **Held file by file, as in 66**: `types/strict.json` lists each file's
  number, and `npm run typecheck` runs TypeScript a second time with
  `--strict` and counts the written `any`s (`scripts/strict-types.js`,
  about a second). It fails when a file is over its number. A file that
  isn't listed, a new one among them, is allowed none. It also fails
  when a file is under, until the number is written down
  (`node scripts/strict-types.js --write`), so the count only goes down.
- **A number that goes up** is written down only with its reason in the
  pull request: a type made exact can move errors to the code that uses
  it.
- **Dependencies first, a pull request each**, about 13 of 150 to 250
  each: the check with `public/js/core/`; the Subway page (two); the
  Trip page; the Buses and Info pages; the server's pages; OASA, the
  admin and the rest of the server; places and diagnostics; the data
  build (three); the scripts and the relay. Then `strict` goes on in
  `jsconfig.json`. Each area's types are real before the next one uses
  them: the Trip page imports from the Subway page, so typing the Subway
  page after the Trip page would push new errors into the Trip page's
  files.
- **Types and guards only**, as in 66: the fixes change no behaviour. A
  real bug found on the way gets a pull request of its own with a test
  that fails on the code before it.

## What follows

- New code is held to all of `strict` from now on, as a new file is
  allowed no errors and no written `any`.
- Typing shared code can find mistakes in the code that uses it with the
  check as it is, which has to stay at none. The first step found one:
  the Trip page drew "Working out the next half hour…" into the page as
  plain text rather than through `html```. It was harmless (the text is
  ours and has no markup), and it's wrapped now.
- The editor's own check still runs with `strict: false` until the end,
  so the errors left show only with
  `node_modules/.bin/tsc -p jsconfig.json --strict`.
- At the end `strict: true` makes `strictNullChecks`' own line
  redundant. A small check keeps written `any` at none: the script kept
  for that alone, or a test.

## Look again when

- A pull request needs to raise many numbers at once: then the order
  above is wrong, or the type behind them is.
- A value really can be anything (JSON from outside before its check):
  that's `unknown` and a check, not `any`. If one place truly can't do
  without `any`, this page changes to say where.
