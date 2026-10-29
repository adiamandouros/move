# 7. Our load on OASA and STASY: our own numbers, agreed before they change

Decided 2026-10-18 · Replaced by [21](0021-load-on-oasa-with-trips.md)

## Situation

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
- The numbers are our guess, not an agreement. What we can measure is how
  much we need; OASA's own answers (their times and errors) are the only
  sign of what it can take.

## Look again when

- Measurements show the limits are reached often.
- OASA publishes limits of its own.
