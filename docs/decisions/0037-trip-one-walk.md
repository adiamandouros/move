# 37. The trip page: one walking estimate, the straight line × 1.4, the buses behind a switch for now

Decided 2026-11-07 · In force

## Situation

Since [23](0023-trip-page.md) the trip page has timed a walk to the metro or
the tram as the straight line plus a third (× 1.3) at 80 m a minute, a first
guess. The city's search ([28](0028-trip-search.md)), which finds the ways
with a bus on `/trip?buses`, times its walks as the straight line × 1.4: 200
walks checked against a street router on 1 November 2026 came out at 1.38
times it. So the page had two walking estimates, and a walk to the same stop
could take different minutes in two options. [31](0031-trip-page-buses.md)
said one of them had to go once the buses are for everyone, which the rider
decided on 7 November is next.

The walks also decide which stations are tried: every station or tram stop
within 15 minutes' walk ([29](0029-trip-page-tram.md)), and every bus stop
within the same. At × 1.4, 15 minutes reach about 860 m of straight line
instead of 920.

Measured on 7 November 2026 on 31's set (400 random trips within 10 km of
Syntagma, at 08:30 and 13:00 on Wednesday 21 October, 800 in all), by metro
and tram, against the page as it was:

| Walks, and stops tried within | Stops near either end, all trips | Trips with fewer | First option changed |
|---|---|---|---|
| × 1.3, 15 minutes (as it was) | 5,528 | | |
| × 1.4, 15 minutes | 5,428 | 84 | 67 (8.4%) |
| × 1.4, 16 minutes | 5,512 | 14 | 64 (8.0%) |

With 15 minutes, 4 first options got there later than with 16, by 1 to 20
minutes: from Menelaou in Kallithea the T6 from Aigaiou (16 minutes away) was
no longer tried, and a T7 way from Katechaki to Argyroupoli was lost. With the
buses too, as on `/trip?buses`, 16 minutes changed 39 first options against
15, 23 of them getting there sooner (a median 2 minutes).

## Decision

Everything [36](0036-trip-quicker-way.md) decided stands, and:

- **One walking estimate**: every walk the page times, to a station or a
  stop, from it to the door, between stops in the city's search and door to
  door, is the straight line × 1.4 at 80 m a minute (`walkMeters` in
  `tools/subway/client/city.js`), shown as an estimate, as before.
- **Stations, tram stops and bus stops within 16 minutes' walk are tried**,
  as far as 15 minutes reached at × 1.3: one number for both
  (`NEAR_MINUTES` in `tools/trip/client/plan.js`, which `buses.js` uses).
- **The walks between stations** in `rail.json` and `tram.json` (the straight
  line × 1.3 and 2 minutes to reach the platform, [25](0025-trams-in-the-planner.md))
  stay as they are until they're timed on field trips.

## What follows

- A walk shows about 8% more minutes than before: one of 15 minutes is now
  16. Where a trip's first option stays the same (736 of 800), it gets there
  a median 3 minutes later on the page, the walk being longer, not the trip.
- The first option changes on about 8% of trips, mostly for one with less
  walking. "Walking is quicker" came up on 2 trips that didn't have it, and
  went from 6 that did.
- The page loads `city.js` (8 KB) for the walk, besides `network.js` and
  `raptor.js`, which it loaded already.
- A walk to a station and a walk between two stations are worked out
  differently until the second are timed on field trips.

## Look again when

- Walks can be worked out along real streets.
- Riders say 16 minutes is too far, or not far enough.
- The buses are for everyone, not only on `/trip?buses`.
- As [36](0036-trip-quicker-way.md) says: the page follows the rider's own
  ride once they've left; riders find an offer that wasn't quicker, or a
  quicker way that wasn't offered; enough rides are measured; riders find a
  bus that would do missing because its route has no timetable.
