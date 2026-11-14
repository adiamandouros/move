# 53. The trip page: a bus ride timed by OASA where it gets off, and its stops on the way

Decided 2026-11-14 · In force

## Situation

Since [35](0035-trip-live-times.md) the way shown in full is timed with
OASA's live times, but only where a bus is boarded. A bus OASA has coming
boards then, and the ride from there takes as long as the timetable's ride
from then: the measured rides where there are enough of them (Plan 3),
August's timetable everywhere else. The stop where the rider gets off was
asked about only once they were followed on their own bus
([50](0050-trip-follows-the-ride.md)), for that vehicle. So before
boarding, the time after a bus ride (the next ride, the walk, "Arrive
14:52") was an estimate, while OASA could already say when that bus
would get there.

The rider's ask from the road on 13 November 2026 (roadmap Road · 5): a bus
ride on the trip page should end as a metro card does, "Exit at …" on the
left and "18′ · 12 stops" on the right, with "12 stops" opening the stops
on the way. In the plan session of 14 November they asked for the
minutes to be OASA's, not the timetable's: the bus boarded, found
again where they get off.

## Decision

Everything 50 decided stands, and:

- **Where a bus ride gets off is asked too**, for each bus ride of the way
  shown in full that's timed as one ride (not a last bus that can be any of
  several, which isn't). It's asked right after the stop it boards at, in the
  same rounds, on the same tiers (the Buses page's 30 s, 60 s, 120 s, by
  when the bus boarded is due), within the same 10 stops a way.
- **The bus boarded, by OASA's code for its vehicle**, due at that stop
  after it boards: the ride gets off then, and the rest of the way is timed
  from it. Not listed there (too far ahead, another vehicle, no code), the
  ride takes as long as before.
- **A bus ride's foot is a metro card's** (`leg-action`, the same classes
  and words as [46](0046-trip-rail-rides-as-cards.md)'s card): "Exit at"
  and the stop on the left; on the right, the ride's minutes, with no "~"
  when they are OASA's and with "~" otherwise, then "N stops", a button
  that opens the stops on the way. The line "N stops to …" goes.
- **The stops on the way** are the metro card's list on a grey strip, as a
  bus has no line colour. Each stop is linked to its row on the Buses page,
  and has the pills of the metro and tram lines at a station within 150 m
  of it. The list stays open or closed as the rider left it through the
  minute's redraw, as a card's stations do. It's the stops of the line the
  way is timed on, as the count always was.

## What follows

- At most twice the requests per bus ride shown in full: with its bus 10
  minutes away or less, 4 a minute instead of 2; 20 minutes or less, 2
  instead of 1; later, 1 instead of a half. The server's 30-second copy of
  each stop is shared, so riders on the same stops cost no more.
- Followed on their own bus, the stop the rider gets off at has usually
  been asked already, so it isn't new. /admin/usage's "Trip page stops asked
  for the rider's own ride" now counts mostly the search ahead's stops
  (T14). The stop is still asked for their vehicle on the tiers, as the
  Trip page's.
- On a long "any of these buses" way, a get-off stop can take the place of
  the tenth stop asked. That needs a bus ride before it and nine stops or
  more to choose from, which is rare.
- The order of the ways is unchanged. The half hour's answer still ranks
  them by the measured and timetable rides. Only the way shown in full is
  timed by OASA.

## Look again when

- /admin/usage's Trip page counts, a day or two after, against the numbers
  above.
- The rider wants the ways ranked by OASA's times too (their question of 14
  November). That means asking for every way's stops, a much bigger load,
  so it needs a design talk of its own, beside the roadmap's Bad day item.
- Riders followed on a bus want the stop they're at marked in the list.
