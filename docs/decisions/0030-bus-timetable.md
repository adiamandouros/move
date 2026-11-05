# 30. The buses' timetable: OASA's last feed, on today's routes, with the rides we measure

Decided 2026-11-05 · In force

## Situation

Version 1's planner needs buses, and a search needs times for them before
OASA predicts any ([11](0011-real-data-first.md)). The only bus timetable
OASA publishes is its open-data feed, and it stopped in August 2026: its
last copy, published on 6 August, was for 3 to 24 August, a summer service.
Its trips and stop times now come as RAR archives, which the data build
doesn't open, so the build stopped reading it, and the bus lines and stops
come from OASA's live service instead ([9](0009-bus-network-from-live-api.md)).
The feed also spreads each trip's time evenly along its route: it gives
Syntagma to Syggrou-Fix 2.6 minutes, where riders see 10 to 30.

The planner lab ([scripts/planner-lab/](../../scripts/planner-lab/README.md))
put the feed on the live routes (#184) and replaced its times with ones
measured from the buses the server sees pass (#186,
[26](0026-bus-pass-collector.md)). The browser needs the same, for any day of
the week, in a file small enough for a phone.

## Decision

- **The feed's week is kept in the repository**, converted once
  (`scripts/bus-feed.js` → `data/oasa/bus-timetable.json`, 1.5 MB): each
  route's stop lists, their trips by weekday, and the days with the same
  trips sharing them. Only a new feed from OASA changes it; the same script
  converts that.
- **Each night the data build puts it on today's routes**
  ([bus-timetable.js](../../server/data/bus-timetable.js)), as the lab did:
  each of the feed's stop lists goes on the live route of its line it shares
  the most with, a moved stop is timed by how far along the road it is, and a
  live route the feed has no times for (74 on 5 November 2026) is left out
  of the search, never given made-up times.
- **And it takes the ride times we measure** where a stretch has at least 3
  rides at that hour on that kind of day (weekday, Saturday, Sunday): their
  median. The feed's times stay everywhere else.
- **It's published as `/data/buses.json`**, the stops and every day of the
  week, about 310 KB once gzipped: a trip's time to each next stop to the 10
  seconds, as the metro's are, and each trip's start after the one before
  it. Built, checked and kept like the other files: one that fails its
  checks, or comes out much smaller than the last, isn't published.

## What follows

- Nothing on the site reads it yet: the trip page's search takes it next
  (roadmap Plan 7).
- It asks OASA for nothing new: the network is the one fetched each night,
  and the rides come from the stops visitors and the collector already ask
  for.
- The times are a summer's, spread evenly along each route, wherever no
  rides are measured yet. Shown to riders, they're estimates and say so
  ([11](0011-real-data-first.md)).
- Holidays aren't known: the feed's dates are long past, so a day runs as its
  weekday.
- The lab builds its day of buses from the same code and file.

## Look again when

- OASA publishes a new feed, or a timetable from its live service turns out
  worth reading (item 37).
- Enough rides are measured that the feed's times hardly matter.
- The file grows past about 500 KB gzipped, which a phone shouldn't have to
  download on every new copy.
