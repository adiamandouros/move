# 35. The trip page: OASA's live times on the way shown in full, the buses behind a switch for now

Decided 2026-11-06 · Replaced by [36](0036-trip-quicker-way.md)

## Situation

Since [33](0033-trip-half-hour-answer.md), `/trip?buses` shows the next half
hour's answer: the way to take with a range, its rides at the timetable's
times (a bus's with "~", as it comes from OASA's timetable of August 2026),
and a last bus that can be any of several as every stop it leaves from,
nearest first. The rider tried it on their phone on 6 November 2026: the
change a few seconds in reads well, and the stop lists can be used on the
street.

The timetable's bus times are estimates, and buses rarely keep to them. A
rider at the door wants to know when their bus is coming, and when a bus can
be any of several, which stop's comes first. The rider's rule, 6 November:
those stops are listed by when their next bus comes, not by the walk.

Agreed with the rider on 6 November, in a plan session. How much it asks
of OASA is in [34](0034-load-on-oasa-with-live-trips.md).

## Decision

Everything [33](0033-trip-half-hour-answer.md) decided stands, but for the
way shown in full, when it has a bus:

- **It's timed again with OASA's live times, for leaving now**, in the
  worker (`liveWay` in `tools/trip/client/buses.js`). Each ride is timed from
  when the rider can be at its stop: a bus OASA has coming that the rider can
  still catch boards then, and takes as long as the timetable's ride from
  then; the rides after it are the timetable's first from there. Any other
  ride is the timetable's, as before.
- **A bus is matched by OASA's route**, not only its line: a route of the
  line that calls at the stop and later where the ride gets off. A short
  working that doesn't get there, or the line the other way, isn't the
  rider's bus.
- **A bus OASA has coming shows OASA's time**, without "~", with its minutes
  in the time badge (as on the Buses page) and the next one's. With no bus
  the rider can catch there yet, the timetable's "~" time stays, and the step
  says "Not on live times yet". The note under the trip says which bus times
  are live.
- **A last bus that can be any of several lists its stops by when their
  first bus comes**, among those the rider can catch: those with one first,
  each line with its minutes; then the others, nearest first. The nearest 3
  are shown, as before, the rest behind "N more stops".
- **Paused, unavailable and older live times are said above the answer**,
  as on the Buses page, with a button that asks again when paused.
- **Only the way shown in full asks.** The other ways keep their ranges, and
  the range of the way shown stays the half hour's.

## What follows

- At the door, a rider sees when their bus is coming, and from a change on
  the way, which stop to walk to; the times after a bus follow it.
- The page asks for stops while it's open and in sight
  ([34](0034-load-on-oasa-with-live-trips.md)), as the Buses page does.
- A bus on one of OASA's live routes the timetable has no times for (74 on
  5 November) isn't matched, so it isn't shown, even when it would do.
- When the answer for leaving now stays (walking is quicker, the trains have
  stopped, or the half hour finds nothing), it has no live times.
- The quicker way offered on a decision (get off for a bus that comes in
  time) is the next step: it uses the same asking, at the decision's stop.
- Starting from a bus stop still isn't possible. The bus trip finder was to
  go once the trip page has live buses (roadmap 13, 5 November); with the
  trip page's buses still behind `/trip?buses`, when it goes is the rider's
  call.

## Look again when

- The decision's quicker way is offered.
- Enough rides are measured: then buses for everyone, as
  [31](0031-trip-page-buses.md) says.
- Riders find a bus that would do missing because its route has no timetable.
