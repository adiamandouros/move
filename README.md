# Wayhop

Copyright (C) 2026 adiamandouros. Licensed under the
[GNU Affero General Public License v3.0 or later](LICENSE) (see [License](#license)).

A web app for getting around Athens by public transport, in English and Greek.
It installs like an app, and the subway and info pages work offline.

## Features

- **Subway**: plan a metro trip (lines 1–3), with the next departures from
  OASA's timetable and which part of the train to ride in for the exit, the
  next line or an elevator.
- **Nearby buses**: live arrivals at the bus stops around you, refreshed
  every 30 seconds when a bus is near (less often when the next one is
  further away).
- **Info**: service announcements from OASA and STASY, a zoomable metro map,
  closing times, tickets, getting to the airport, night buses, accessibility
  and contacts.
- **Metro stations**: a page for every station, with where to ride for the
  exit, connections and first and last trains.

Every page aims to meet WCAG 2.2 AA (keyboard, screen readers, contrast).

## Setup

Needs Node.js 20 or newer.

```bash
npm install
cp .env.example .env
```

Every setting in `.env` is optional and explained in `.env.example`. Without
any, the app runs locally with everything except live bus times, which need
a Greek IP address or a relay (see [proxy/README.md](proxy/README.md)).

## Running

```bash
npm start            # the app, on http://localhost:3000 (PORT in .env)
npm run dev          # restarts when server, tool or public files change
npm test             # every test
npm run check        # lint, type checks and tests: what GitHub runs on every pull request
npm run build:data   # rebuild the timetables and stops now (the app also does it daily)
npm run diagnose     # check that the server can reach OASA, the relays and the data portal
```

On the first start the app downloads OASA's open data and builds
`data/build/`, which takes a little while; the subway and bus pages need it.

## Deploying

The live site runs on cPanel. Its Git deployment runs
`scripts/cpanel-deploy.sh` (see `.cpanel.yml`), which installs the packages
and restarts the app.

## More

- [ARCHITECTURE.md](ARCHITECTURE.md): how the code fits together
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

Additional permission under GNU AGPL version 3 section 7: if you modify this
program, or any covered work, by linking or combining it with node-unrar-js
(or a modified version of that library), containing parts covered by the
terms of the unRAR license, the licensors of this program grant you
additional permission to convey the resulting work.
