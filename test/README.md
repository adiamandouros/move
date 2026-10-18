# Tests

Every change comes with its tests ([CLAUDE.md](../CLAUDE.md)). This page is
the map: which kind of test goes where, what runs when, and the rules.

## Where a test goes

Test as early as possible: in Node if the code can run there, in a browser
only for what needs one.

| What it checks | Where | Runs with |
|---|---|---|
| Logic, data building, what the server renders | `test/*.test.js` | `npm test` (Node, under 2 s) |
| The whole server over HTTP: headers, 404s, caching, the APIs' answers and refusals | `test/server.test.js` | `npm test` |
| Browser code that works things out or builds HTML (search, routes, bus stops, timing, location) | `test/*.test.js`, loaded with `support/browser-modules.js` | `npm test` |
| What a person does in a page: flows, keyboard, axe-core, location, timing, offline, failures | `test/browser/*.spec.js` | `npm run test:browser` (Playwright) |
| The live site with its real data | `test/live/` | `npm run test:live`, nightly |

Shared pieces:
- `fixtures/`: small feeds and data (`gtfs.js` also writes RAR archives and
  fakes the open-data portal; `rail.js` is a tiny metro network).
- `support/test-site.js`: the real app with test data, a fake OASA and fake
  announcement sources, plus copies of it where things go wrong
  (`scenarios()`). The browser tests and `server.test.js` both use it.
- `support/browser-modules.js`: loads browser modules in Node, in either
  language, with the real strings.
- `support/markup.js`: accessibility checks on HTML (headings, names, icons,
  new tabs, ids, labels, strings shown as their keys), for whole pages and
  for what scripts draw.
- `browser/fixtures.js`: what every browser test gets (fixed clock, fake
  location, scenarios, a failure on any script error, `axe()`,
  `keyboardWalk()`, `onlyOn()`). See [browser/README.md](browser/README.md).

## What runs when

| When | What | How long |
|---|---|---|
| Every commit (`.githooks/pre-commit`) | lint, type checks, Node tests | a few seconds |
| Every push (`.githooks/pre-push`) | browser tests on one phone | about 20 s |
| Every pull request and push to `main` (`checks.yml`) | all of the above in two time zones (Node 20 in UTC, 22 at UTC+14), the coverage floor, browser tests on phone, desktop and iPhone | a few minutes |
| Every night (`nightly.yml`) | the same on `main`, every browser test twice more, and the live site | about 10 minutes |

`npm install` points git at `.githooks/` (the `prepare` script). To skip a
hook once: `git commit --no-verify`, `git push --no-verify`.

## Rules

- **A bug fix comes with a test that would have caught it.** Check that it
  fails without the fix.
- **No flaky tests.** On GitHub a failed browser test runs once more for
  its trace, but a test that passes only the second time fails the run.
  Wait for what a person would see (`await expect(…)`), never a fixed time;
  move the fake clock instead of waiting.
- **Coverage only goes up.** `npm run test:coverage` fails if the server
  code's coverage drops below 95% of lines, 85% of branches or 93% of
  functions; raise the numbers in `package.json` when it goes up. Browser
  code isn't counted there: Node's coverage counts each language's copy of
  a module separately, so its numbers for them are wrong.
- **Fast stays fast.** The Node tests run in under two seconds: no real
  network, no real waiting (mock the timers), no real data build.
- **A check must be able to fail.** When adding a check that other tests
  rely on (like `support/markup.js`), test that it catches what it's for
  (`markup-checks.test.js`).
