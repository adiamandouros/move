# 29. The trip page: door to door by metro and tram, beside Subway and Buses

Decided 2026-11-05 · In force

## Situation

[23](0023-trip-page.md) started the trip page with walks and the metro. It
tried the three metro stations nearest each end and planned every trip
between them. The tram was already in the Subway planner
([28](0028-trip-search.md)), with its walks between stops, and the trip
search could weigh many trips at once. Along the coast, where the metro is a
long walk away, the page was sending people on hour-long walks to the metro
with a tram stop around the corner.

Counting tram stops as stations among the three nearest would have hidden
better metro stations behind them. Planning every trip between every stop
near both ends would have taken up to 300 ms on a desktop.

Measured on 5 November 2026 on 600 trips between points on real streets
(400 within 10 km of Syntagma, 200 within 25 km), at 08:30, 13:00 and 22:30
on a Wednesday, against the page as it was:

| Tried besides the three nearest metro stations | First option sooner, within 10 km | Stops at each end (90%) |
|---|---|---|
| Stations and stops within 10 minutes' walk | 4% | 3 |
| Within 15 minutes | 5% | 5 |
| Within 20 minutes | 6 to 7%, mostly small gains after long walks | 8 |

## Decision

- **A page of its own, `/trip`, that grows into version 1.** It plans with
  walks, the metro and the tram, marked Beta, and buses join it later. Subway
  and Buses stay as they are; whether it replaces them is decided later.
- **Worked out in the browser**, like metro trips
  ([5](0005-trips-in-the-browser.md)). The server only finds the places.
- **The tram unless it's hidden.** The page follows the Subway page's switch:
  with the tram hidden on this device, it plans on the metro alone.
- **Not just the nearest station.** The three metro stations nearest each end
  are tried, as a station a little further away can be on a direct line, and
  so is every station and tram stop within 15 minutes' walk. Every trip
  between the three nearest is planned, as before. Of the others, the search
  weighs every trip at once, and the 6 that get there first are planned too:
  that gives the same first option as planning them all, in a fortieth of the
  time.
- **A tram stop picked is that stop**, as a metro station is that station:
  there's no walk to it.
- **Walks are estimates and say so**: the straight line plus a third, at 80 m
  a minute, shown with "~", with Google Maps for the way. There's no street
  map behind them. A walk between a station and a tram stop is the tram's
  ([28](0028-trip-search.md)), and is a step of its own.
- **"Where to stand" is for the metro.** A trip on the tram alone doesn't
  offer it: a tram has no front or back.
- **It says when walking is quicker, and shows long walks** with a note that
  a bus may be better, rather than hiding them.
- **Addresses aren't kept.** They're not in the page's address, not remembered
  for coming back, and a location from "My location" stays on the device.

## What follows

- On the same 600 trips, with the tram the first option gets there sooner on
  5% of the trips within 10 km, by a median of 15 to 20 minutes, and on 3% of
  those within 25 km. It's never later. "Walking is quicker" shows a point
  less often in the city. A trip takes about 8 ms on a desktop instead of 5,
  47 at most. With the tram hidden, 97 to 99% of answers are the same as
  before, the others from metro stations within 15 minutes, and none later.
- The page needs a connection, as search is on the server. Times alone would
  work offline; addresses don't.
- A trip can't be shared by link or bookmarked yet: that would put an address
  in the page's address.
- It says nothing about step-free access, since the walks and station
  entrances aren't known yet (roadmap item 22).
- Times here are the timetable's, as on the Subway page; live data comes with
  buses ([11](0011-real-data-first.md)).

## Look again when

- Buses join the page: then a stop near either end is one of hundreds, and
  the search, not a list of pairs, has to choose them.
- People want trips kept or shared.
- A walking route source would replace the estimate.
- Riders say the 15 minutes is too far, or not far enough.
