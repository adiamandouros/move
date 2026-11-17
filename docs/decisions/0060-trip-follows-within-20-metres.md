# 60. The trip page follows the rider within 20 metres, or the fix's accuracy

Decided 2026-11-17 · In force

## Situation

[50](0050-trip-follows-the-ride.md) set three distances for following the
rider on the Trip page, kept by [53](0053-trip-bus-ride-from-oasa.md):

- the rider has left the start, and the way shown in full is theirs, 100 m
  from it;
- they're at a stop, a station or the door within 100 m of it;
- until the way shown can be followed (walking is quicker, no answer yet),
  the trip is planned again once they're 200 m from where it was planned,
  at most every 2 minutes ([45](0045-load-on-oasa-my-location-follows.md)).

From the road, 17 November 2026: 100 m is far too long. The rider walks a
block before the page starts following, and a step is done well before
they get there.

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

A fix less exact than 200 m still places nobody, off the way is still
300 m for a minute, and standing still is still 50 m for 10 minutes.

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
  rider waits. Once on the bus, they're placed on it when a fix after 2
  minutes without one, or a minute's fixes 300 m off the walk, put them on
  the ride ([50](0050-trip-follows-the-ride.md), Road · 7).

## Look again when

- Riders find the walk to a stop still marked while they wait at it, or on
  the bus: a stop's position too far from where people wait, so a walk's
  end may need its own distance, or the ride counted as boarded from the
  walk as from waiting.
- Riders find following starts, or a step ends, while they stand still:
  phones reporting an accuracy better than their fixes really are.
- /admin/usage's re-plans column, against the quarter more above.
