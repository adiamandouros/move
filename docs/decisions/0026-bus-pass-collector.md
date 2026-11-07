# 26. Our load on OASA and STASY, with the bus-pass collector

Decided 2026-11-02 · Replaced by [34](0034-load-on-oasa-with-live-trips.md)

## Situation

[21](0021-load-on-oasa-with-trips.md) set our numbers with the bus trip
finder. Buses take longer than the August timetable says, 1.4 to 1.7 times
as long in the centre in the rush hour, and OASA's countdown runs late past
15 minutes ahead (the rush-hour test of 2 November 2026), so the planner
needs ride times measured by stretch and hour (roadmap Plan 3). Nobody but
us looks at the bus pages yet, so the answers we get for visitors can't
measure them: Wayhop asks for some stops itself. Its numbers were agreed on
2 November 2026 and added here; the rest is as before.

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
- **The trip finder** shows at most 5 lines, each from the stop nearest you
  where it calls to the stop nearest the destination after it: at most 10
  stops ([trips.js](../../tools/buses/client/trips.js)). The stop you board
  at is refreshed by when that line's next bus comes, as on the bus page;
  the stop you get off at, only used to tell how long the ride is, once a
  minute. It stops after 10 minutes without a touch, like the bus page, and
  picking a stop or a station asks nothing. Its requests say so
  (`&for=trip`), so /admin/usage counts its searches and what each costs.
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
- A new trip search costs at most 10 requests, about 5 seconds of the whole
  budget, less where someone looked at the same stops in the last 30 seconds.
  Kept open, it costs at most about 15 a minute, so about 8 people with new
  searches at once fill the budget; past that the cache keeps answers longer,
  as it already does for the bus page.
- The numbers are our guess, not an agreement. What we can measure is how
  much we need; OASA's own answers (their times and errors) are the only
  sign of what it can take. `/api/health` warns, from the past hour, when
  10 or more stop answers (a tenth of those that needed OASA) were older ones
  or none, when 95% of the busiest route's answers took 4 seconds or more,
  when visitors' requests didn't fit the budget in 5 minutes, and when 45
  stops were asked for in one minute (agreed 4 November 2026).
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

- Measurements show the limits are reached often.
- OASA publishes limits of its own.
- The trip finder's searches cost more per search than expected, on
  /admin/usage.
- The collector's skipped turns (/admin/usage) are many: the budget is
  busier than we thought.
- Ten weeks have gone round: whether to keep collecting, and which stops.
