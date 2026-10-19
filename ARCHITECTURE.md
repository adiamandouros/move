# How Wayhop fits together

A map of the code, for whoever works on it next. The [README](README.md)
covers setting it up and running it.

Wayhop has no build step and no front-end framework. The server renders
every page's HTML at startup and keeps it in memory; each page then loads a
few plain JavaScript modules for its live parts (routes, bus arrivals,
announcements, the map).

```
browser ─► Express (server/app.js, started by server.js)
            ├─ pages ─────────────── server/pages/   every page, in English and Greek
            ├─ /api/arrivals ─────── server/oasa/    live bus times from OASA
            ├─ /api/announcements ── server/info/    OASA's and STASY's announcements
            ├─ /data/*.json ──────── data/build/     timetables and stops, built by server/data/
            ├─ /admin ────────────── server/admin/   private station editor and diagnostics
            └─ files ─────────────── public/, tools/<id>/client/, /vendor (node_modules)
```

## Pages

Every page exists twice: in English at its path (`/subway`) and in Greek
under `/el` (`/el/subway`). The server renders each one fully in its
language, so browsers and search engines get it ready to show; the browser
never translates anything.

Where each page comes from. [server/pages/registry.js](server/pages/registry.js)
lists them all and says where the rest are:

| Page | Defined in | Its content |
|---|---|---|
| Home, offline | `registry.js` | `server/views/home.html`, `offline.html` |
| Subway, Buses, Info | `tools/<id>/tool.json` | `tools/<id>/page.html`, see [tools/README.md](tools/README.md) |
| About, Privacy, Contact | `registry.js` | `server/views/pages/<name>.<lang>.html`, one file per language |
| Metro stations | `server/pages/stations.js` | written from `rail.json` on request |
| Not found (404) | `registry.js` (`NOT_FOUND`) | `server/views/notfound.html` |
| Admin | `server/admin/` | `admin/*.html`, English only |

### How a page is rendered

All in [server/pages/](server/pages/):

1. `index.js` takes each page in the registry, in each language.
2. `layout.js` puts its content into `server/views/layout.html`: the head
   (search tags from `seo.js`), the navigation, the language link, the
   footer, the page's strings and its scripts.
3. `i18n.js` puts the result into the page's language (below).
4. The HTML is kept in memory and sent as it is. Station pages are rendered
   when first asked for and kept until `rail.json` changes.

The other files there: `assets.js` (stylesheets, scripts and their
versions), `icons.js` (the icon sprite, `/icons.svg`), `service-worker.js`
(offline cache), `seo.js` (meta tags, structured data, robots.txt, sitemap).

Icons are Bootstrap Icons, served as one small sprite of only the ones in
use (listed in `icons.js`): `icon(name, classes)` from `/js/core/html.js`
writes one, on the server or in the browser; static views write
`<svg class="bi" aria-hidden="true"><use href="/icons.svg#name"></use></svg>`.
The server adds the version to every `/icons.svg` link.

Styles are Bootstrap 5.3 (from `node_modules`, no build step) plus
`public/css/style.css`. Wayhop's colours are Bootstrap's CSS variables, set
once per colour mode at the top of `style.css` (`--wh-` ones for Wayhop's
own components); rules use the variable names, never colour values, and
`test/accessibility.test.js` checks their contrast. Use Bootstrap's
components (accordion, card, toast, buttons) and utilities, themed through
their `--bs-` variables; `style.css` is for what Bootstrap doesn't have
(the train diagram, the map, arrival badges, the navigation). Bootstrap's
JavaScript is the build without Popper: collapse and toast are all the
pages use.

### Text in two languages

