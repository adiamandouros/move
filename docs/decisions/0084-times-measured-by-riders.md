# 84. Times measured by riders on the metro and the tram, in phases

Decided 2026-11-28 · In force

## Situation

The metro and the tram are the two ways around Athens with no live times.
Buses have OASA's ([9](0009-bus-network-from-live-api.md)) and the
suburban railway has railway.gov.gr's train tracker. For the metro and
the tram, Wayhop has only the open data's timetable, held to STASY's first
and last trains ([10](0010-metro-timetable.md)), and that feed ran out on
31 October 2026. The rider has found it off on the road: a train at the
platform while Wayhop says 3 minutes ([69](0069-following-underground-rough-fixes.md)).

The Trip page already knows where a rider following their way is on a
metro or tram ride ([50](0050-trip-follows-the-ride.md)). The traces of 25
and 27 November 2026 showed what it can measure:

- **The tram** runs above ground: a GPS position every second, a few
  metres out, so every stop, the time between stops and the stops
  themselves.
- **The metro**, where the tunnel has a mobile signal (most of the M3 from
  Agia Marina to Ethniki Amyna, and Chalandri), gives network positions
  about 100 m out, at the right station every time, 7 to 50 seconds
  before the doors open. Some stretches give nothing for up to 5 stations
  (Agia Varvara to Kerameikos, Cholargos to Agia Paraskevi, the Piraeus
  branch). The same stations were silent in both directions.
- The time between stations, doors to doors, was mostly 1:30 to 2:20.
  Kerameikos to Elaionas took 3:00 in the morning and 3:45 in the evening.

The rider asked on 27 November 2026 whether riders' rides could make the
times better for everyone, metro and tram, in phases: first how long
trains really take, from a couple of weeks of rides, then live times.

Two decisions said to look again at this point. [4](0004-one-process-no-database.md):
"stores what people send (rider reports, accounts)". [19](0019-privacy-counts-only.md):
"A feature needs to store what people send (rider reports, say)".

## Decision

Agreed with the rider on 28 November 2026.

**Three phases.** This page decides the first two. The third gets its own
page, with its numbers, once the second phase's numbers show it can work.

1. **Collect.** Riders who said yes send the times they took between
   stops on the metro and the tram.
2. **Typical times.** Once there's enough, the planner and the Trip page
   time rides by what the trains really took, and the timetable everywhere
   else.
3. **Live times**, later and line by line: a train seen at a station a
   minute ago tells the next stations when it's coming. Trams most likely
   first.

**Asked, never assumed.**

- Only a rider the Trip page follows from My location, on a metro or tram
  ride. Nothing is sent for walks, buses, trolleys or the suburban railway.
- Asked once, the first time a metro or tram ride is followed, in plain
  words: what is sent, that it has no name or number attached, and what
  it's for. "Yes" or "No thanks", and nothing is sent until "Yes". The
  answer is kept on the device. It can be changed at any time, on the
  privacy page and on the Trip page.
- The privacy page says all of this, in both languages, before any of it
  is built ([19](0019-privacy-counts-only.md)'s rule).

**What a phone sends.** Not a ride's total, but what happened at and
between each stop, worked out on the phone. Each with the line, the
direction (where the train ends), the hour, and whether it was a weekday,
a Saturday or a Sunday or holiday:

- **Between stops**: for each pair of stations or stops in a row it was
  placed at, the two stops and the seconds from one to the next. A
  stretch can span stations the phone heard nothing from (Agia Varvara to
  Kerameikos, as one stretch).
- **At a stop**: how long the train stood there, from stopping to moving
  on. Only from GPS, so on the tram and the metro above ground; a network
  fix underground stays pinned at a station through the stop and much of
  the tunnel after it, so it can't tell.
- **Waiting**: at the stop the rider boarded at, the seconds from reaching
  the platform to the train leaving. Many riders' waits say how often
  trains really come, which a single ride can't.

Each is marked from GPS or from a network fix, and kept apart by it.
A network fix comes to a station well before the doors open and stays
through the stop, so it can't say when a train stood or left: stops and
waits come from GPS only. A stretch is from the train coming to one stop
to coming to the next (doors to doors), so the stop boarded at, where the
rider was before the train, starts none, and a stretch whose two stops
were seen by different kinds of fix isn't sent (settled while building it,
28 November 2026).

