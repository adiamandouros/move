# Wayhop

Copyright (C) 2026 adiamandouros. Licensed under the
[GNU Affero General Public License v3.0 or later](LICENSE) (see [License](#license)).

A web app for getting around Athens by public transport, in English and Greek.
It installs like an app, the subway and info pages work offline, and it
follows the phone's light or dark mode (or your choice in the menu).

## Features

- **Subway**: plan a metro trip (lines 1–3), with the next departures from
  OASA's timetable, first and last trains from STASY's, and which carriage to
  ride in for the exit (an escalator, stairs), the next line or an elevator.
- **Buses**: live arrivals at the stops around you, refreshed every 30
  seconds when a bus is near (less often when the next one is further away);
  any stop by its name or code, and any line with its stops.
- **Info**: service announcements from OASA and STASY, zoomable metro and
  tram maps, closing times, tickets, getting to the airport, night buses,
  accessibility and contacts.
- **Metro stations**: a page for every station, with where to ride for the
  exit, connections and first and last trains.

Every page aims to meet WCAG 2.2 AA (keyboard, screen readers, contrast).

## Setup

Needs Node.js 20 or newer.

```bash
npm install
cp .env.example .env
```

Every setting in `.env` is optional and explained in `.env.example`
(`server/config.js` reads and checks them). Without
any, the app runs locally with everything except live bus times, which need
a Greek IP address or a relay (see [proxy/README.md](proxy/README.md)).

## Running

```bash
npm start            # the app, on http://localhost:3000 (PORT in .env)
npm run dev          # restarts when server, tool or public files change
npm test             # the tests that run in Node
npm run test:browser # the site in real browsers (test/browser/README.md; needs `npx playwright install chromium webkit` once)
npm run check        # lint, type checks and both kinds of tests: what GitHub runs on every pull request
npm run test:coverage # the Node tests with the server code's coverage floor (Node 22+)
npm run test:live    # a few checks against wayhop.gr itself (also nightly)
npm run build:data   # rebuild the timetables and stops now (the app also does it daily)
npm run diagnose     # check that the server can reach OASA, the relays and the data portal
```

On the first start the app builds `data/build/`, which takes a little while;
the subway and bus pages need it. It downloads the metro and tram timetable
from OASA's open data, STASY's first and last trains, and the bus lines and
stops from OASA's live service (which, like live bus times, needs a Greek IP
address or a relay). Then it checks them every night and rebuilds only what
changed.

## Deploying

The live site runs on cPanel. Its Git deployment runs
`scripts/cpanel-deploy.sh` (see `.cpanel.yml`), which installs the packages,
restarts the app and stops any copy of it still running from before
(`scripts/stop-old-copies.js`). The host starts `server.js` with `require()`, so the
server's code can't use top-level `await` (`test/startup.test.js` checks).

## More

- [ARCHITECTURE.md](ARCHITECTURE.md): how the code fits together
- [DESIGN.md](DESIGN.md): how Wayhop looks: tokens, units, colours and their rules
- [tools/README.md](tools/README.md): adding or changing a page like Subway or Buses
- [data/curated/README.md](data/curated/README.md): the hand-maintained station data and its editor
- [proxy/README.md](proxy/README.md): the relays for OASA's live API

## License

- **Code**: the [GNU Affero General Public License](LICENSE), version 3 or
  (at your option) any later version. If you run a changed copy as a website
  or service, you must offer its users the source code of your version.
- **Curated data** (`data/curated/`): [CC BY-SA 4.0](data/curated/LICENSE.md).
- **The Wayhop name and logo** aren't covered by either: see
  [TRADEMARKS.md](TRADEMARKS.md).
- **Other people's code and data**: see
  [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
