# 25. Trams in the subway planner

Decided 2026-11-01 · In force

## Situation

The tram was only drawn, on the Info page. Riders asked for it where they plan
their trips, and the same feed has its timetable. Metro and tram don't fit the
old route finder: two changes can be needed, T7 runs one way round its loop in
Piraeus, and the stops next to a metro station are often a few minutes' walk
from it. A tram has no front or back to stand at either: its platforms are in
the street, open along their length.

## Decision

- **The tram is in the Subway tool, in the same list.** Every tram stop is a
  row of its own, even one with a metro station's name, as those may be far
  apart: tram Agia Paraskevi is 12 km from the metro station. Those six say
  "(tram)". Names and addresses of metro stations don't change. A switch shows
  or hides the tram, stops and routes together, and it's kept on the device.
  Hidden, the planner is the metro's as it was.
- **`rail.stations` and `rail.lines` stay the metro's alone**, as the station
  pages, the checks and the Trip page read them. `withTram` joins the two in
  the browser, in the same shape, so one route finder serves both, and a
  problem with the tram still can't touch the metro.
- **The route finder takes any number of changes, up to 3**, and walks between
  stops. Two are always enough today. It only times routes with the fewest
  changes or one more, and one with more changes has to arrive 5 minutes sooner
  to stay.
- **A tram leg has no train diagram**, nor any word about where to stand.
- **The tram's times are the feed's**, on the metro's week and dates. Unlike the
  metro's ([10](0010-metro-timetable.md)) they aren't held to STASY's: checked
  by hand on 1 November 2026, its first and last trams agree with STASY's tram
  page in all four directions, Fridays included. A later feed isn't checked.
- **The walks are in `tram.json`, in minutes.** They're first guesses (the
  straight line × 1.3 at 80 m a minute, plus 2 to reach the platform) until
  someone times them. Three aren't official changes, so the map doesn't draw
  them: they're there for what the planner would otherwise say, like riding
  from Faliro to Gipedo Karaiskaki, which is 63 m away.

## What follows

- `rail.json` grows from about 22 KB to 25 KB gzipped, and works offline as
  before. OASA isn't asked for anything more.
- T7 trams from Voula that end at SEF count as ending at Neo Faliro, as SEF isn't
  on the way to Piraeus. A trip to SEF walks the last part. The build warns
  every night.
- Tram stops have no page of their own, so their names aren't links.
- Trams share the road, so their times are less sure than the metro's. The note
  under every trip already says times are approximate.
- The Trip page and the bus trip finder stay on the metro for now.

## Look again when

- The walks have been timed, or riders say a change is missed.
- A new feed moves the tram's first or last trams away from STASY's page, or
  STASY's tram page turns out worth reading automatically.
- The Trip page gets the tram: the 3 stations it tries could then all be tram
  stops, and hide a better metro station.