- **Short text**: `data-i18n="key"` on an element sets its text, and
  `data-i18n-placeholder`, `-aria-label` and `-title` set those attributes.
  The English text in the markup is only a placeholder; the strings files
  decide. Strings live in `server/views/strings.json` (shared: navigation,
  home, footer, announcements), `tools/<id>/strings.json` (a tool's) and
  `server/views/stations.json` (station pages), each with `en` and `el`.
- **Longer text** (paragraphs with links, lists): written twice, side by
  side, as `data-lang="en"` and `data-lang="el"` elements. The server keeps
  the page's language.
- **Pages of prose** (about, privacy, contact): one file per language.
- **In the browser**: `/js/core/i18n.js` gives `t(key)`, `language` and
  `localHref(path)`. Each page carries only its own language's strings.
- **Switching**: the language link opens the same page in the other
  language and remembers the choice in `localStorage`; a small script in
  `<head>` sends later visits to that language before the page shows.
- `lang="…"` only marks text in a language other than the page's, such as
  Greek announcements on an English page.

## Browser code

- `public/js/core/`: modules any page can import. `shell.js` runs on every
  page (location, language link, service worker). `i18n.js`, `html.js`
  (`escapeHtml`, `format`, `textOn`), `metro.js` (train diagram, line
  badge), `location.js`, `announcements.js`, `ads.js`.
- `tools/<id>/client/`: a tool's own scripts, served at `/tools/<id>/`.
- **Location** (`/js/core/location.js`): only the pages that use it start it
  (Buses, and Subway when allowed or on "Nearest station"), so the browser
  asks once, where it's clear why. The last position is kept on the device
  for 10 minutes and shared by the pages, and nothing waits for it: pages
  show what they can and update as positions come.
- Scripts import each other by absolute URL (`/js/core/i18n.js`). An import
  map in every page points those URLs at the current version (`?v=<hash>`),
  so a deploy never mixes old and new files.
- Logic without the DOM (route finding in `tools/subway/client/network.js`,
  nearest stops in `tools/buses/client/stops.js`) is tested in Node.
- `html.js`, `metro.js` and `network.js` are also used by the server (the
  station pages), so they only import other files by relative path, which
  works in both.

## Offline

`server/views/sw.js` is the service worker; `service-worker.js` fills in its
version and what it caches at install: the home and offline pages, the files
every page needs, and the tools with `"offline": true` in `tool.json`
(Subway and Info) with their data (`rail.json`). Pages come from the network
first, except those tools, which open from the cache at once and update in
the background. `/api` and `/admin` are never cached. Each deploy changes
the version, which replaces the whole cache.

## Live bus times and the load on OASA

[server/oasa/](server/oasa/) is the only code that talks to OASA's live API:

- `client.js`: at most 2 requests a second, in two lanes: someone's first
  look at a stop goes ahead of refreshes. Routes are tried in order:
  direct, the Cloudflare Worker, the home relay ([proxy/README.md](proxy/README.md));
  OASA only accepts Greek addresses. A route that keeps failing rests for a day.
- `arrivals.js`: each stop's arrivals are shared by everyone for 30 s; while
  requests queue for OASA (over 2 s, over 5 s), for 60 s or 90 s, counted
  down and marked stale from a minute old. When OASA can't be reached, the
  last answer is served for up to 5 minutes.
- The bus page ([tools/buses/client/main.js](tools/buses/client/main.js))
  refreshes only the stops on screen, by when their next bus comes: within
  10 minutes every 30 s, 10–20 minutes every 60 s, later or none every 2
  minutes (an opened stop every 30 s), and counts the minutes down in between.
- `limits.js`: each visitor may ask for 30 stops a minute that aren't cached.
- `index.js`: `/api/arrivals`, for stops in `bus-stops.json` only.

These numbers set our load on OASA; changes to them are agreed first.

Announcements ([server/info/announcements.js](server/info/announcements.js))
are fetched from OASA's RSS and STASY's news page at most every 15 minutes,
only when someone asks, and kept on disk.

## Timetables and stops

[server/data/](server/data/) downloads OASA's open data (GTFS, from the CKAN
portal) and builds `data/build/rail.json` (metro lines, stations, timetables
and where to stand) and `data/build/bus-stops.json`. It runs when the server
starts and daily at 04:30 Athens time, in a child process at low priority
(`runBuildInChild`), so it doesn't slow the site or add to its memory. It
downloads only what changed, and the site keeps serving the previous build
if a build fails. Where to stand on each
train is curated by hand in `data/curated/` ([README](data/curated/README.md)),
and can be edited from a phone at `/admin/stations`.

## Monitoring

`/api/health` (`server/health.js`) says whether the live site works:
- live arrivals have come in recently;
- every announcement source loaded;
- last night's data build worked;
- the metro timetable doesn't end within a week;
- each relay runs the current `RELAY_VERSION`.

