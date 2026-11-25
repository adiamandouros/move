# 73. The trip page: a station that's two buildings, its exits by line

Decided 2026-11-25 · In force

## Situation

Since [51](0051-trip-walks-through-exits.md) a walk into or out of a metro
station goes through its nearest exit that goes the rider's way, and since
[68](0068-trip-exits-and-stations-as-signs.md) the Trip page shows the way
out as its sign. Every exit of a station counted as an exit of every line
there. 51 asked to look again "when a station is two buildings, as Piraeus is
for the M1 and the M3".

The rider's field trip of 25 November 2026 recorded Piraeus:

- **The M1** is a building at street level, reached without stairs, escalators
  or lifts. It has two exits, neither signed: one on the port side, by a slight
  ramp (the way to the suburban railway), and one on a side street, by stairs.
- **The M3** is underground, across a busy road from the port. It has two
  exits: Odissou Square, right beside the M1's stairs, and Piraeus Port, by
  escalators only, with a couple of steps at the street.
- **A change between them** goes through the validators, out to the street and
  in again. Both ways it's by Odissou Square and the M1 exit beside it. From
  the M1 the rider sits at the front, from the M3 at the back (`transfers` in
  positions.json had this already).
- **Lifts**: the Odissou Square footbridge lift is beside the M1. The two Akti
  Kallimasioti lifts are on the port side of the road, where no change can be
  made.

With every exit counted for every line, a walk to the M1 could be sent to the
M3's Piraeus Port exit (37 m from the M1's port-side exit), and a change
between the lines said nothing, as for a change on one platform.

## Decision

Everything 68 decided (and through it 57 and 51) stands, and:

- **An exit can say the lines it serves**: `lines` in street.json, only at a
  station that's two buildings, from the lines that call there. Left out, an
  exit serves every line, as before. The station editor asks for it at a
  station of more than one line ("Lines it serves, if not all"). None ticked,
  or all, is every line. Piraeus: Piraeus Port and Odissou Square for the M3,
  the two unsigned exits for the M1.
- **A walk goes through an exit of the ride's line**: into the station for the
  first ride, out of it after the last, and out or in at a change on foot. The
  nearest that goes the rider's way, as 51 says, among those that serve the
  line.
- **The searches time the walk as before**, to the nearest exit of any line.
  The walk shown keeps those minutes and goes to the line's exit. At Piraeus
  the two are at most 37 m apart, under a minute. Timing each line's walk
  apart would mean a stop per building in the city's search and a station per
  building in the metro's, everywhere stations are named. That isn't worth it
  for one station.
- **A change between a station's two buildings says its way out**, as a step
  of its own between the two cards, like the way out before a walk: "Way out:
  [Odissou Square]". It leaves by the exit of the first line nearest an exit
  of the second (`changeExit`), the same rule both ways. At Piraeus that's
  Odissou Square from the M3, and the M1's stairs beside it from the M1. An
  exit without a sign says nothing (51), so the change from the M1 shows no
  step. The change's minutes stay those of a change at one station.
- **A walk to the suburban railway can say its exit**: `exit` in suburban.json,
  as in tram.json ([51](0051-trip-walks-through-exits.md)). Piraeus's says
  Odissou Square. From a line that exit doesn't serve, the walk leaves by that
  line's nearest exit, which for the M1 is one of its unsigned two, so nothing
  is named.

## What follows

- Only Piraeus has exits by line, so nothing changes anywhere else: the same
  searches, the same minutes, the same OASA requests. `rail.json` grows by the
  lines of Piraeus's four exits, `trains.json` by its walk's exit.
- By the straight line, the M1's stairs are about a metre nearer the suburban
  station than its ramp, so a walk from the M1 to the trains starts at the
  stairs, not the ramp the rider takes. Neither has a sign, so neither is
  named. Only the walking directions' starting point differs.
- An exit from OpenStreetMap ([57](0057-osm-exits-until-field-trips.md)) says
  no lines, so it serves both buildings until a field trip deals with it. At a
  station with one, a change between the buildings says nothing. All of
  Piraeus's are dealt with.
- Step-free ways aren't used for walks yet: the M1's ramp exit and the
  Odissou Square lift are recorded but not chosen for it.

## Look again when

- Another station turns out to be two buildings.
- Riders can say how much they can walk (51): then the ramp and the Odissou
  Square lift are the ways for the change and for the suburban railway, and an
  unsigned exit may need a way to be named in suburban.json.
- Riders find the way out at a change in the wrong place, or miss one from the
  M1 (where nothing is said, as its exits have no signs).
- The change between the buildings is timed on the spot: then its own minutes,
  not one station's.
