# 33. The trip page: the next half hour's answer in place of the answer for leaving now, the buses behind a switch for now

Decided 2026-11-06 · In force

## Situation

Since [32](0032-trip-searches-in-the-background.md) the trip page answers
in two steps: at once, the quickest way for leaving this minute; a few
seconds later the worker has the next half hour's answer (`answer.js`: one
clear way, a decision on the way, or it depends), shown only as a line on
`/trip?timing`.

The two often disagree. On the rider's four trips on the live data
(Wednesday 08:30 and 13:00, Friday 20:00), from Syntagma to Menelaou in
Kallithea the 040 straight there came first for leaving now, while over
the half hour "the M2 to Syggrou-Fix, then any bus" was the clear way,
within 3 minutes of the quickest on 94% of departures; from Kallithea to
Rentis it always depended on when you leave. The answer for leaving now
rests on one timetable connection, which buses rarely keep to.

A way whose last bus can be any of several is caught at more than one
stop: after the M2 at Syggrou-Fix the 12 buses to Menelaou leave from 5
stops around the station, and from a house in Korydallos the 4 to
Keratsini from 13 within 15 minutes' walk.

Agreed with the rider on 6 November, on sketches of their trips.

## Decision

Everything [32](0032-trip-searches-in-the-background.md) decided stands,
but for what the page shows once the half hour comes:

- **On `/trip?buses` the half hour's answer takes the place of the answer
  for leaving now**, as in the trip answers mock-up of 3 November. Until it
  comes, the answer for leaving now says "Checking the next half hour…".
- **The way it stands for comes first**: the clear way, the directions that
  stay on for a decision (which isn't mentioned, as agreed on 3 November),
  or the first by the weights when it depends, said above it as "It
  depends on when you leave."
- **Its time is a range**: the half hour's departures, the quickest and the
  slowest tenth left out, with "Best on most departures" for a clear way.
  The note under the trip says what a range is.
- **A last bus that can be any of several shows every stop it leaves
  from**, nearest first, each with the walk to it and its lines: the
  nearest 3, the rest behind "N more stops". No time by the clock for it,
  and no "a bus every N minutes": across several stops that would mislead.
  Other rides keep their times, a bus's with "~".
- **The other ways** follow on a line each, with their ranges: up to 3 ways
  in all, by the weights, leaving out any never within 3 minutes of the
  quickest on any departure.
- **Times follow the clock**: each way is shown as it is for the next
  departure tried (one up to a minute ago still counts), and the half hour
  is worked out again every 10 minutes while the page is open.
- **The answer for leaving now stays** when walking is quicker, when the
  trains have stopped for the night, or when the half hour finds nothing.
- **Focus isn't taken away**: if it's inside the answer when the half hour
  comes, the redraw waits for the next minute's refresh, as the refresh
  does. A screen reader hears "Updated for the next half hour" with the
  range.

## What follows

- On `/trip?buses` a rider sees a range, not an arrival time, for the way
  to take, and for a bus that can be any of several, the stops instead of
  one bus and its time.
- The answer can change a few seconds after it first shows: said by
  "Checking the next half hour…".
- The half hour costs the phone 1.5 to 5 seconds of work in the background
  for each new trip, and again every 10 minutes while the page is open.
- The quicker way offered on a decision (get off for a bus that comes in
  time) still waits for live times.

## Look again when

- Live times reach the trip page.
- Enough rides are measured: then buses for everyone, as
  [31](0031-trip-page-buses.md) says.
- The rider's tries say the change after the first answer confuses, or a
  stop list is too long to use.
