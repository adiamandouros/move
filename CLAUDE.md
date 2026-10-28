# Working on Wayhop

Start with [ARCHITECTURE.md](ARCHITECTURE.md) (how the code fits together)
and [README.md](README.md) (running it). Anything visual follows
[DESIGN.md](DESIGN.md).

## Tests come with every change

- **New functionality comes with tests**, wherever it can be tested.
- **Changed functionality updates the tests that cover it**, so they describe
  what the code does now.
- **A bug fix comes with a test** that would have caught the bug.
- All of it in the same pull request as the change. If something really
  can't be tested, the pull request says why.

Where tests go:

- Logic, data building, what the server sends: `test/*.test.js`
  (`node:test`, `npm test`). The whole server over HTTP: `server.test.js`.
  Browser code that only works things out or builds HTML: in Node too, with
  `test/support/browser-modules.js`.
- What a person does in a page (flows, keyboard, location, timing, offline):
  `test/browser/*.spec.js` (Playwright, `npm run test:browser`).
  [test/browser/README.md](test/browser/README.md) covers the fixed clock,
  fake location, fake OASA and the `axe()` / `keyboardWalk()` helpers. New
  pages get axe-core and keyboard checks automatically; a spec still needs
  to cover what they do.
- What's worth watching on the live site each night: `test/live/`.

`npm run check` runs lint, type checks and both kinds of tests. Git runs the
quick part before every commit and the browser tests on one phone before
every push (`.githooks/`, set up by `npm install`); GitHub runs everything on
every pull request, and every night on `main`. Don't skip the hooks to get
past a failure: fix it. [test/README.md](test/README.md) has the map and the
rules (no flaky tests, coverage only goes up).

## Other rules

- Never commit to `main`: branch per topic, then a pull request.
- When the user says they merged a pull request, delete its branch both
  locally and on GitHub, then switch to `main` and pull.
- Every screen must be fully accessible: axe-core clean and usable with the
  keyboard alone.
- Anything that changes how often OASA is asked (polling, caching, limits):
  propose the numbers first.

## Saving progress

When the user says "save our progress", "store our progress", "note
everything down" or the like, that means: update the roadmap page (Claude's
roadmap artifact), the one place the plan lives. Read it first and build on
what's there.

- Each open item says what it needs first.
- Each finished item is one line; the details stay in its pull requests.
- Claude's `roadmap` memory only points at the page and says, in a few
  lines, where things stand now. It holds no copy of the plan.
