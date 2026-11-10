# 45. Our load on OASA and STASY, with My location following on the Trip page

Decided 2026-11-11 · In force

## Situation

[38](0038-load-on-oasa-buses-for-everyone.md) set our numbers with buses for
everyone on the Trip page, and said to propose them again before the Trip
page follows the rider. On 10 November 2026 the rider agreed the Trip page's
design, version 2 ([DESIGN.md](../../DESIGN.md), "Start from here" and the
Trip page's rules). In it, My location works exactly like the Subway page's
Nearest. It is on by default when the page opens without a start, and
follows where the rider is. It plans the trip again once the rider is 200
metres or more from where it was last planned, at most every 2 minutes, and
keeps following while they ride. Agreed that day as a start: a re-plan is a
new search, at most 10 stops, under the 30 a minute each visitor may ask;
the rest of the numbers below on 11 November.

Until now My location fills From once and doesn't follow. A new From is a
new trip, so the page drops every stop's live answer and asks for the new
way's stops at once, up to 10 (`resetLive` in
[main.js](../../tools/trip/client/main.js)). Nothing else a re-plan uses is
asked again. The lift status has its own timer, the suburban trains'
lateness is kept from trip to trip, and a position needs no address search.

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
- **My location on the Trip page** follows the rider. With a destination,
  the trip is planned again from where they are once they're 200 metres or
  more from where it was last planned, at most every 2 minutes, on foot and
  on board. A re-plan is a new search on the phone; for OASA:
  - a stop the new way still has keeps its answer and its turn on the
    tiers. Only the stops new to the way are asked at once, and never more
    than 10 for the trip;
  - a re-plan isn't a touch. The live times still pause after 10 minutes
    untouched, and a re-plan while they're paused asks OASA nothing;
  - nothing is planned again while the page is out of sight. Back in
    sight, the trip is planned again at once if the rider has moved 200
    metres and the last plan is 2 minutes old;
  - a re-plan that needs a stop says so on its first request
    (`&for=plan-moved`), so /admin/usage counts those re-plans apart from
    searches; one that keeps every stop asks nothing, so isn't counted;
  - without a destination, a new position only changes From, and nothing
    is asked.
- **The collector** asks for one stop every 6 seconds, Monday to Friday
  07:00–10:00 and 16:00–20:00 Athens time: at most 10 requests a minute,
  about 4,200 a day ([collector.js](../../server/oasa/collector.js)). Its
  stops are 30 a week, about 3 minutes apart each, a new set each week for
  10 weeks and then again from the first, chosen by
  [collector-stops.js](../../scripts/collector-stops.js) within 8 km of
  Syntagma (Kypseli, Patisia, Galatsi, Vyronas and Zografou in the first
  week). Its requests go last in the queue and skip their turn whenever
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
  most about 20, when all 10 stops have a bus due within 10 minutes, as can
  happen for a bus that can be any of several, caught from the nearest 10 of
  13 stops near a house in Korydallos.
- A followed trip on foot costs about what one kept open does. At 80 metres
  a minute a re-plan comes about every 2½ minutes, and mostly keeps its
  stops: the boarding stop changes only when another one becomes nearer.
  At most, a ride whose every stop changes at each re-plan asks 10 at once
  every 2 minutes on top of a trip kept open at its most: about 25 a
  minute, still under the 30 each visitor may ask. So about 5 such trips at
  once take the budget, against 6 before. Past that the cache keeps answers
  longer, as it does for the bus page, and `/api/health` says so (below).
- Keeping a stop's answer across a re-plan also keeps its live times on
  screen: the new way doesn't fall back to the timetable's "~" times while
  its stops are asked again.
- A re-plan costs the phone a new search, up to about 5 seconds of work in
  the background for the half hour ([32](0032-trip-searches-in-the-background.md)),
  at most once every 2 minutes. The location stays on while the page is
  open, and stops 10 minutes after it goes out of sight
  ([location.js](../../public/js/core/location.js)).
- STASY, the suburban railway and the address index are asked no more often.
- On board, a re-plan plans as if the rider were standing where the bus or
  the train is: it can show a walk to a stop the bus is passing, and the
  next bus. Following the ride itself (the rider's own bus or train, its
  stop asked more often as it nears) is Plan 7's, and its numbers come
  first, as 36 says. Underground there is mostly no position, so no
  re-plan.
- A rough first position (the phone's quick one) followed by a precise one
  200 metres or more away plans the trip again once, 2 minutes after the
  first plan.
- How many Trip page searches there are is up to visitors, not a switch:
  /admin/usage counts them per day, with what each asked of OASA, and now
  the re-plans.
- The numbers are our guess, not an agreement. What we can measure is how
  much we need; OASA's own answers (their times and errors) are the only
  sign of what it can take. `/api/health` warns, from the past hour, when
  10 or more stop answers (a tenth of those that needed OASA) were older ones
  or none, when 95% of the busiest route's answers took 4 seconds or more,
  when visitors' requests didn't fit the budget in 5 minutes, and when 45
  stops were asked for in one minute (agreed 4 November 2026).
- A Buses page still open from before the trip finder went may ask with
  `&for=trip`: such a request is counted as any other. The days counted
  before keep the trip finder's numbers in the file, but /admin/usage no
  longer shows them.
- The collector takes up to a twelfth of the budget in the rush hours, and
  none of it when someone is waiting. It never asks in a burst: a queue makes
  the cache keep everyone's answers longer (the 12 stops asked at once in
  the rush-hour test of 2 November waited up to 6 seconds, and the last was
  served a minute old).
- Every fresh answer, the collector's and visitors', shows which buses
  passed: one 3 minutes away or less that is gone from the next answer
  passed about when OASA said ([passes.js](../../server/oasa/passes.js)).
  Each pass is a line in that day's file in `data/local/bus-passes/`, kept
  until decided otherwise (about 10 to 20 MB a year): buses only, nothing
  about who looked. JSON files, as [4](0004-one-process-no-database.md)
  says; they are read once a night, so no database.

## Look again when

- Measurements show the limits are reached often, or the health page warns
  that visitors' requests didn't fit the budget on ordinary days.
- OASA publishes limits of its own.
- The Trip page's searches cost more per search than expected, or its
  re-plans more than a trip kept open, on /admin/usage.
- Riders find a followed trip planned again too often or not often enough,
  or the answer on board misleading.
- The Trip page follows the rider's own ride, asking for the rider's stop
  more often as it nears ([36](0036-trip-quicker-way.md), roadmap Plan 7):
  its numbers are proposed first.
- The collector's skipped turns (/admin/usage) are many: the budget is
  busier than we thought.
- Ten weeks have gone round: whether to keep collecting, and which stops.
