# Move

Copyright (C) 2026 adiamandouros. Licensed under the [GNU General Public License v3.0](LICENSE).

A Progressive Web App for Athens public transportation. Provides real-time bus arrivals near your location and a metro route planner with car positioning guidance.

## Features

### Nearby Buses
- Uses device geolocation to find bus stops around you
- Shows upcoming arrivals with live countdown timers
- Color-coded badges: arriving soon (≤3 min), close (≤8 min), later
- Auto-refreshes every 20 seconds
- Links to Google Maps walking directions for each stop

### Subway Position
- Route planner for the Athens Metro (M1, M2, M3) and Tram (T6, T7)
- Autocomplete station search in English and Greek
- Finds direct and single-transfer routes
- Shows which train car to board for the best exit position at your destination
- Displays elevator locations within each car
- Shows next 2 departures based on a locally-built GTFS schedule

## Setup

### Requirements
- Node.js
- An OASA API URL

### Installation

```bash
npm install
```

Create a `.env` file:

```
OASA_API_URL=https://your-api-url-here
```

### Running

```bash
npm start        # Production
npm run dev      # Development (auto-restart on file changes)
```

The app runs on `http://localhost:3000` by default. Set `PORT` in `.env` to override.

## How It Works

**API proxy** — The Express server forwards all `/api/*` requests to `OASA_API_URL`, keeping the API URL out of the client.

**Metro schedule** — On startup, the server checks whether the locally-cached GTFS schedule is stale. If so (or on first run), it downloads the official Athens GTFS feed and builds `public/data/metro-schedule.json`. A cron job rebuilds it every Monday at 3:00 AM.

**Service worker** — Static assets are cached on install for offline use. API calls are never cached. The metro schedule uses network-first so server rebuilds reach clients. The page auto-reloads when a new service worker version activates.

## Project Structure

```
public/
├── index.html
├── sw.js                     # Service worker
├── css/style.css
├── js/
│   ├── app.js                # Entry point
│   ├── location.js           # Shared geolocation
│   ├── i18n.js               # EN/EL translations
│   ├── tools/
│   │   ├── nearbyBuses.js
│   │   └── subwayPosition.js
│   └── data/subway.js        # Static metro network data
└── data/metro-schedule.json  # Generated — do not edit manually
server/
├── scheduler.js              # Cron job
└── schedule-builder.js       # GTFS → JSON parser
server.js
```
