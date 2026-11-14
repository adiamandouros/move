# 54. The Info page: a map of the suburban railway in the city

Decided 2026-11-15 · In force

## Situation

The Info page has schematic maps of the metro and the tram (Maps). The
suburban railway is in the planners since [41](0041-suburban-railway.md),
but had no map, and the metro map didn't show where you can change to it.

Its four lines run 46 stations, out to Kiato (A4) and Chalkida (A3), far
beyond Athens, and share long stretches of track: A1 and A4 from Piraeus to
Kato Acharnai, A1 and A2 from Metamorfosi to the Airport, A1, A3 and A4 into
Athens. The tram meets it nowhere. It meets the metro at the 8 walks in
`suburban.json` (Piraeus, Athens to Larissa Station, Nerantziotissa,
Doukissis Plakentias, Pallini, Paiania-Kantza, Koropi, the Airport); Tavros
and Irakleio share a metro station's name but are 1 km or more from it.

## Decision

Agreed with the rider on 15 November 2026.

- **A third map, Suburban railway, after the tram's**, drawn as the others
  are: black, schematic, zoomable, each station opening the subway page
  with it as the destination (by the id the planner gives it), and a list
  of stations by line beside it.
- **Only the city's stations, and the Airport**: the 24 inside OASA's ticket
  (`trains.json`'s `outside` are left out) and the Airport, the one
  exception. Where a line goes on, a short arrow in its colour says where
  its trains end ("to Chalkida", "to Kiato"); the list says it in a
  sentence after the line's stations.
- **Lines side by side on shared track**, each in its own colour all the
  way, so a line can be followed by its colour. A station on more than one
  line is a white bar across them.
- **Changes only where the planner walks**: the metro map gets stubs to the
  railway's lines at the 8 walks (after the tram's, at Piraeus), the
  railway's map stubs to the metro's; SKA's two stations are joined by
  their footbridge. Tavros and Irakleio get none. The tram's map doesn't
  change.
- No mark for the ticket zone: what's drawn is inside it, but for the
  Airport, which the Tickets section covers.

## What follows

- `trains.json` carries each line's name and colour (`suburban.json`'s),
  for the map; the metro map draws without the railway's stubs if
  `trains.json` can't be had.
- The map's lines come from the trains of the days `trains.json` holds:
  each line's ways of running that no other holds.
- Its colours need no change for the black map: A1, A3 and A4 are faint
  only on the light page, and all four pass 3:1 on black (A2's purple at
  3.1:1).
- A3's line crosses A1's between stations, as the tracks do; the layout
  says so (`CROSSINGS`), and the layout test allows only that.

## Look again when

- A line opens or closes a station in the city, or the ticket zone moves
  (`oasaTicket` in `suburban.json`): the layout follows.
- Riders ask for the stations beyond the city on the map.