- No device number, no session, no account. Nothing ties one ride's
  stretches to another ride's, or to the walk before or after.
- No place except the stops, and no time finer than the hour.
- Sent once a ride is over, in one request, a random 0 to 15 minutes
  later, so the host's web log can't show when a ride ended. If the phone
  has no signal then, it's sent the next time the page is open, or
  dropped after a day.

**What the server keeps.** Totals only: per stretch, stop or boarding
stop, direction, day type and hour, per week, how many and how many in
each 15-second band of time taken. A JSON file in `data/`, written through `files.js` at most
every 5 minutes, as [4](0004-one-process-no-database.md) has it: no
database. Weeks older than 8 are dropped, so a new timetable takes over
within 2 months. Each report is added and then forgotten: no report,
address or time is stored.

**Checked before it counts.**

- The stops must be on that line, in that direction, in order.
- The time must be between half and three times what the timetable gives
  for that stretch.
- A stop's standing time must be under 5 minutes, a wait under 30.
- A report holds at most 40 stretches and 40 stops, and each visitor (an IPv4 address,
  or an IPv6 /64) may send 6 an hour: the address is kept in memory for
  that hour, never on disk, and the privacy page says so (the rider's
  call on 28 November 2026, as "a minute" couldn't count an hour).
- Typical times use the median of the bands, so a few wrong reports
  hardly move it.

**Phase 2: when a time counts as measured.** A stretch, direction, day
type and hour with at least 5 rides in the last 4 weeks uses its median.
With fewer, its hour is pooled with the hours on either side, then with
the whole day type. With fewer than 5 even then, the timetable's time is
used. The nightly build adds the measured times to `rail.json`, so the
planner, the Trip page and the offline copies get them alike.

- Measured times say how long a ride takes and how long trains stand at
  stops. The waits say how often trains come, on average, by hour, but
  not when the next one leaves: departures stay the timetable's until
  phase 3. Where the waits show trains far less often than the
  timetable, the times shown wait longer for the train to match, with no
  message about it: the times are simply closer to what happens.
- Shown as estimates, as timetable times are
  ([11](0011-real-data-first.md)): "~" and words, never looking live. The
  words say which: "from riders' trips" or "timetable".

**Phase 3's test.** A line gets live times when, over 2 weeks, its reports
average at least one every 10 minutes from 07:00 to 22:00, about 90 rides
a day. The measured totals show this per line and hour, on
`/admin/diagnostics`. Live reports would be sent as each station is
passed, kept in memory for 10 minutes and never written to disk. That
page decides it.

**Everything else in 19 stands**: no accounts, no cookies of Wayhop's
own, no third-party analytics, a count per day of the languages asked
for, requests to OASA carrying only the stop number.

## What follows

- OASA and STASY are asked nothing more. The new load is on Wayhop's
  server: at most one request per metro or tram ride, of a few hundred
  bytes. The totals file stays under a few megabytes: about 600 stretches
  and directions and as many stops, 3 day types, 20 hours, 8 weeks.
- `/trip?trace` stays the way to check what following measures, against
  the rider's station marks.
- Tests: the stretches, stops and wait a followed ride makes (the 27 November traces, as
  fixtures), each check on the server, the totals and the 8 weeks, the
  median and the pooling, the build adding measured times, the question
  with axe-core and the keyboard, and nothing sent after "No thanks".
- The stretches on the metro come from where `follow.js` places the
  rider, so the metro's are only as good as following underground
  ([69](0069-following-underground-rough-fixes.md)). A network fix comes
  7 to 50 seconds before the doors open, about the same at each station,
  so the time between two stations comes out right. The silent stretches
  come in only as their totals.

## Look again when

- After 2 weeks of phase 1: how many rides a day, per line and hour, and
  how far the measured times are from the timetable's. That's when phase
  2 is switched on, or this page changes.
- Reports turn out wrong more often than the checks catch.
- STASY or OASA publish live metro or tram positions: then theirs come
  first, and this is for typical times only, or not at all.
