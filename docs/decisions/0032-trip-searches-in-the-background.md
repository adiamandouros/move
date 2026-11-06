# 32. The trip page: by metro, tram and bus, searched in the background, the buses behind a switch for now

Decided 2026-11-06 · Replaced by [33](0033-trip-half-hour-answer.md)

## Situation

[31](0031-trip-page-buses.md) put buses on the trip page, behind
`/trip?buses`, from the city's search over OASA's timetable of August 2026
([30](0030-bus-timetable.md)). The search ran on the page itself, and the
half hour's answer (one clear way, a decision on the way, or it depends:
roadmap Plan 5) was still to come, waiting on how fast a phone could work it
out.

On 6 November the rider timed four trips on their phone with `/trip?timing`:
the city took 236 to 253 ms to make, once a day; the answer for leaving now
93 to 405 ms; the half hour, a departure every 2 minutes, 1.4 to 5.1 s, and
every minute 2.6 to 9.9 s. Kallithea to Rentis was the slowest. On a
desktop the half hour takes 0.2 to 1.8 s. On the page itself, 5 seconds of
searching is 5 seconds when nothing can be tapped or typed.

## Decision

Everything [31](0031-trip-page-buses.md) decided stands, but for how the
searches run and how `?timing` works:

- **The searches with a bus run in a worker, in the background**
  (`tools/trip/client/worker.js`, `searcher.js`): the day's city, the ways for
  leaving now and the half hour. The page never waits for them while it's
  used. It plans the metro and the tram itself, as before, and doesn't load
  `buses.json`: the worker does.
- **The answer comes in two steps**: the ways for leaving now as soon as
  they're found, then the half hour's answer (on `/trip?timing` only, for
  now: see below). "Working out the trip…" is
  said only for a new trip; the page's refresh each minute keeps the answer
  on show until the new one comes.
- **The half hour is a departure every 2 minutes**, 16 in all, in the app
  and in the lab (`answer.js`, moved from the planner lab into the app). On 4 November's 39
  trips, against every minute: 37 of 39 answers the same, and of the 18 rows
  lost none was in a top 5, in half the time.
- **Only the latest trip is answered.** A half hour pauses after each
  departure: another trip stops it; the same trip asked again a minute later
  doesn't.
- **`/trip?timing`** says how long the city and the answer took on the
  device, and then the half hour: how long it took in the background and
  what kind of answer the trip has. It's the only page that works out the
  half hour for now, as nothing else shows it yet.
- **A worker's imports have no `?v=`**, as the page's import map doesn't reach
  a worker: the page starts it at its version (`import.meta.resolve`), and
  the service worker fetches scripts asked for without one from the server
  first, so they're the same deploy as the page, and from the cache only
  with no connection.
- **Without a worker, or if it fails**, the trip is by metro and tram, and
  says the bus times couldn't be loaded, as when `buses.json` can't be.

## What follows

- Typing and tapping on the trip page never wait for the buses, on any
  phone; the half hour costs a phone up to about 5 seconds of work per new
  trip, in the background.
- The half hour's answer is worked out but not shown to riders yet. How it
  shows beside the ways for leaving now (the trip answers mock-up of 3
  November) is the next step, agreed before it's built.
- As before, there's no time limit on the buses: with no signal and no saved
  copy of `buses.json`, "Working out the trip…" stays. The page itself now
  opens and takes places meanwhile; before, it waited for `buses.json` to start.
- A worker's 8 scripts are asked for again each time `/trip?buses` opens
  (no `?v=`, so nothing kept for good): a quick "not changed" when they
  haven't.
- The two walking estimates of [31](0031-trip-page-buses.md) are still both
  there.

## Look again when

- The half hour's answer is shown to riders.
- Live times reach the trip page.
- Enough rides are measured: then buses for everyone, as
  [31](0031-trip-page-buses.md) says.
