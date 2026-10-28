# Browser tests

The site in real browsers, the way people use it: every page in both
languages, the keyboard, location, the bus page's requests, offline use.
They run on every pull request (`.github/workflows/checks.yml`) and in
`npm run check`.

```bash
npx playwright install chromium webkit   # once, and after updating @playwright/test
npm run test:browser                     # everything, on phone, desktop and iPhone
npm run test:browser -- --project=phone  # one of them
npm run test:browser -- buses            # the files whose names match
npm run test:browser -- --ui             # watch them run, step by step
```

WebKit (the `iphone` project) needs a few system libraries:
`sudo npx playwright install-deps webkit` once. Without them, run the other
two with `--project=phone --project=desktop`.

A failed test keeps a screenshot and a trace in `test-results/`:
`npx playwright show-trace test-results/<test>/trace.zip` replays it with
the page, the network and the console at every step. On GitHub they're in
the run's `playwright-report` artifact.

## What they run against

`test/support/test-site.js` builds the real app (`server/app.js`) with:

- **data/**: the real `rail.json`, the bus stops around Syntagma and
  Omonia from `bus-stops.json`, and two lines from `bus-lines.json` (the 040
  and the Χ95, with all their stops). `node test/browser/data/update.js` refreshes
  them from `data/build/` when their format changes.
- **a fake OASA**: every stop has three buses, the first 1–19 minutes away
  depending on its code (`arrivalsAt()`), named after the stop's own lines.
- **fake announcement sources**: two OASA posts and one STASY post.

It also builds the copies where something goes wrong (`scenarios()`), and
the Node tests of the whole server (`test/server.test.js`) use the same site.
Nothing reaches the network, so the tests give the same result anywhere.
`server.js` here serves it, each scenario picked by a cookie; Playwright
starts it itself, and `node test/browser/server.js` runs it on
<http://localhost:3457> to look around.

## Writing one

Import `test` and `expect` from `./fixtures.js`. Every test gets:

- **a fixed clock**: Wednesday 21 October 2026, 12:00 in Athens, running
  from there. `test.use({ now: '2026-10-14T23:55:00+03:00' })` for another
  moment; `page.clock.fastForward()` / `runFor()` to skip ahead (see
  `buses.spec.js` for minutes of refreshes in a second).
- **a fake location**, at Syntagma and allowed.
  `test.use({ location: { permission, answer, at } })` changes it:
  `permission` is what the browser reports (`'granted'`, `'prompt'`,
  `'denied'`), `answer` what asking gives (`'position'`, `'deny'`, or
  `'never'` for no signal). `window.__geo` counts the page's calls to it;
  `window.__setLocation({ at })` moves it, and `window.__sendPosition()`
  sends the page's watches a new fix at once, like a phone does every
  second or so.
- **no script errors**: a test fails if the page throws or logs an error.
- **no service worker**, so pages don't come from the offline cache at
  random; `offline.spec.js` turns it on to test that cache.

And two helpers:

- `axe(page)`: axe-core's WCAG 2.2 AA and best-practice violations on the
  page as it is; `expect(await axe(page)).toEqual([])`.
- `keyboardWalk(page)`: Tabs through the page and reports focus that's
  invisible, has no focus ring, ends up behind the navigation, or gets stuck.

`pages.spec.js` already runs both on every page in the registry, in both
languages (the list is `site-pages.js`), and `text-size.spec.js` checks
each one at 200% text, so a new page is covered by itself. Write a new spec for what a
page *does*: wait for what a person would see (`await expect(locator)…`),
never a fixed time.

The projects: `phone` (Pixel 7, Chromium), `desktop` (1366 × 900, Chromium)
and `iphone` (iPhone 15, WebKit). Skip one where a test doesn't apply, with
the reason: `test.skip(project.name === 'desktop', 'phones only')`. WebKit
only moves focus to links with Tab when Safari's setting is on, so keyboard
tests skip `iphone`.
