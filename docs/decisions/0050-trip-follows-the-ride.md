# 50. Our load on OASA and STASY, with the Trip page following the rider's ride

Decided 2026-11-12 · In force

## Situation

[45](0045-load-on-oasa-my-location-follows.md) set our numbers with My
location following on the Trip page: the trip planned again from where the
rider is once they're 200 m on, at most every 2 minutes, as if they stood
there. On a bus or a train that's wrong: it can show a walk to a stop the
bus is passing, and the directions, the live times and the quicker way
([36](0036-trip-quicker-way.md)) are for someone leaving the start this
minute, not for the ride the rider is on. Underground there's no position
at all. 45 said that following the ride itself was Plan 7's, and that its
numbers come first.

Agreed with the rider on 12 November 2026, in a plan session (roadmap Plan
7), with the four things it had to work out: following the planned ride
rather than planning again from each fix; underground; where the page says
the trip is followed and how to stop, now that From and To stay on the
page ([49](0049-trip-kept-for-the-session.md)); a fix every second without
a redraw every second. Agreed before it, 7 and 10 November: following is
switched on by My location (a trip from a typed start is planned ahead and
isn't followed), and a way 3 minutes or more sooner found on the way is
switched to after 10 seconds unless the rider keeps theirs
([DESIGN.md](../../DESIGN.md), "The Trip page", still to build).

OASA's live API is the only source of live bus times. OASA publishes no
limits for it and makes no promise about how long it keeps running. Being
blocked, or overloading it, would end live times for everyone.

## Decision

Wayhop sets its own limits, and a change to any of these numbers is
proposed and agreed before it is built.

- **The server** asks OASA at most 2 times a second, evenly spaced, in one
  queue. Someone's first look at a stop goes ahead of refreshes, and a
  request that would wait more than 8 seconds is dropped
  ([client.js](../../server/oasa/client.js)).
- **Each stop's arrivals** are shared by everyone for 30 seconds; for 60
  while the queue waits over 2 seconds, and 90 over 5. They are marked as
  possibly old from a minute old, and when OASA can't be reached the last
  answer is served for up to 5 minutes
  ([arrivals.js](../../server/oasa/arrivals.js)). A stop's route names are
  looked up about once a week.
- **Each visitor** (an IPv4 address, or an IPv6 /64) may ask for 30 stops a
  minute that aren't cached, at most 12 in one request
  ([limits.js](../../server/oasa/limits.js)).
- **The bus page** refreshes only the stops on screen, by when their next
  bus comes: within 10 minutes every 30 seconds, within 20 every minute,
  later or none every 2 minutes; an opened stop every 30 seconds. It stops
  after 10 minutes without a touch. A stop or line opened from the search
  asks only for the stops opened, and searching asks nothing.
- **The Trip page**, for everyone, asks only for the stops of the way it
  shows in full, once the half hour's answer is shown: where each of its
  rides by bus boards, then the stops a last bus that can be any of several
  leaves from, nearest first, and on a decision the quicker way's stop
  ([36](0036-trip-quicker-way.md)); at most 10 stops a trip, one request
  each ([live.js](../../tools/trip/client/live.js)). Each is asked again on
  the bus page's tiers, set by the first bus of the way's lines the rider
  can still catch there: within 10 minutes every 30 seconds, within 20
  every minute, later or none every 2 minutes. So a stop where the rider
  changes later in the trip is asked rarely until the ride nears it. Like
  the bus page, it asks nothing while out of sight, and stops after 10
  minutes without a touch. Its requests say so (`&for=plan`), so
  /admin/usage counts its searches and what each costs.
- **My location on the Trip page follows the rider's own ride.** With a
  destination, once the rider is 100 m from the start, the way shown in
  full is theirs ([follow.js](../../tools/trip/client/follow.js)):
  - each fix only places them on it: walking to a stop, waiting at it, on a
    ride at one of its stops, on the last walk, arrived. A walk ends at its
    stop; a ride is boarded once they're nearer a later stop than the one
    they waited at, and goes on by the nearest stop ahead, never back; a
    fix less exact than 200 m (not GPS) places nobody. The way is timed
    from that step, in the worker, and the stops they've passed are never
    asked again. That costs nothing new: fewer stops than a trip kept open;
  - off the way (over 300 m from every point of their step for a minute, or
    one fix after 2 minutes without any, or riding past their stop), the
    trip is planned again from where they are, as 45 did, at most once
    every 2 minutes. A re-plan is a new search on the phone; for OASA, as
    in 45: a stop the new way still has keeps its answer and its turn on the
    tiers, only the stops new to the way are asked at once, never more than
    10 for the trip, and the first says `&for=plan-moved`;
  - underground nothing is assumed: with no fix, the step stays where the
    last fix put them and the way stays timed as at that fix, so the train
    they were to catch isn't replaced by the next one on the clock. The
    next fix places them; one that doesn't fit after a gap of over 2
    minutes plans again at once. No re-plan ever comes from having no
    position;
  - the live times pause once the rider has not moved 50 m in 10 minutes
    and hasn't touched the page in 10 minutes, in place of the page's
    untouched rule alone, which would stop a 40-minute ride dead; moving on
    resumes them. Nothing is planned again or asked while the page is out
    of sight;
  - until the way shown can be followed (walking is quicker, or no answer
    yet), 45's rule stands: planned again once 200 m from where it was
    planned, at most every 2 minutes;
  - without a destination, a new position only changes From, and nothing
    is asked.
- **The rider's own bus**: boarding, the bus of the way's lines that OASA
  had due at that stop nearest then is theirs, by its vehicle code
  (`ownBus` in [live.js](../../tools/trip/client/live.js)). The stop they
  get off is asked for it, on the tiers by when OASA has that vehicle due
  there, and the ride gets off then; its first request says
  `&for=plan-ride`, one new column on /admin/usage, "stops asked for the
  rider's own ride". Within the 10 stops a trip, and in place of the stop
  they boarded at, so nothing more than a trip kept open.
- **Still to build, agreed with the same numbers**: a search ahead on the
  phone from the ride's remaining stops at each stop reached, at most once
  a minute, which costs OASA nothing by itself (a stop it first asks for
  says `plan-ride` too); and the switch to a way 3 minutes or more sooner,
  with its countdown.
- **The collector** asks for one stop every 6 seconds, Monday to Friday
  07:00–10:00 and 16:00–20:00 Athens time: at most 10 requests a minute,
  about 4,200 a day ([collector.js](../../server/oasa/collector.js)). Its
  stops are 30 a week, about 3 minutes apart each, a new set each week for
  10 weeks and then again from the first, chosen by
  [collector-stops.js](../../scripts/collector-stops.js) within 8 km of
  Syntagma. Its requests go last in the queue and skip their turn whenever
  anyone is waiting, or while OASA is failing. It is there to see buses
  pass (below).
- **The bus network** is fetched at most once a day, one request a second
  (about 600 a night); a failed request is tried again after 10, 30 and 60
  seconds.
- **STASY**: announcements at most every 15 minutes and lifts at most every
  10, both only when someone asks; the timetables at most every 14 days; the
  airport timetable check once a week.

## What follows

- A watched stop costs about 2 requests a minute, so about 60 stops can be
  kept fresh at once, more while the server is busy. Beyond that people see
  older times, marked as such.
- A Trip page search costs at most 10 requests to start with, about 5
  seconds of the whole budget, less where someone looked at the same stops
  in the last 30 seconds. Kept open, a trip costs about 4 to 10 a minute: at
  most about 20, when all 10 stops have a bus due within 10 minutes.
- A followed trip costs about what a trip kept open does, and less as it
  goes: a stop passed is dropped, and a re-plan comes only off the way,
  rarer than 45's every 2 minutes on foot. With the rider's own bus and the
  search ahead built, at most about 20 a minute, of the 30 each visitor may
  ask: about 5 such trips at once take the budget, as before. Past that the
  cache keeps answers longer, as it does for the bus page, and
  `/api/health` says so (below).
- On the way, the directions are for the rider where they are: the ride
  they're on gets off when the timetable says from the stop they're at, and
  the rides after it are timed from that; the card's heading is when they
  arrive. The step they're on is marked and the steps done greyed
  ([DESIGN.md](../../DESIGN.md), "The Trip page"); From's status line says
  the ride is followed, or how long ago the last position came.
- The quicker way on a decision ([36](0036-trip-quicker-way.md)) is still
  worked out from the first ride as timed, and no longer once that ride is
  done; how late the rider's own bus is at the change doesn't count in it
  yet (`here` in `quickerWay`): that comes with the search ahead.
- A bus boarded where OASA had none of its line coming, or one OASA has no
  vehicle code for, isn't known again: the ride they're on is timed from
  where they are by the timetable. So is one whose code OASA no longer
  lists where they get off, until it does.
- Where a last bus can be any of several, the way is followed by the stop
  and line the way boards; a rider walking to another of the stops is
  within 300 m of it, so still on the way.
- A fix a second costs a handful of distance checks on the phone; the page
  redraws only when the step changes, when an answer comes, or on its
  minute's refresh.
- STASY, the suburban railway and the address index are asked no more often.
- /admin/usage counts the Trip page's searches, re-plans and what each
  asked of OASA as before.
- The numbers are our guess, not an agreement. What we can measure is how
  much we need; OASA's own answers (their times and errors) are the only
  sign of what it can take. `/api/health` warns, from the past hour, when
  10 or more stop answers (a tenth of those that needed OASA) were older ones
  or none, when 95% of the busiest route's answers took 4 seconds or more,
  when visitors' requests didn't fit the budget in 5 minutes, and when 45
  stops were asked for in one minute (agreed 4 November 2026).
- The collector takes up to a twelfth of the budget in the rush hours, and
  none of it when someone is waiting. Every fresh answer, the collector's
  and visitors', shows which buses passed
  ([passes.js](../../server/oasa/passes.js)); each pass is a line in that
  day's file in `data/local/bus-passes/`, buses only, nothing about who
  looked ([4](0004-one-process-no-database.md)).

## Look again when

- Riders find the step marked wrong on a ride they know (boarded too soon
  or too late, off the way when they weren't, not off when they were), or
  the answer on board misleading.
- The rider's own bus, the search ahead and the switch are built: their
  requests on /admin/usage against the sum above.
- Measurements show the limits are reached often, or the health page warns
  that visitors' requests didn't fit the budget on ordinary days.
- OASA publishes limits of its own.
- The Trip page's searches cost more per search than expected, or its
  re-plans more than a trip kept open, on /admin/usage.
- The collector's skipped turns (/admin/usage) are many, or ten weeks have
  gone round: whether to keep collecting, and which stops.
