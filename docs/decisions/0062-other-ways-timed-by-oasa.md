# 62. The trip page: the other ways timed by OASA, each by its first bus

Decided 2026-11-18 · In force

## Situation

Under the way shown in full, the Trip page lists up to two other ways
([33](0033-trip-half-hour-answer.md)), one line each, with their range over
the next half hour by the timetable and measured rides. Only the way shown
in full was timed with OASA's live times ([35](0035-trip-live-times.md),
[53](0053-trip-bus-ride-from-oasa.md)), and only the quicker way on a
decision and the switch on the way ([36](0036-trip-quicker-way.md),
[50](0050-trip-follows-the-ride.md)) were offered only when OASA has their
bus coming in time.

From the rider, 18 November 2026, planning roadmap item Road · 10 (the
other ways follow where the rider is) and the step after it (the other
ways become buttons that take that way): a way offered has to be one the
rider can actually take. A way whose bus the timetable has "any minute
now", which OASA knows left 3 minutes ago, sends the rider off a bus to
watch theirs go. So the other ways use OASA's numbers, as the way shown
in full and the switch already do.

## Decision

Everything [60](0060-trip-follows-within-20-metres.md) decided stands, and
the other ways shown are timed with OASA's live times too (`otherWay` in
[buses.js](../../tools/trip/client/buses.js)). Agreed with the rider on 18
November 2026, numbers first.

- **One stop each.** Only where another way's first bus is caught is asked
  for, on the bus page's tiers like the way shown's stops (within 10
  minutes every 30 seconds, within 20 every minute, later every 2 minutes):
  2 more stops at most for a trip. A stop the way shown already asks isn't
  asked twice, nor one shared by both other ways. A way whose only bus can
  be any of several asks nothing. Its first request says
  `&for=plan-other`, a column of its own on /admin/usage, "Trip page stops
  asked for the other ways".
- **Timed as the way shown is** ([35](0035-trip-live-times.md)): its first
  bus is the first OASA has coming that the rider can still reach there
  (the walk to it, or the change after the ride before, as for the way
  shown), and the rides after it follow from then. Its other buses use an
  answer there is, for the way shown, or the timetable.
- **Said on its line** ([DESIGN.md](../../DESIGN.md), "The Trip page"):
  timed, its heading is its minutes and when it gets there, as for leaving
  now, and the line ends with its first bus's badge, OASA's; with OASA
  having none the rider can catch there, "Not on live times yet", and the
  timetable's time. The other ways come the soonest there first. Until its
  stop is answered, its range over the half hour, in the half hour's order.
- **Not while followed on a ride**: there the other ways are from the start
  the rider has left, so they aren't timed; Road · 10 makes them follow the
  rider, and is agreed to use OASA's numbers the same way.

## What follows

- For OASA: at most 2 more stops a trip kept open. With the way shown's at
  most 10, a trip asks for at most 12; kept open, at most about 24 requests
  a minute instead of 20, about a fifth more at worst, less where a stop is
  in the cache from someone else's look. Usually fewer: many other ways have
  no bus of their own, or share a stop. Each visitor's 30 new stops a
  minute and the server's 2 a second stand.
- A way OASA times can move: its bus later than the timetable said, it goes
  down the list. The first card stays the way the half hour's answer stands
  for ([33](0033-trip-half-hour-answer.md)); ranking that one by OASA is
  roadmap item "OASA rank".
- The other ways' badges count down by themselves
  ([61](0061-times-count-down.md)).
- The metro and the tram have no live times; a way by them alone is as the
  timetable has it, and isn't asked for.
- A way's later buses, after its first, are OASA's only where the way shown
  asks for that stop; elsewhere the timetable's, as before.

## Look again when

- /admin/usage's new column and the Trip page's stops asked, against the
  fifth more above.
- Road · 10: the other ways worked out from where a followed rider is,
  timed the same way, which may change how many stops they ask.
- The other ways become buttons that take that way: a way not on OASA's
  live times may then not be one to take.
- Riders find another way's bus gone when they get there.
