# 24. Offline, and opening at once with no signal

Decided 2026-11-01 · In force

## Situation

[6](0006-offline.md) had the home page come from the network first. That's
where the installed app opens, and underground a phone often has no signal
but doesn't know it: requests don't fail, they hang. So the app waited on a
request that wasn't coming, with everything it needed already saved, and
Subway could only be reached once that wait was over.

Pages have to open underground, and an update mustn't interrupt someone in
the middle of a trip.

## Decision

- A service worker ([sw.js](../../server/views/sw.js), filled in by
  [service-worker.js](../../server/pages/service-worker.js)) keeps, when it
  installs: the home and offline pages, the files every page needs, and the
  tools with `"offline": true` in their `tool.json` (Subway and Info), with
  their data.
- The home page and those tools open from the cache at once and update in the
  background.
- Other pages come from the network first, but not for ever: after 3 seconds
  a saved copy is shown, and with no copy the offline page is shown after 8.
  The request carries on, so a late answer is saved for next time.
- `/api` and `/admin` are never cached.
- A new version installs in the background and waits until the open pages
  are closed: no `skipWaiting`, no reload (#88).

## What follows

- The app, Subway and Info open without a signal, with no wait.
- The home page can be one visit behind. Its text only changes with a deploy,
  and what's live on it (announcements) is fetched by the page.
- On a connection slower than 3 seconds, a page seen before shows its saved
  copy, even if a newer one was on its way.
- An installed app that is never fully closed can keep an older version for
  a while. Each deploy replaces the whole cache.

## Look again when

- A fix has to reach open pages at once (a wrong timetable, say).
- People on slow connections see old pages or the offline page when the real
  one was nearly there: the 3 and 8 seconds are a first guess, not measured.
