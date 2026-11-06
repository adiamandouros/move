# 31. The trip page: by metro, tram and bus, the buses behind a switch for now

Decided 2026-11-05 · Replaced by [32](0032-trip-searches-in-the-background.md)

## Situation

[29](0029-trip-page-tram.md) planned the trip page's trips by metro, tram and
on foot. Version 1 needs buses, and the pieces are in the app now: the
buses' timetable ([30](0030-bus-timetable.md)) and the search over the whole
city, with the ways a rider could choose from and the weights that put them
in order (#206, agreed with the rider rules on 3 November 2026, roadmap
Plans 5 and 6).

The timetable is OASA's of August 2026, which spreads each trip's time
evenly along its route. On it, buses come first on most trips through the
centre: from Menelaou in Kallithea on a Wednesday at 10:00, the 040 gets to
Syntagma in 21 minutes against 37 by tram, and to the Acropolis in 16
against 36. Riders know the centre's traffic says otherwise: Syntagma to
Syggrou-Fix takes 10 to 30 minutes by bus, not the timetable's 2.6. The ride
times the server measures ([26](0026-bus-pass-collector.md)) put that right
stretch by stretch, but on 5 November they covered 108 stretches.

## Decision

- **Ways with a bus come from the city's search, for leaving now**, beside
  the metro and tram options the page has made since 29, which stay as they
  are. A stop within 15 minutes' walk of either end is tried, as a station is.
- **All of them in order by what they cost a rider** (`weights.js`): the
  minutes to the door, a minute on foot counting as 1.5 and each change as 3
  more, and for a way with a bus a tight change on foot as the chance of
  missing it. A bus is timed on a usual day (the median ride, where measured)
  until `buses.json` has a bad day. Three are shown, as before.
- **The same ride on different buses is one option**: between the same two
  stops, any line, timed by the first to come, showing each line. It says
  where the bus goes only when one line rides it.
- **A bus's time says "~"** and the note under the trip says in words that
  bus times are estimates from August's timetable ([11](0011-real-data-first.md)).
- **Buses only on `/trip?buses` for now**, until enough rides are measured
  for their times to be fair to the metro. Everyone else gets the metro and
  the tram, and doesn't download `buses.json`. The switch isn't remembered, so
  nothing more is kept on the device.
- **`/trip?timing`** turns the buses on and says how long they took on that
  device: the city made, the answer, and on demand a half hour of
  departures, every 2 minutes and every minute, for the choice of how the
  half hour's answer comes (roadmap Plan 7).
- **The city is made once a day, on the day's first trip**, behind "Working
  out the trip…", not while the places are being typed.

## What follows

- Ordering by the weights moves the first option for everyone, with or without
  buses: on 400 random trips within 10 km of Syntagma, at 08:30 and 13:00 on a
  Wednesday, the first metro or tram option changed on 4%, arriving a median 0
  to 1 minute later and at most 5, for less walking or a change fewer.
  "Walking is quicker" changed on none.
- On a desktop, the city takes about 190 ms to make, and a trip's ways 40 to
  120 ms; a phone is measured with `?timing`.
- Two walking estimates on one page: the metro options' straight line × 1.3
  (29), the city's × 1.4 (measured against a street router on 1 November).
  One of them has to go when the buses are on for everyone.
- A way with a bus has no "where to stand" yet, no live times (roadmap Plan 7,
  OASA's numbers proposed first), and no half hour's answer.
- Starting from a bus stop isn't possible: the search finds addresses, places
  and stations. The bus trip finder on the Buses page goes once the trip page
  has live buses (roadmap 13).

## Look again when

- Enough rides are measured: then buses for everyone, ranked on a bad day,
  with a page of its own.
- The phone test says how the half hour's answer can come.
- Live times reach the trip page.
