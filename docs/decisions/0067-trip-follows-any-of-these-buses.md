# 67. The trip page: followed onto whichever of "Any of these buses" is boarded

Decided 2026-11-21 · In force

## Situation

A way whose last bus can be any of several
([33](0033-trip-half-hour-answer.md), [48](0048-trip-bus-stops-as-buses-rows.md))
lists the stops it can be caught at and their lines, "Any of these buses,
whichever comes first". Underneath it is still one way: the best of the
half hour's departures, with one line from one stop. Following the rider
([50](0050-trip-follows-the-ride.md), [60](0060-trip-follows-within-20-metres.md))
knew only that one.

On the road on Thursday 19 November 2026 (noted 21 November, Road · 15
and Road · 16): from Mithimnis, Korydallos to Mandilara, Aigaleo, about
20:00, the M3 to Aigaleo, then any of the 856, 750 and 703. The rider
walked to the nearest stop and got on the 856. Replayed on the network of
21 November, the way underneath was the 829 from stop 70014. The 856
leaves from two other stops (70083, 70075) along another road. So the
rider was off the way and planned again from the road, the step kept
saying to take one of the buses, and nothing said where to get off.

The rider's calls on 21 November 2026: once on one of them, the step
becomes that bus's ride card; nothing is said about where to get off
before boarding. Built in two pull requests: following first, then the
way and its card.

## Decision

- **Every ride it can be travels with the way**: for each line at each of
  the step's stops, the worker gives that bus's stops from there to its
  stop nearest the door (shortest walk), and the two after it
  (`anyRides` in buses.js, a ride's `any`).
- **Waiting at any of its stops is on the way**: reaching one ends the
  walk, and off the way is then measured from the nearest of them. The
  walk itself is still measured to the way's own stop: the step's stops
  can be a kilometre or more around (16 of them up to 1.2 km away from
  Menelaou 45 to Syggrou-Fix in the test data), so walking towards any of
  them would hardly ever be off the way. In the 19 November case the 856's
  stop was about 110 m from the walk, within its 300 m.
- **Boarded by the same rule as the way's own bus** (50, 60): a fix
  nearer a later stop of one of those rides than its first, within 100 m
  of it (or the fix's accuracy), and nearer it than the walk. Further off,
  after a gap or a minute, within 300 m (Road · 7's rule). With several
  matching, the nearest. Two lines sharing a road from the same stop: the
  rider is taken for one, and moved to the other once the fix is on its
  road and off the first.
- **The way becomes that bus** (the second pull request): the way's last
  ride timed as the line boarded from its stop, its card a bus ride's
  ("Exit at", OASA's minutes, its stops, decision 53), the rider's own bus
  found by OASA's vehicle code at the stop they boarded at
  ([58](0058-trip-ride-kept.md)), the other stops and lines gone. Kept
  with the trip as a ride is (58). No "Back to my route": it is the way.
- **Before boarding, nothing new is shown**: no stop to get off at per
  line (the rider's call).

## What follows

- For OASA: the same stops asked as before. The rider's own bus is asked
  for where the ride boarded actually gets off, in place of where the
  way's own would have.
- The half hour's answer from the worker grows by about 0.5 to 5 KB per
  way with such a bus (measured 21 Nov on real data: 10 rides and 66 stops
  for the Aigaleo step). It's sent from the worker to the page, not over
  the network. The ride kept on the phone grows by the same, three times
  (the walk, the wait and the ride).
- Until the second pull request is in, a rider on another of the rides is
  followed along it but the way is timed as the way's own bus. So the two
  go out together.

## Look again when

- Riders get on a bus that isn't listed (another line along the same
  road): then they are off the way, as before.
- The stop to get off at proves to be needed before boarding after all.
