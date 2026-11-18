# 60. The trip page follows the rider within 20 metres, or the fix's accuracy, and off the way at 100 by bus

Decided 2026-11-17 · Replaced by [62](0062-other-ways-timed-by-oasa.md)

## Situation

[50](0050-trip-follows-the-ride.md) set three distances for following the
rider on the Trip page, kept by [53](0053-trip-bus-ride-from-oasa.md):

- the rider has left the start, and the way shown in full is theirs, 100 m
  from it;
- they're at a stop, a station or the door within 100 m of it;
- until the way shown can be followed (walking is quicker, no answer yet),
  the trip is planned again once they're 200 m from where it was planned,
  at most every 2 minutes ([45](0045-load-on-oasa-my-location-follows.md)).

Off the way was 300 m from every point of the step the rider is on, for a
minute, whatever the step.

From the road, 17 November 2026: 100 m is far too long. The rider walks a
block before the page starts following, and a step is done well before
they get there. And 300 m off is huge.

The steps are straight lines, as Wayhop has no streets or tracks: a walk
from its start to its end, a ride from stop to stop. A walk along the
streets can be hundreds of metres from its straight line (across a grid,
700 m east and 700 m north, the corner is 500 m from it), and so can a
suburban train from the line between stations kilometres apart. A bus,
a trolley or a tram stops every 300 to 400 m, so its road keeps near the
line between them.

## Decision

Everything 53 decided stands, but each of the three distances is 20 m, or
the fix's own accuracy when that's worse (`within` in
[follow.js](../../tools/trip/client/follow.js)). Agreed with the rider on
17 November 2026, who knew it would change how often OASA is asked and
accepted that.

GPS in the city's streets wanders 10 to 30 m while the phone stands still,
so a flat 20 m would have the rider leave the start, or arrive at a stop,
without moving. A fix the phone says is good to 35 m has to be 35 m from
the start to count as left, and counts as at a stop 35 m away. A position
with no accuracy (the one kept on the device between pages) counts as 20 m.

Off the way (for a minute, as before) is 100 m, or the fix's accuracy,
while waiting at a stop and on a bus, a trolley or a tram
(`OFF_CLOSE_METRES`); on a walk, the metro and the suburban railway it
stays 300 m.

On a walk to a ride, a fix nearer one of the ride's later stops than its
first, within 100 m (or the accuracy) of the ride and nearer it than the
walk, puts the rider on the ride at that stop at once: the stop's place
can be off where people wait, so no fix at the stop counted, and the bus
has left. Only while still within the walk's 300 m: further off, a single
fix could be a stray one, and Road · 7's rule (after 2 minutes without a
fix, or a minute off the walk) places them.

A fix less exact than 200 m still places nobody, and standing still is
still 50 m for 10 minutes.

Agreed as a start: the rider's notes of 17 November for a redesign go by
speed and direction instead (on a ride once moving like a train or a bus,
over 25 km/h the right way; walked once 100 m from the stop never going
faster), on the roadmap.

## What follows

- For OASA, only the re-plan before a way can be followed changes. At a
  walking pace (about 80 m a minute) 200 m took about 2½ minutes, so it
  re-planned about every 2½ minutes; now the 2 minutes are what limits it:
  at most a quarter more re-plans while walking with no way to follow, and
  none more on a bus or a train, which already went 200 m in 2 minutes.
  Such a trip mostly has no bus stops to ask (walking is quicker), and a
  re-plan's stops still ask only those new to the way. Standing still asks
  nothing new.
- Following starts within a few steps of the start when GPS is good, and
  after up to the fix's accuracy when it isn't.
- A walk is done only once the rider is at its stop, its station or its
  exit, so the step marked is the walk until they're there. Getting off a
  bus 50 m from the station, the walk to it is the step until they reach it.
- Where a stop's position in OASA's data is more than about 20 m from where
  people wait, and GPS is good, the walk to it stays the step while the
  rider waits; the first fix by the bus's road a stop on boards them.
- Walking up a street parallel to the bus's road, within 100 m of it and
  past the stop, counts as boarding: without speed that can't be told from
  the bus. The redesign's speed settles it.
- Waiting, or on a bus or a tram, a minute 100 m away plans the trip again,
  so a re-plan comes sooner than at 300 m: a rider who walked off is
  offered stops near where they are.

## Look again when

- The redesign by speed and direction (roadmap): it replaces the
  distances here.
- Riders find the walk to a stop still marked while they wait at it, or
  boarded while walking beside the road.
- Riders on a bus or a tram planned again while on it: a road far from the
  line between its stops.
- Riders find following starts, or a step ends, while they stand still:
  phones reporting an accuracy better than their fixes really are.
- /admin/usage's re-plans column, against the quarter more above.
