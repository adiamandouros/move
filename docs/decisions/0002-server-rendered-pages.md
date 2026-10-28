# 2. Pages rendered on the server; HTML only through views and `html```

Decided 2026-10-19 · In force

## Situation

Every page has to be readable by search engines and usable before any
script runs. HTML put together from strings is where escaping mistakes come
from, and Wayhop shows a lot of text it doesn't control: OASA's and STASY's
names, notes and announcements.

## Decision

- The server renders every page in full at startup and keeps it in memory.
  Pages drawn from `rail.json` (the station pages, the Info page's last
  trains) are drawn again when it changes.
- Views are Handlebars templates, compiled strictly and only on the server
  ([templates.js](../../server/pages/templates.js)). The browser never loads
  a template engine.
- What the browser draws (bus stops and their arrivals, trip results) is
  built with ``html`` `` from [html.js](../../public/js/core/html.js), which
  escapes every value, and goes into the page with `setHtml()`, never by
  setting `innerHTML` to a string.
- Pieces both sides draw (the train diagram, line pills, station signs) are
  written once, in modules the server and the browser share.

These came out of the templating clean-up of October 2026 (#56–#69).

## What follows

- A typo in a view, a missing string or an unknown helper fails `npm test`,
  since every page is rendered at startup.
- Two ways of writing HTML to know, views and ``html`` ``, on purpose: one
  for pages, one for what scripts draw. `test/escaping.test.js` feeds markup
  into every name and note and checks it comes out as text;
  `test/templates.test.js` checks every string exists.
- Every visitor gets the same HTML for a page.

## Look again when

- Pages have to differ for each visitor (accounts, say), which rendering
  once can't do.
