# Tests

Every change comes with its tests ([CLAUDE.md](../CLAUDE.md)). This page is
the map: which kind of test goes where, what runs when, and the rules.

## Where a test goes

Test as early as possible: in Node if the code can run there, in a browser
only for what needs one.

| What it checks | Where | Runs with |
|---|---|---|
| Logic, data building, what the server renders | `test/*.test.js` | `npm test` (Node, a few seconds) |
| The whole server over HTTP: headers, 404s, caching, the APIs' answers and refusals | `test/server.test.js` | `npm test` |
| Browser code that works things out or builds HTML (search, routes, bus stops, timing, location) | `test/*.test.js`, loaded with `support/browser-modules.js` | `npm test` |
| What a person does in a page: flows, keyboard, axe-core, location, timing, offline, failures | `test/browser/*.spec.js` | `npm run test:browser` (Playwright) |
| The live site with its real data | `test/live/` | `npm run test:live`, nightly |

Shared pieces:
- `fixtures/`: small feeds and data (`gtfs.js` also writes RAR archives and
  fakes the open-data portal; `rail.js` is a tiny metro network; `stasy.js`
  writes STASY's timetable pages).
- `support/test-site.js`: the real app with test data, a fake OASA and fake
  announcement sources, plus copies of it where things go wrong
  (`scenarios()`). The browser tests and `server.test.js` both use it.
- `support/listen.js`: `listen(app)` serves an app on a free port for a
  Node test, and closes it without waiting.
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
| Every push (`.githooks/pre-push`) | browser tests on one phone, without the checks of every page (`@every-page`) | about half a minute |
| Every pull request and push to `main` (`checks.yml`) | all of the above in two time zones (Node 20 in UTC, 22 at UTC+14), the coverage floor, and every browser test on phone, desktop and iPhone, each device a job of its own, side by side | a few minutes: the slowest device |
| Every night (`nightly.yml`) | the same on `main`, every browser test twice more, and the live site | about half an hour |

`npm install` points git at `.githooks/` (the `prepare` script). To skip a
hook once: `git commit --no-verify`, `git push --no-verify`. Why it's split
this way: [decision 20](../docs/decisions/0020-tests-and-when-they-run.md).

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
- **Fast stays fast.** The Node tests run in a few seconds: no real
  network, no real waiting (mock the timers), no real data build. A test
  starts its own server with `support/listen.js`, whose `close()` doesn't
  wait for the connections `fetch()` keeps open (`fast.test.js` checks).
- **Each check once, where it costs least.** A browser test doesn't repeat
  what a Node test checks, and a check whose result doesn't depend on the
  device or the language runs on one of them (`onlyOn()`).
- **A check must be able to fail.** When adding a check that other tests
  rely on (like `support/markup.js`), test that it catches what it's for
  (`markup-checks.test.js`).
