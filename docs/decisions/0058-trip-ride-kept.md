# 58. The trip page: the ride followed kept with the trip

Decided 2026-11-17 · In force

## Situation

[52](0052-trip-kept-on-the-device.md) keeps the trip set on the Trip page
on the device for 3 hours, so it comes back after Android closes the app.
It keeps each end as the place search found it, and not My location, nor
where it was.

From the road (roadmap Road · 8): on the T6 from Syntagma, with the trip
followed from My location ([50](0050-trip-follows-the-ride.md)), the app
was minimised and Android closed it. Opened again, the page started from
where the rider was, as a new trip: the nearest stop was behind the tram,
so it said to walk back to it and take the tram they were on. Nothing of
the ride was kept: not the way, not where they were on it.

Moving the rider on by the timetable while no fix comes was turned down
on the same day: timetables are often off (a train at the platform while
Wayhop says 3 minutes), and guessing would mislead. Placing goes by the
fixes there are.

## Decision

Agreed with the rider on 17 November 2026.

- **Once the rider has left on a ride followed from My location, the ride
  is kept with the trip** (`tools/trip/client/kept.js`): where the way
  was searched from and for when, its steps (as `follow.js` makes them)
  and where the last fix put the rider on them, with the quicker way
  taken or kept on a decision and the rider's own bus. It's kept again
  each time a fix moves them to another stop or step, and as the page goes
  out of sight.
- **Opened again, the ride is taken up**: the trip is searched again from
  where and for when it was, so the same way comes back, and the rider is
  placed where they were on it. A way switched to on the way
  ([T14](../../DESIGN.md)) isn't searched again; the rider's place is
  carried over to the way drawn as on a switch back. The next fix places
  them from there, as on any followed ride. Until the way is drawn,
  nothing is planned again from where they are; after, only off the way,
  as in 50.
- **Following a ride keeps the trip from growing old**: 3 hours since it
  was last changed or followed. Other ends, typing a start, or My location
  turned off drop the ride.
- Everything else in 52 stands: the ends as search found them, My
  location not kept as an end (before the rider has left, nothing of
  where they are is kept), the link to the page you're on starting it
  over, nothing in the page's address, nothing sent anywhere
  ([19](0019-privacy-counts-only.md)).

## What follows

- The privacy page says it, in both languages, under what stays on the
  device: where a ride was planned from and where the rider last was on
  it are positions, kept on the phone only.
- OASA is asked no more often: the ride taken up asks for the stops of
  the way still to come, on their tiers, as a followed ride does.
- From's status line says how old the last position is, as underground
  (50), until a fix comes.
- A data build in between (buses.json, rail.json) can bring back another
  way for the same search: the rider's place is then carried over where
  the ways are the same, or starts over, and the fixes place them as on a
  switch.

## Look again when

- Riders find the ride taken up wrong: on another way, or placed where
  they weren't.
- Riders want the ride taken up from a start they picked, not only from
  My location.
