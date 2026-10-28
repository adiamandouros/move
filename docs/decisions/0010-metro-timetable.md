# 10. The metro timetable: the open data, held to STASY's

Decided 2026-10-20 · In force

## Situation

The open-data timetable for the metro and tram can't be fully trusted. It
lists depot runs STASY doesn't publish, misses some late airport trains,
lays two timetables over each other on some dates, and knows nothing of
temporary works.

## Decision

- The build makes one typical week (each weekday's next normal date), plus
  the dates whose trains differ, such as holidays
  ([build-rail.js](../../server/data/build-rail.js), #83).
- First and last trains come from STASY's own timetable pages, fetched at
  most every 14 days and kept in `data/raw/stasy/`. Trains outside them are
  taken off, so the planner never offers a depot run (#79–#82).
- The airport trains the feed misses come from STASY's PDFs, copied by hand
  into `data/curated/airport.json` and checked against STASY once a week
  (#84).
- Every build checks what it made against STASY's tables
  ([rail-checks.js](../../server/data/rail-checks.js), #85). A stop without
  STASY's hours fails `/api/health`; smaller differences are notes in
  `/admin/diagnostics`.
- Temporary works aren't modelled; the announcements cover them.

## What follows

- The planner and the station pages agree with what STASY publishes.
- When the feed ends, its last typical week is kept for every date, and the
  pages say the timetable is old.

## Look again when

- The feed changes shape, or STASY publishes a timetable feed of its own.
