# 59. The trip page opens with no signal, its answer from the saved copy

Decided 2026-11-17 · In force

## Situation

[24](0024-opening-without-signal.md) had Home, Subway and Info open from the
cache at once and every other page from the network first, for at most 3
seconds with a saved copy. The Trip page was one of the others: nothing of it
was saved when Wayhop installed, so the first time it was opened with no
signal after a deploy it was the offline page, after 8 seconds.

And with a copy saved, the page came after 3 seconds but its answer didn't.
Its searches run in a worker ([32](0032-trip-searches-in-the-background.md)),
and a worker's imports have no `?v=`, so they come from the server first
(#208) and had no time limit at all. On 17 Nov, underground with a trip
planned, the app sat on a black screen for about a minute (Road · 13);
reproduced, it's the dark page saying "Working out the trip…" until the
phone gives up on the request.

## Decision

- What [24](0024-opening-without-signal.md) decided still holds, but for
  what follows.
- The Trip page is kept for offline use like Subway and Info
  (`"offline": true`): its page in both languages, its scripts and those of
  the tools it borrows from (Subway's and Buses'), and `rail.json`,
  `trains.json` and `buses.json`. It opens from the cache at once and updates
  in the background. A trip kept on the device
  ([58](0058-trip-ride-kept.md)) is searched again on the saved data.
- A worker's scripts (asked for without a `?v=`) come from the network first,
  as before, but like a page fall back on the saved copy after 3 seconds.
- Once a request has waited its time for nothing, the network is taken for
  gone for 30 seconds, and a request with a copy saved gets it at once. Any
  answer from the network ends that. Requests are still sent, so a late
  answer is saved for next time.

## What follows

- With no signal the Trip page opens at once and a kept trip's answer comes
  about 3 seconds later, by the timetable and the measured bus rides. Live
  times come back with the signal.
- Each deploy, installing Wayhop downloads `buses.json` again (about 300 KB
  compressed). Home already fetches it on every visit.
- The address search needs the server: with no signal only the places picked
  lately ([56](0056-trip-recent-places.md)) can be chosen.
- The Trip page can be one visit behind after a deploy, as Subway can.
- Its searches' scripts can be an older copy only when the network is gone,
  which the page already handles (#208).

## Look again when

- 3 seconds before the answer underground feels long: it's the first guess
  of [24](0024-opening-without-signal.md), not measured.
- `buses.json` grows enough that downloading it with each deploy matters.
