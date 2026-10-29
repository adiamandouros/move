# How Wayhop fits together

A map of the code, for whoever works on it next. The [README](README.md)
covers setting it up and running it, and [docs/decisions/](docs/decisions/README.md)
why it's built this way, one page per decision: the links below that say
"decision 7" and so on.

Wayhop has no build step and no front-end framework
([decision 1](docs/decisions/0001-no-build-step.md)). The server renders
every page's HTML at startup and keeps it in memory (pages drawn from
`rail.json`, the station pages and the Info page's last trains, are drawn
again when it changes; [decision 2](docs/decisions/0002-server-rendered-pages.md));
each page then loads a few plain JavaScript modules for its live parts
(routes, bus arrivals, announcements, the map). It's one process with no
database ([decision 4](docs/decisions/0004-one-process-no-database.md)), on
shared hosting that shapes a few things below
([decision 12](docs/decisions/0012-shared-hosting.md)).

```
browser ─► Express (server/app.js, started by server.js)
            ├─ pages ─────────────── server/pages/   every page, in English and Greek
            ├─ /api/arrivals ─────── server/oasa/    live bus times from OASA
            ├─ /api/announcements ── server/info/    OASA's and STASY's announcements
            ├─ /api/lifts ────────── server/info/    metro lifts out of service, from STASY
            ├─ /data/*.json ──────── data/build/     timetables and stops, built by server/data/
            ├─ /admin ────────────── server/admin/   private station editor and diagnostics
            └─ files ─────────────── public/, tools/<id>/client/, /vendor (node_modules)
```

## Settings

[server/config.js](server/config.js) reads every setting from the
environment (`.env`, explained in `.env.example`) once, and checks it.
`loadConfig()` gives a frozen object: the public address, the contact email
and the User-Agent built from it, the admin password, the CSP mode, AdSense
and the relays. A setting that's given but can't be used is left off and
listed in its `problems`. `server.js` loads `.env`, logs the problems and
hands the config to `createApp`; everything else is passed what it needs.
So tests pass their own settings (`loadConfig({ SITE_URL: … })`) instead of
changing `process.env`, and `test/config.test.js` fails if any other server
file reads it. `/admin/diagnostics` lists the problems too.

`server/files.js` has the file helpers the caches and the data build share:
reading a JSON file, and writing a file through a temporary one and a rename.

## Pages

Every page exists twice: in English at its path (`/subway`) and in Greek
under `/el` (`/el/subway`). The server renders each one fully in its
language; the browser never translates anything
([decision 3](docs/decisions/0003-languages.md)).

Where each page comes from. [server/pages/registry.js](server/pages/registry.js)
lists them all and says where the rest are:

| Page | Defined in | Its content |
|---|---|---|
| Home, offline | `registry.js` | `server/views/home.hbs`, `offline.hbs` |
| Subway, Buses, Info | `tools/<id>/tool.json` | `tools/<id>/page.hbs`, see [tools/README.md](tools/README.md) |
| About, Privacy, Terms of use, Contact | `registry.js` | `server/views/pages/<name>.<lang>.hbs`, one file per language |
| Metro stations | `server/pages/stations.js` | `server/views/stations/*.hbs`, from `rail.json` on request |
| Not found (404) | `registry.js` (`NOT_FOUND`) | `server/views/notfound.hbs` |
| Error (500) | `registry.js` (`SERVER_ERROR`) | `server/views/error.hbs` |
| Admin | `server/admin/` | `admin/*.hbs`, English only |

### How a page is rendered

All in [server/pages/](server/pages/):

1. `index.js` (`renderPage`) takes each page in the registry, in each
   language, and renders its view (below) with the page's strings. Every
   page has the same shape (listed in `registry.js`), the station pages too
   (`stationPage` in `stations.js`): a title and description by strings
   key, filled with its `values` where they have `{name}`s, its content,
   scripts and structured data. A page's own strings go to the browser
   only when it has scripts of its own. Views are loaded one way,
   `view('server/views/home.hbs')`, by their path from the repository's root.
