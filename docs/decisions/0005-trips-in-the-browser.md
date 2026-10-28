# 5. Metro trips worked out in the browser

Decided 2026-03-29 · In force

## Situation

The metro is used underground, where the signal is weak or gone. A planner
that has to ask the server fails exactly there.

## Decision

- `rail.json` (the metro's lines, stations and timetable, the dates with
  trains of their own, and where to stand; about 23 KB gzipped) is
  downloaded once, and the browser finds routes itself
  ([network.js](../../tools/subway/client/network.js)).
- The server uses the same module for the station pages.
- Live information (lifts out of service, announcements) comes from the
  server and is added when there is a connection.

## What follows

- The planner works offline and costs the server nothing per trip. Route
  finding is tested in Node.
- The data has to stay small enough for a phone. A build that comes out the
  same leaves the file as it was (#125), so browsers keep their copy.
- Live information can't be shown offline.

## Look again when

- The data needed to plan a trip (with trams and buses) gets too big for a
  phone to download.
