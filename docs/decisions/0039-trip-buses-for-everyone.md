# 39. The trip page: buses for everyone, and the bus trip finder gone

Decided 2026-11-07 · In force

## Situation

Since [31](0031-trip-page-buses.md) the trip page's ways by bus were behind
a switch, `/trip?buses`, until enough rides were measured
([26](0026-bus-pass-collector.md)) for bus times to be fair to the metro.
Behind it they were searched in the background ([32](0032-trip-searches-in-the-background.md)),
given the next half hour's answer ([33](0033-trip-half-hour-answer.md)),
OASA's live times on the way shown ([35](0035-trip-live-times.md)), the
quicker way on a decision ([36](0036-trip-quicker-way.md)) and one walking
estimate ([37](0037-trip-one-walk.md)).

On 7 November 2026 the rider decided it's time for buses for everyone,
ahead of 31's condition. By then 125 stretches of road had measured rides
(3 to 6 November), so most bus times are still OASA's timetable of August
2026, which is too quick through the centre: Menelaou to Syntagma by the
040 in 21 minutes against 37 by tram, Syntagma to Syggrou-Fix in 2.6
against the rider's 10 to 30 (31). On 5 November the rider had decided that
the bus trip finder on the Buses page goes once the trip page has live
buses (roadmap 13). Everyone would now download `buses.json`: about 325 KB
over the wire (1.57 MB unpacked, measured on 7 November), against
`rail.json`'s 25 KB.

The details were decided in the plan session of 7 November 2026.

## Decision

Everything [37](0037-trip-one-walk.md) decided stands, and:

- **Buses for everyone on `/trip`**: the ways by bus, the next half hour's
  answer in the answer's place, OASA's live times on the way shown and the
  quicker way on a decision. `/trip?buses` is the same page now;
  `/trip?timing` still says how long the searches take on the device.
- **Bus times as they are**: OASA's timetable with "~", measured rides where
  there are enough ([30](0030-bus-timetable.md)), ranked on a usual day (the
  median where measured). Ranking on a bad day, the slowest tenth (roadmap
  Plan 6), comes later, as its own decision, once more rides are measured.
- **No Beta label.**
- **`buses.json` fetched early**: Home, Subway, Buses and the station pages
  fetch it in the background once they've loaded, when the browser is idle
  (`readyBuses`, `/js/core/ready-buses.js`), so the service worker, or the
  browser before it's installed, keeps it by the time someone plans a trip.
  Not on the pages people only read (Info, About, Terms, Contact, Privacy),
  nor on the offline, error and admin pages; not when the browser asks to
  save data, nor offline. The trip page loads it itself when it opens.
- **The bus trip finder is gone** from the Buses page: "Where to?", its
  view, code, strings, tests and its counts on /admin/usage. A link to it
  (`/buses?trip…`) opens the stops nearby. What it did that the trip page
  doesn't, start from a bus stop and list each line's next buses with their
  own countdowns, isn't added for now (roadmap backlog).
- **OASA's numbers** stay as they were, now in [38](0038-load-on-oasa-buses-for-everyone.md).

## What follows

- Every trip is planned with buses. Through the centre a bus can come first
  where the metro is quicker in traffic, as 31 said, until rides are
  measured or the bad day comes. OASA's live times correct when a bus comes
  to its stop, not how long the ride takes.
- A visitor downloads `buses.json` once a day, as it's built each night,
  and for each page opened after that only asks whether it has changed.
- Every visitor's phone makes the day's city and works out the half hour in
  the background: 1.7 to 5.1 seconds on the rider's phone (32).
- The Buses page has no trip search: the Trip tab is where trips are
  planned.
- A service worker from before the searches came from the server first can
  still serve an old copy of them; the page then says Wayhop has been
  updated, and to close it everywhere and open it again.
- A check each night plans a trip on the live site with the real buses
  (`test/live/`).

## Look again when

- Enough rides are measured to rank buses on a bad day (31, roadmap Plan 6).
- Riders find a bus offered first through the centre when the metro is
  quicker.
- The trip page's searches on /admin/usage come close to what 38 allows.
- Riders miss starting from a bus stop, or each line's next buses.
- As [37](0037-trip-one-walk.md) says: walks can be worked out along real
  streets; riders say 16 minutes is too far, or not far enough.
- As [36](0036-trip-quicker-way.md) says: the page follows the rider's own
  ride once they've left; riders find an offer that wasn't quicker, or a
  quicker way that wasn't offered; riders find a bus that would do missing
  because its route has no timetable.
