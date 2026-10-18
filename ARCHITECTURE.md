# How Wayhop fits together

A map of the code, for whoever works on it next. The [README](README.md)
covers setting it up and running it.

Wayhop has no build step and no front-end framework. The server renders
every page's HTML at startup and keeps it in memory; each page then loads a
few plain JavaScript modules for its live parts (routes, bus arrivals,
announcements, the map).

```
browser ─► Express (server.js)
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
versions), `service-worker.js` (offline cache), `seo.js` (meta tags,
structured data, robots.txt, sitemap).

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

- `client.js`: at most 2 requests a second. Routes are tried in order:
  direct, the Cloudflare Worker, the home relay ([proxy/README.md](proxy/README.md));
  OASA only accepts Greek addresses. A route that keeps failing rests for a day.
- `arrivals.js`: each stop's arrivals are shared by everyone for 30 s, and
  served for up to 5 minutes more (marked stale) when OASA can't be reached.
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

## Ads and search

`server/ads.js`: Google AdSense, off until its `.env` settings exist; ad
slots come after a page's content, never inside results.
`server/canonical-host.js`: other addresses redirect to `SITE_URL`.

## Checks

`npm run check` runs all three below; GitHub runs it on every pull request
and on `main` (`.github/workflows/checks.yml`), with Node 20 and 22.

- `npm test` runs everything in `test/`: building the data, route finding,
  the OASA client and its limits, the relays, announcements, and every page
  as the server sends it (`seo.test.js`, `accessibility.test.js`,
  `assets.test.js`, `stations.test.js`). The tests need no network.
- `npm run lint`: ESLint's recommended checks (`eslint.config.js`).
- `npm run typecheck`: TypeScript checks the files that start with
  `// @ts-check` against their JSDoc types. The shapes of the data shared by
  the server and the browser (`rail.json`, `bus-stops.json`, tools, pages)
  are in `types/`; nothing is compiled, and editors show the types too.

The **Check accessibility** button on `/admin/diagnostics` runs axe-core on
the live pages in your browser.

## Common changes

- **A string**: add it to the right strings file in both `en` and `el`, then
  use `data-i18n` in markup or `t()` in a script.
- **A tool**: copy a `tools/<id>/` folder ([tools/README.md](tools/README.md)).
- **Another page**: add an entry to `sitePages` in `registry.js`, with a
  view in `server/views/`.
- **The layout**: `server/views/layout.html` and `server/pages/layout.js`.
- **What works offline**: `"offline"` and `"precache"` in `tool.json`.
