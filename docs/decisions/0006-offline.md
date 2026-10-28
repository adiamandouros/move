# 6. Offline: what is kept, and updates that never reload a page

Decided 2026-10-21 · In force

## Situation

Pages have to open underground, and an update mustn't interrupt someone in
the middle of a trip.

## Decision

- A service worker ([sw.js](../../server/views/sw.js), filled in by
  [service-worker.js](../../server/pages/service-worker.js)) keeps, when it
  installs: the home and offline pages, the files every page needs, and the
  tools with `"offline": true` in their `tool.json` (Subway and Info), with
  their data.
- Pages come from the network first, except those tools, which open from
  the cache at once and update in the background. `/api` and `/admin` are
  never cached.
- A new version installs in the background and waits until the open pages
  are closed: no `skipWaiting`, no reload (#88).

## What follows

- Subway and Info open without a signal.
- An installed app that is never fully closed can keep an older version for
  a while. Each deploy replaces the whole cache.

## Look again when

- A fix has to reach open pages at once (a wrong timetable, say).
