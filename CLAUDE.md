# Working on Wayhop

Start with [ARCHITECTURE.md](ARCHITECTURE.md) (how the code fits together)
and [README.md](README.md) (running it).

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

`npm run check` runs lint, type checks and both kinds of tests; run it
before pushing. GitHub runs the same on every pull request, and every night
on `main`.

## Other rules

- Never commit to `main`: branch per topic, then a pull request.
- Every screen must be fully accessible: axe-core clean and usable with the
  keyboard alone.
- Anything that changes how often OASA is asked (polling, caching, limits):
  propose the numbers first.