2. `layout.js` puts the result into `server/views/layout.hbs`: the head
   (search tags from `seo.js`), the navigation, the language link, the
   menu, the page's strings and its scripts. Links to the pages point at
   the page's language (`localiseLinks` in `i18n.js`), and links to
   stylesheets, scripts and icons carry that file's version (`versionOf` in
   `assets.js`, a hash of the file), so a deploy gives new addresses only to
   the files it changed. Node keeps a file for good at its current version
   and checks it every time at any other (`cacheControl`).
3. The HTML is kept in memory and sent as it is. Station pages are
   rendered from `rail.json` when first asked for (by the same
   `renderPage`), and kept until it changes: `stations.js` works out what each one shows as plain data
   (`stationView`, `indexView`, tested without HTML) and its views draw it.

### Views

Views are [Handlebars](https://handlebarsjs.com/) templates (`.hbs`),
compiled once by [templates.js](server/pages/templates.js) and only on the
server. HTML is written in two ways only, both escaping what goes in: views,
and ``html`` `` in JavaScript; never in plain strings
([decision 2](docs/decisions/0002-server-rendered-pages.md);
`test/escaping.test.js` checks). `{{value}}` is escaped; `{{{content}}}`, the page inside the
layout, is the one value put in as it is. What goes into `<head>` is data
too: `seo.js` gives the meta tags' values (`partials/meta.hbs` writes them),
and structured data and the import map go in with `{{json}}`. Pieces built with ``html`` `` (a line
badge, the train diagram, a stop's note) go in as `{{value}}`. The metro
pieces both the subway page and the station pages show are built once, in
`metro.js`, so they look the same on both. Eight helpers:

- `{{t "key"}}`: the page's string; `{{t "stations.toward" name=toward}}`
  fills its `{name}` (with a piece built with ``html`` `` as it is, a pill
  say; `formatHtml()` in `/js/core/html.js`).
- `{{#ifLang "en"}}…{{else}}…{{/ifLang}}`: text written in both languages
  (paragraphs with links, lists), the English first.
- `{{icon "geo-alt" "me-1"}}`: an icon from the sprite.
- `{{json value}}`: JSON that's safe inside a `<script>` element.
- `{{formatDate "2026-10-14"}}`: a date as people write it, 14/10/2026.
- `{{pill "M3"}}`, `{{plate "X95"}}`: a line's pill, a bus line's plate
  (`/js/core/lines.js`; a size as a second argument, `"s"` or `"l"`).
- `{{#external href="https://…"}}text{{/external}}`: a link that opens in a
  new tab and tells screen readers so (`class`, `lang`, `id`, `hidden=true`
  as needed). It's `externalLink()` from `/js/core/html.js`, which the
  browser's code uses too; a test keeps every such link written this way.

They're compiled strictly: a value the view names but isn't given, a helper
that doesn't exist or a missing string throws, and every page is rendered
at startup, so a typo fails `npm test` rather than showing on the site.
`test/templates.test.js` checks that every string the views use exists in
both languages and that every `{{#ifLang}}` has its Greek. Partials are in
`server/views/partials/`: a piece of a page as `{{> name}}` (a station's
direction card, `station-direction`), or around what's inside it as
`{{#> section id="map" iconName="map" title="info.map"}}…{{/section}}` (a
section of the info page's accordion). What the browser draws (bus stops and
their arrivals, trip results) isn't Handlebars: those components are
functions built with ``html`` `` in the tool's
`client/`, or in `/js/core/metro.js` when the server draws them too. A tool's
`data.json` gives its `page.hbs` its values. The service
workers aren't HTML: `fill()` puts their version and file lists in.

The other files there: `assets.js` (stylesheets, scripts and their
versions), `icons.js` (the icon sprite, `/icons.svg`), `service-worker.js`
(offline cache), `seo.js` (meta tags, structured data, robots.txt, sitemap).

Icons are Material Symbols Rounded, named by what they mean and served as
one small sprite of only the ones in use: `MEANINGS` in `icons.js` maps each
meaning to its picture, outline or filled (DESIGN.md has the rules), and
the SVGs are copied into `server/icons/` by `npm run icons` from a dev
dependency. `icon(meaning, classes)` from `/js/core/html.js` writes one, on
the server or in the browser, and views write `{{icon "meaning"}}`. The server adds the version to every `/icons.svg` link.

Styles are Bootstrap 5.3 (from `node_modules`, no build step) plus
`public/css/style.css`. The font is Roboto, everywhere: its Latin and Greek
variable files come from `node_modules` too (`FONTS` in `assets.js`, named
again by the `@font-face` rules at the top of `style.css`; a test keeps the
two the same), preloaded by every page and kept by the service worker. Wayhop's colours are Bootstrap's CSS variables, set
once per colour mode at the top of `style.css` (`--wh-` ones for Wayhop's
own components); rules use the variable names, never colour values, and
`test/accessibility.test.js` checks their contrast. Sizes, corners,
space and shadows are tokens too, in rem, with the rules in
[DESIGN.md](DESIGN.md) (`test/design.test.js` checks). Line colours are
classes too (`.line-m1`, for `linePill` in `/js/core/lines.js`), kept the
same as `data/curated/lines.json`'s by that test, so pages have no inline
styles (`csp.test.js` checks). Use Bootstrap's
components (accordion, card, toast, buttons) and utilities, themed through
their `--bs-` variables; `style.css` is for what Bootstrap doesn't have
(the train diagram, the map, arrival badges, the navigation). Bootstrap's
JavaScript is the build without Popper: collapse and toast are all the
pages use.

### Text in two languages

- **Short text**: `{{t "key"}}` in a view, in text or in an attribute
  (`aria-label="{{t "nav.menu"}}"`). Strings live in
  `server/views/strings.json` (shared: navigation, home, menu,
  announcements), `tools/<id>/strings.json` (a tool's) and
  `server/views/stations.json` (station pages), each with `en` and `el`; a
  string missing in Greek shows in English.
- **Longer text** (paragraphs with links, lists): written twice, side by
  side, in `{{#ifLang "en"}}…{{else}}…{{/ifLang}}`.
- **Pages of prose** (about, privacy, terms, contact): one file per language.
- **In the browser**: `/js/core/i18n.js` gives `t(key)`, `language` and
  `localHref(path)`. Each page carries only its own language's strings, and
  only those its scripts use: its own, and the shared `shell.`,
  `announcements.`, `location.`, `favourites.` and `lifts.` ones (`BROWSER_SHARED` in `layout.js`;
  `test/strings-sent.test.js` checks every string the browser's code looks up).
- **Switching**: the language link opens the same page in the other
  language and remembers the choice in `localStorage`; a small script in
  `<head>` sends later visits to that language before the page shows.
- `lang="…"` only marks text in a language other than the page's, such as
  Greek announcements on an English page.

## Browser code

- `public/js/core/`: modules any page can import. `shell.js` runs on every
  page (location, language link, service worker). `i18n.js`, `html.js`
  (`html`, `setHtml`, `safeUrl`, `format`, `localName`, `walkingUrl`,
  `icon`, `formatHtml`), `lines.js` (lines' pills and buses' plates),
  `metro.js` (what the subway page and the station pages share: train
  diagram, central platform badge, stop notes, times),
  `location.js`, `announcements.js`, `lifts.js` (lifts out of service, for
  the subway page and the station pages), `ads.js`.
- `tools/<id>/client/`: a tool's own scripts, served at `/tools/<id>/`.
- **Building HTML**: with ``html`…` `` from `/js/core/html.js`, which escapes
  every value put into it (names from OASA, the strings, numbers) except
  pieces built with ``html`` `` themselves. It goes into the page with
  `setHtml(element, view)`, never by setting `innerHTML` to a string; links
  from data go through `safeUrl()`, so only web addresses are linked. The
  station pages are built the same way on the server. `test/escaping.test.js`
  feeds markup into every name and note and checks it comes out as text.
- **Location** (`/js/core/location.js`): only the pages that use it start it
  (Buses, and Subway when allowed or on "Nearest station"), so the browser
  asks once, where it's clear why. The last position is kept on the device
  for 10 minutes and shared by the pages
  ([decision 19](docs/decisions/0019-privacy-counts-only.md)), and nothing waits for it: pages
  show what they can and update as positions come.
- **Coming back to a tool** (`/js/core/remember.js`): the tools open where
  they were left, for this tab or app session (`sessionStorage`). What's kept
  is the tool's address, where its choices already are: Subway's stations
  (not a boarding station that follows the location) and the bus stop or
  line shown. Only the links marked `data-tool` go back to it: the
  navigation and the home tiles, set by `shell.js` on every page. The link to
  the page you're on starts the tool over, and links that say where they
  go (a station page's "Plan a trip from here", the bus page's way back to
  the stops nearby) work as they always did.
- Scripts import each other by absolute URL (`/js/core/i18n.js`). An import
  map in every page points each of those URLs at its version (`?v=<hash>`;
  [decision 1](docs/decisions/0001-no-build-step.md)).
- Logic without the DOM (route finding in `tools/subway/client/network.js`,
  nearest stops in `tools/buses/client/stops.js`, finding a stop or a line in
  `tools/buses/client/search.js`, which stops the bus page asks for in
  `tools/buses/client/timing.js`) is tested in Node. `/js/core/text.js` has
  `normalise()`, how both searches compare what's typed with names.
- Trips are worked out in the browser
  ([decision 5](docs/decisions/0005-trips-in-the-browser.md)), but
  `html.js`, `metro.js` and `network.js` are also used by the server (the
  station pages), so they only import other files by relative path, which
  works in both.

## Offline

`server/views/sw.js` is the service worker; `service-worker.js` fills in its
version and what it caches at install: the home and offline pages, the files
every page needs, and the tools with `"offline": true` in `tool.json`
(Subway and Info) with their data (`rail.json`). Pages come from the network
first, except those tools, which open from the cache at once and update in
the background. A page fetched because it was opened carries a
`Wayhop-Opened` header, so the server counts it and not the copies cached at
install. `/api` and `/admin` are never cached. Each deploy changes
the version, which replaces the whole cache. A new version installs in the
background and waits (no `skipWaiting`, no reload): open pages keep the
version they started with, and it takes over once they're closed
([decision 6](docs/decisions/0006-offline.md)).

## Live bus times and the load on OASA

[server/oasa/](server/oasa/) is the only code that talks to OASA's live API:

- `client.js`: at most 2 requests a second, in two lanes: someone's first
  look at a stop goes ahead of refreshes. Routes are tried in order:
  direct, the Cloudflare Worker, the home relay ([proxy/README.md](proxy/README.md);
  [decision 8](docs/decisions/0008-routes-and-relays.md)). A route that keeps
  failing rests for a day.
- `arrivals.js`: each stop's arrivals are shared by everyone for 30 s; while
  requests queue for OASA (over 2 s, over 5 s), for 60 s or 90 s, counted
  down and marked stale from a minute old. When OASA can't be reached, the
  last answer is served for up to 5 minutes.
- The bus page ([tools/buses/client/main.js](tools/buses/client/main.js))
  refreshes only the stops on screen, by when their next bus comes: within
  10 minutes every 30 s, 10–20 minutes every 60 s, later or none every 2
  minutes (an opened stop every 30 s), and counts the minutes down in between.
  A stop or a line opened from the search (`?stop=`, `?line=`) asks only for
  the stops opened, every 30 s; searching asks OASA nothing. These rules are
  `dueStops` in `timing.js`, given what the page shows as data;
  `test/browser/bus-trace.spec.js` writes down every request of a scripted
  visit, second by second, so a change to them shows.
- `limits.js`: each visitor may ask for 30 stops a minute that aren't cached.
- `index.js`: `/api/arrivals`, for stops in `bus-stops.json` only.
- `usage.js`: counts what is asked of OASA and how it answers, each minute
  and per day, kept for 120 days in `data/local/oasa-usage.json`: requests
  by kind, the cache's share, stops watched at once, waits and drops, each
  route's answer times and failures, and how far ahead OASA predicts each
  line's buses. Beside them, the pages opened, by the language the browser
  asks for and the one served (`server/pages/index.js`, for item 43).
  Counts only; `/admin/diagnostics` shows the past hour and today,
  `/admin/usage` a row per day.

These numbers set our load on OASA, and so do the ones for STASY and the
bus network below; changes to any of them are agreed first
([decision 7](docs/decisions/0007-load-on-oasa.md)).

Announcements ([server/info/announcements.js](server/info/announcements.js))
are fetched from OASA's RSS and STASY's news page at most every 15 minutes,
only when someone asks, and kept on disk.

Lifts out of service ([server/info/lifts.js](server/info/lifts.js)) come from
STASY's lift page (stasy.gr/elevators) at most every 10 minutes, only when
someone asks, through the relays like its other pages, and are kept on disk; a
copy over 2 hours old isn't served. The subway page warns for the stations a
trip starts, changes or ends at and in the station search, and a station's
page for itself (`public/js/core/lifts.js`). Stations STASY lists no lifts
for (Nerantziotissa, the airport branch) get no warning. The page names every
lift of every station; the station editor offers those names for each
platform's elevators, from the last copy however old. How each platform is
reached without steps, if at all, is recorded by hand (`stepFree` in
`data/curated/positions.json`, also in the station editor): station pages
say it for each platform, and a platform with steps only gets the same
warning in the subway page and its search.

## Timetables and stops

[server/data/](server/data/) downloads OASA's open data (the metro and tram GTFS,
from the CKAN portal) and builds `data/build/rail.json` (metro lines, stations, timetables
and where to stand). Its timetable is one typical week: for each weekday the
next date in the feed, skipping holidays and days on which a line has far
more trains than usual (two timetables laid over each other), and a train the
feed lists twice is kept once. The dates from yesterday to the feed's end
whose trains differ from their weekday's (a holiday, a new timetable) also
get their own, which the planner uses on that date; the typical week is for
every other date, and for all of them once the feed has expired. The GTFS
isn't trusted as it is ([decision 10](docs/decisions/0010-metro-timetable.md)).
The first and last trains from each stop come from STASY's own timetable
pages instead (`stasy.js`): the pages are fetched at most every 14 days
(directly or through the relays, like STASY's announcements,
`server/stasy.js`), and a copy of their tables is kept in `data/raw/stasy/`;
a line whose pages can't be read keeps the GTFS's times. The timetable's
trains outside STASY's first and last trains are taken off (`trimToHours` in
`build-rail.js`). The airport trains the GTFS misses (the last ones) or ends
early come from STASY's airport timetable, copied by hand from its PDFs into
`data/curated/airport.json` (`addTimetabled`), and once a week the build
checks the PDFs haven't changed (`airport-check.js`: STASY's line 3 page and
the two PDFs, through the relays). Each build also checks the timetable it
made against STASY's tables (`rail-checks.js`): a stop without STASY's first
and last trains is a problem, and fails `/api/health`; first or last trains off STASY's (missing
trains), how often trains run against STASY's frequency tables, the dates
with trains of their own and dates the GTFS lays two timetables over (those
keep the typical week) are notes, on `/admin/diagnostics`. The same feed has
the tram: `build-tram.js` adds its lines and stops to `rail.json` (`tram`, the
shape of the metro part without timetables) for the Info page's tram map,
with names and changes to the metro from `data/curated/tram.json`; a problem
there is a warning and leaves the tram out, never the metro. The Info page
draws both maps with one drawer (`tools/info/client/map.js`), each from its
own layout (`map-layout.js`, `tram-layout.js`). The buses come from OASA's
live API instead ([decision 9](docs/decisions/0009-bus-network-from-live-api.md)):
`oasa-network.js` fetches today's lines, their routes and each route's stops,
and `build-bus.js` makes `data/build/bus-stops.json` (every stop on a route
today, its names and lines) and `data/build/bus-lines.json` (each line's
stops in order, there and back). The network is fetched at most once a day,
one request a second through the same routes as the live times (about 600
requests a night: the lines and their routes every night, a route's stops
when it's new or about weekly), and kept in `data/raw/oasa/`. A failed
request is tried again up to 3 times (after 10, 30 and 60 s), and each failure
is logged; each route's stops are saved as they arrive, so a fetch that still
fails is picked up where it stopped by the next build, and meanwhile the last
network is used. The build runs when the server
starts and daily at 04:30 Athens time, in a child process at low priority
(`runBuildInChild`), so it doesn't slow the site or add to its memory. It
downloads only what changed, and the site keeps serving the previous build
if a build fails. A file that comes out the same as the one served is left as
it was (`publish`), so its ETag stays and browsers keep their copy; that's
why `rail.json` and the bus files don't say when they were built or fetched
(`meta.json` does). Where to stand on each
train is curated by hand in `data/curated/` ([README](data/curated/README.md)),
and can be edited from a phone at `/admin/stations`, which nothing may block
([decision 16](docs/decisions/0016-station-editor.md)). Each night a GitHub
workflow (`.github/workflows/station-edits.yml`) reads the editor's export
with `STATION_EXPORT_KEY` and keeps one pull request, `station-edits`, with
the edits the repository doesn't have yet; `scripts/station-edits.js` lists
them.

## Monitoring

`/api/health` (`server/health.js`) says whether the live site works:
- live arrivals have come in recently;
- every announcement source loaded;
- last night's data build worked, and its checks of the metro timetable
  found no problems;
- the metro timetable doesn't end within a week;
- STASY's timetable pages could be read, and its airport timetable hasn't
  changed since `airport.json` (checked weekly);
- each relay runs the current `RELAY_VERSION`;
- the hosting account is well under its thread limit, and no app has old
  copies still running.

It answers 503 with the problems in plain words, without addresses, keys or
error details. Every 30 minutes, `.github/workflows/health.yml` runs
`scripts/health-check.js` against wayhop.gr. It asks what a visitor would
(the home pages, one stop's arrivals, the announcements), then reads the
health page, and rechecks a problem after 2 minutes. While the site is
unhealthy, an issue labelled `health` stays open; GitHub emails it.
`/admin/diagnostics` has the details. How the data stands (the build's age
and parts, the timetable's end, STASY's copy, the airport check) is judged
once, in `server/data/status.js`, so the two always agree.

The hosting account may run 100 threads at once, all its apps together
([decision 12](docs/decisions/0012-shared-hosting.md)).
`server/processes.js` reads `/proc` (which starts no process, so it works
even at the limit): LiteSpeed runs each app as `lsnode:<app folder>`, and a
copy 10 minutes older than the newest copy of its app is left over. The
newest copy of Wayhop stops its own every 5 minutes, the deploy stops every
copy from before the restart (`scripts/stop-old-copies.js`), and the health
page and `/admin/diagnostics` (with the pids) report other apps' leftovers.
A data build runs as a process of its own and ends with `process.exit()`.
The guard also stops any build in Wayhop's folder
still running after an hour, and the health page reports them.

Facts written on the pages by hand (the Info page's closing times, prices,
airport and night buses) say when they were last checked: one date per
section, in `tools/info/data.json`, shown on the page with `{{> checked}}`.
`/admin/diagnostics` warns once a section is over 90 days old, and so does
the nightly live check (`test/live/`), which reads the dates on wayhop.gr.

`server/errors.js` is the last stop for a request whose answer failed: the
error is logged, and the visitor gets the error page (JSON from an API)
without its details. Look things up by an address's part with
`Object.hasOwn`, so `constructor` or `__proto__` in an address finds nothing.

`server/security.js` adds the security headers to every response, including
the Content-Security-Policy from `server/csp.js`
([decision 15](docs/decisions/0015-content-security-policy.md)). The policy is built at
startup from the inline scripts the pages really have (two: the language
redirect, the same on every page, and the import map), allowed by hash; so
don't add inline scripts or `onclick="…"` attributes: put code in a file
(`csp.test.js` fails otherwise). AdSense's hosts are added only when
`ADSENSE_CLIENT` is set. `CSP_MODE` in `.env` chooses `report-only` (the
default for now: browsers report, nothing is blocked) or
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
  the server sends it (`seo.test.js`, `accessibility.test.js`, `design.test.js`,
  `assets.test.js`, `stations.test.js`), the whole server over HTTP
  (`server.test.js`: headers, 404s, caching, the APIs' refusals), and the
  browser code's logic and drawing (loaded by `test/support/browser-modules.js`).
  The tests need no network.
- `npm run test:browser`: the site in real browsers (phone, desktop and
  iPhone), with test data and a fake OASA: every page in both languages
  through axe-core, a keyboard walk and 200% text
  ([decision 13](docs/decisions/0013-accessibility.md)), plus location,
  language, the bus page's requests, the planner at night and offline use.
  See [test/browser/README.md](test/browser/README.md). The app itself is
  `server/app.js`; `server.js` only starts it.
- `npm run lint`: ESLint's recommended checks (`eslint.config.js`).
- `npm run typecheck`: TypeScript checks every file of the app, the scripts
  and the relays against their JSDoc types (`jsconfig.json`). The shapes of
  the data shared by the server and the browser (`rail.json`,
  `bus-stops.json`, `bus-lines.json`, tools, pages) are in `types/`, and what the pages use
  from the browser beyond the DOM (Bootstrap, AdSense) in
  `types/globals.d.ts`. Nothing is compiled, and editors show the types too.
  Where TypeScript can't know which element a query finds, a
  `/** @type {HTMLElement} */ (…)` note says so.

Every night `.github/workflows/nightly.yml` runs `npm run check` on `main`,
and `npm run test:live` (`test/live/`): a few checks against wayhop.gr with
its real data and live bus times, the bus page opened once. Either failing
opens an issue labelled "nightly".

The **Check accessibility** button on `/admin/diagnostics` runs axe-core on
the live pages in your browser.

[test/README.md](test/README.md) maps the whole suite: which kind of test
goes where, what runs on each commit (lint, types, Node tests) and push
(browser tests on one phone, but not the checks of every page) through
`.githooks/`, the coverage floor
(`npm run test:coverage`) and the rule that flaky tests fail.

`node scripts/snapshot.js <folder>` writes every response the server sends
to files; run it before and after a change that shouldn't change any page,
then `diff -r` the two folders.

## Common changes

Every change comes with its tests: new functionality gets new tests,
changed functionality updates the tests that cover it, and a bug fix gets a
test that would have caught it ([CLAUDE.md](CLAUDE.md);
[decision 20](docs/decisions/0020-tests-and-when-they-run.md)).

- **A string**: add it to the right strings file in both `en` and `el`, then
  use `{{t "key"}}` in a view or `t()` in a script.
- **A tool**: copy a `tools/<id>/` folder ([tools/README.md](tools/README.md)).
- **Another page**: add an entry to `sitePages` in `registry.js`, with a
  view in `server/views/`.
- **The layout**: `server/views/layout.hbs` and `server/pages/layout.js`.
- **What works offline**: `"offline"` and `"precache"` in `tool.json`.
