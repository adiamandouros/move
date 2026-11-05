# 28. Trams in the subway planner, and the trip search behind it

Decided 2026-11-05 · In force

## Situation

[25](0025-trams-in-the-planner.md) put the tram in the Subway tool. Its route
finder lists every route with the fewest changes the trip takes, or one more,
and times them all. That limit keeps the list short enough to time on a
phone, but it misses ways that are quicker with another change or two.
Measured on 5 November 2026 over every pair of stations and stops (15,732
that aren't a short walk apart) at six times of the week, the first answer
could be sooner on 14 to 132 of them, by a median of 3 to 12 minutes and up
to 24: from Zappeio to Evangelistria, T6, M2, M1 and T7 arrive at 09:22
against 09:46 by T6 and T7. Late at night it can say there's no trip when
there is one.

Version 1's planner has to search every mode, buses too, where listing
routes can't work: hundreds of thousands per trip. The planner lab
([scripts/planner-lab/](../../scripts/planner-lab/README.md)) tried RAPTOR,
a search that finds the earliest arrival with each number of rides, and
it's quick enough for the whole city. Alone, it isn't enough for the
options: searched again without each line or change, it finds ways that
are different, not the next quickest, and lost one of the options riders
see open today on 4,344 of the 15,732 trips at 13:00.

## Decision

- **One trip search, in the browser: RAPTOR**
  ([raptor.js](../../tools/subway/client/raptor.js)). It's the Subway
  planner's from now on, and what the Trip page and buses will use. The lab
  searches with the same code, its walks worked out from the straight line.
- **The Subway planner times today's routes and the search's quickest ones
  together**: every route with the fewest changes or one more, as before, and
  the quickest way with each number of rides, up to 3 changes. The options
  are chosen from all of them as before, so today's stay, and the quickest
  way is always among them.
- **A route never gets off at a station it has already been through**, the
  search's as today's: the search alone would sometimes ride out and back only
  to join two walks, which the planner doesn't do, and such a route is left
  out.
- **The tram is in the Subway tool, in the same list.** Every tram stop is a
  row of its own, even one with a metro station's name, as those may be far
  apart: tram Agia Paraskevi is 12 km from the metro station. Those six say
  "(tram)". Names and addresses of metro stations don't change. A switch shows
  or hides the tram, stops and routes together, and it's kept on the device.
  Hidden, the planner is the metro's.
- **`rail.stations` and `rail.lines` stay the metro's alone**, as the station
  pages and the checks read them. `withTram` joins the two in
  the browser, in the same shape, so one planner serves both, and a problem
  with the tram still can't touch the metro.
- **A trip with a tram offers its other ways**: the 3 that arrive first, fewer
  changes first when they tie, and those over 5 minutes slower start closed, as
  the metro's always have. Nothing is dropped for having more changes: riders
  know things the timetable doesn't, like a tram stuck in traffic. Metro trains
  alone stay as they were: a route with more changes than the fewest has to
  arrive 5 minutes sooner to stay, so a direct train is still the only answer.
- **A tram leg has no train diagram**, nor any word about where to stand.
- **The tram's times are the feed's**, on the metro's week and dates. Unlike the
  metro's ([10](0010-metro-timetable.md)) they aren't held to STASY's: checked
  by hand on 1 November 2026, its first and last trams agree with STASY's tram
  page in all four directions, Fridays included. STASY's table has a fifth row
  the feed doesn't: the last trams from Akti Posidonos to 2nd Agiou Kosma, 00:50
  and 02:02 on Fridays, so the planner doesn't know them. A later feed isn't
  checked.
- **The walks are in `tram.json`, in minutes.** They're first guesses (the
  straight line × 1.3 at 80 m a minute, plus 2 to reach the platform) until
  someone times them. Three aren't official changes, so the map doesn't draw
  them: they're there for what the planner would otherwise say, like riding
  from Faliro to Gipedo Karaiskaki, which is 63 m away.

## What follows

- On the same measure, the first answer is never later than before, and every
  option of today's is still there unless a quicker way takes its place.
  Metro trips without the tram, and so the Trip page, get the same answers.
  A trip takes about as long to plan as before on a desktop.
- The search is made once for each day's trains and kept while the page is
  open. OASA isn't asked for anything more, and `rail.json` is the same file.
- `findRoutes` keeps its limit: the routes it lists are still the ones riders
  have been offered, and the search only adds to them.
- T7 trams from Voula that end at SEF count as ending at Neo Faliro, as SEF isn't
  on the way to Piraeus. A trip to SEF walks the last part. The build warns
  every night.
- Tram stops have no page of their own, so their names aren't links.
- Trams share the road, so their times are less sure than the metro's. The note
  under every trip already says times are approximate.
- The bus trip finder stays on the metro for now. The Trip page has the tram
  since [29](0029-trip-page-tram.md).

## Look again when

- The search finds the options on its own as well as today's routes do: then
  `findRoutes` can go.
- The walks have been timed, or riders say a change is missed.
- A new feed moves the tram's first or last trams away from STASY's page, or
  STASY's tram page turns out worth reading automatically.