It answers 503 with the problems in plain words, without addresses, keys or
error details. Every 30 minutes, `.github/workflows/health.yml` runs
`scripts/health-check.js` against wayhop.gr. It asks what a visitor would
(the home pages, one stop's arrivals, the announcements), then reads the
health page, and rechecks a problem after 2 minutes. While the site is
unhealthy, an issue labelled `health` stays open; GitHub emails it.
`/admin/diagnostics` has the details.

`server/security.js` adds the security headers to every response, including
the Content-Security-Policy from `server/csp.js`. The policy is built at
startup from the inline scripts the pages really have (two: the language
redirect, the same on every page, and the import map), allowed by hash; so
don't add inline scripts or `onclick="…"` attributes: put code in a file
(`csp.test.js` fails otherwise). AdSense's hosts are added only when
`ADSENSE_CLIENT` is set. `CSP_MODE` in `.env` chooses `report-only` (the
default while it's tried out: browsers report, nothing is blocked) or
`enforce`; reports go to `/api/csp-report` (`server/csp-reports.js`) and
show on `/admin/diagnostics`. The tests always enforce it.

## Ads and search

`server/ads.js`: Google AdSense, off until its `.env` settings exist; ad
slots come after a page's content, never inside results.
`server/canonical-host.js`: other addresses redirect to `SITE_URL`.

## Checks

`npm run check` runs all four below; GitHub runs them on every pull request
and on `main` (`.github/workflows/checks.yml`), with Node 20 and 22.

- `npm test` runs `test/*.test.js`: building the data, route finding,
  the OASA client and its limits, the relays, announcements, every page as
  the server sends it (`seo.test.js`, `accessibility.test.js`,
  `assets.test.js`, `stations.test.js`), the whole server over HTTP
  (`server.test.js`: headers, 404s, caching, the APIs' refusals), and the
  browser code's logic and drawing (loaded by `test/support/browser-modules.js`).
  The tests need no network.
- `npm run test:browser`: the site in real browsers (phone, desktop and
  iPhone), with test data and a fake OASA: every page in both languages
  through axe-core and a keyboard walk, plus location, language, the bus
  page's requests, the planner at night and offline use. See
  [test/browser/README.md](test/browser/README.md). The app itself is
  `server/app.js`; `server.js` only starts it.

Every night `.github/workflows/nightly.yml` runs `npm run check` on `main`,
and `npm run test:live` (`test/live/`): a few checks against wayhop.gr with
its real data and live bus times, the bus page opened once. Either failing
opens an issue labelled "nightly".
- `npm run lint`: ESLint's recommended checks (`eslint.config.js`).
- `npm run typecheck`: TypeScript checks every file of the app, the scripts
  and the relays against their JSDoc types (`jsconfig.json`). The shapes of
  the data shared by the server and the browser (`rail.json`,
  `bus-stops.json`, tools, pages) are in `types/`, and what the pages use
  from the browser beyond the DOM (Bootstrap, AdSense) in
  `types/globals.d.ts`. Nothing is compiled, and editors show the types too.
  Where TypeScript can't know which element a query finds, a
  `/** @type {HTMLElement} */ (…)` note says so.

The **Check accessibility** button on `/admin/diagnostics` runs axe-core on
the live pages in your browser.

[test/README.md](test/README.md) maps the whole suite: which kind of test
goes where, what runs on each commit (lint, types, Node tests) and push
(browser tests on one phone) through `.githooks/`, the coverage floor
(`npm run test:coverage`) and the rule that flaky tests fail.

`node scripts/snapshot.js <folder>` writes every response the server sends
to files; run it before and after a change that shouldn't change any page,
then `diff -r` the two folders.

## Common changes

Every change comes with its tests: new functionality gets new tests,
changed functionality updates the tests that cover it, and a bug fix gets a
test that would have caught it ([CLAUDE.md](CLAUDE.md)).

- **A string**: add it to the right strings file in both `en` and `el`, then
  use `data-i18n` in markup or `t()` in a script.
- **A tool**: copy a `tools/<id>/` folder ([tools/README.md](tools/README.md)).
- **Another page**: add an entry to `sitePages` in `registry.js`, with a
  view in `server/views/`.
- **The layout**: `server/views/layout.html` and `server/pages/layout.js`.
- **What works offline**: `"offline"` and `"precache"` in `tool.json`.
