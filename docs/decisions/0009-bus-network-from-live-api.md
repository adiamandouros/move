# 9. Bus lines and stops from OASA's live service

Decided 2026-10-20 · In force

## Situation

OASA's open-data bus timetable fell behind (diversions, new routes), and
stopped being updated in August 2026. Stops and lines built from it no
longer matched the buses that OASA's live times report.

## Decision

- `bus-stops.json` and `bus-lines.json` are built every night from OASA's
  live API: the lines, their routes and each route's stops
  ([oasa-network.js](../../server/data/oasa-network.js),
  [build-bus.js](../../server/data/build-bus.js), #73).
- What is fetched is kept in `data/raw/oasa/`. A route's stops are asked
  for again when it is new or about once a week. While a fetch fails, the
  last network is used, and a fetch that stopped is picked up where it
  stopped.

## What follows

- The stops and lines are the ones OASA's live times use.
- Wayhop reads no bus timetable so far; [11](0011-real-data-first.md) says
  how one may be used.
- The nightly fetch is part of our load on OASA ([21](0021-load-on-oasa-with-trips.md)).

## Look again when

- OASA publishes a bus timetable that keeps up again, or its live API's
  network calls change.
