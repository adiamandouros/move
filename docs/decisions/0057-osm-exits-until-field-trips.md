# 57. The trip page: walks through a metro station's exits, OpenStreetMap's where no field trip has been

Decided 2026-11-15 · In force

## Situation

Since [51](0051-trip-walks-through-exits.md) a walk into or out of a metro
station goes through its nearest exit that goes the rider's way, from the
station editor's `street.json`. Exits are recorded on field trips, one
station at a time: on 15 November 2026, 16 of the 66 stations had them.
Everywhere else a walk still ended in the middle of the platforms.

The rider noticed that OpenStreetMap maps the metro's entrances and lifts.
Measured on 15 November (Overpass, `railway=subway_entrance` within 300 m of
a station): 195 entrances at 56 stations, 107 of them named. Of the 41 exits
the field trips had recorded with a place, 34 were within 20 m of one of
OpenStreetMap's, and 20 had the same Greek name. A few were off: Omonia's
Αγ. Κωνσταντίνου/Κοτοπούλη by 75 m, Agia Varvara's Κρήτης by 44 m.
OpenStreetMap seldom says how an exit is reached (9 entrances say they're
one way only), its lifts carry none of STASY's names, and it marks each door
of a building like Monastiraki's on its own. The rider recorded those doors
as one exit on purpose: anyone there sees one building.

OpenStreetMap's data is under the ODbL. `suburban.json` already keeps
OpenStreetMap's places under it, beside Wayhop's own data under CC BY-SA.

## Decision

Everything 51 decided stands, and:

- **OpenStreetMap's exits are used where the field trips haven't dealt with
  them**: `data/curated/osm.json`, made by `scripts/osm-exits.js`, run by
  hand. The site never asks Overpass. Its lifts aren't used: the Trip page
  doesn't walk through lifts yet, and the editor's lifts go by STASY's names.
- **What the field trips recorded always wins.** One of OpenStreetMap's
  exits isn't used once `street.json` stands for it: one of the station's
  exits within 30 m of it, or with the same name (the streets it names,
  however they're written), or its id in the station's `osm`, the ones a
  field trip confirmed or found not to be there. One rule decides this for
  the build and the editor (`offeredExits`).
- **A building's doors are one exit**: OpenStreetMap's doors of the same name
  within 30 m of each other become one exit, at their middle. Entrances that
  are lifts or closed to the public, and names that are only the station's,
  are left out.
- **Riders aren't told which is which.** On the Trip page an exit from
  OpenStreetMap is walked to and named like any other. One OpenStreetMap
  says is one way only goes that way, as an escalator would. The About page
  credits OpenStreetMap for the exits, as the ODbL asks.
- **The station editor shows them as needing data**: each in the station's
  exits, with "Need data: from OpenStreetMap, not checked on site." Ticking
  "Checked on site", or changing any of it, saves it as one of the station's
  exits. Removing it says it isn't there. Either way its ids go in `osm`, and
  it isn't offered again. Until then the station is marked "unconfirmed
  exits", in place of "street exits".
- **`osm.json` stays under the ODbL**, as do the place and name of an exit
  confirmed from it; the rest of `street.json` stays Wayhop's
  ([LICENSE](../../data/curated/LICENSE.md)).

## What follows

- On the data of 15 November, the Trip page walks through exits at 56
  stations instead of 16: 87 more exits, 54 of them named. At the 16 stations
  with field trips, all of OpenStreetMap's exits are already accounted for
  but one unnamed door at Panepistimio, which the editor offers.
- 10 stations have no exits from either: Agios Eleftherios, Agios Nikolaos,
  the Airport, Ano and Kato Patisia, KAT, Paiania-Kantza, Pallini, Pefkakia
  and Perissos, mostly the M1's surface stations.
- An exit from OpenStreetMap goes both ways unless it says otherwise, so a
  walk may go in by an exit that's only a way out until a field trip says so.
- An unnamed exit says nothing on the Trip page, as 51 has it. A name from
  OpenStreetMap can be one its mappers wrote from memory.
- `osm.json` is about 19 KB; `rail.json` grows by about 7 KB.
- Nothing refreshes `osm.json` by itself: an exit added to OpenStreetMap
  reaches Wayhop when the script is run again.

## Look again when

- The field trips have dealt with every station's exits: then `osm.json` and
  its rule can go.
- Riders find an exit named that isn't there, or a way in that's only a way
  out.
- The Trip page walks through lifts ([51](0051-trip-walks-through-exits.md)
  says when): then OpenStreetMap's lifts, matched to STASY's names.
- OpenStreetMap's entrances change enough to want them fetched on a schedule.
- As 51 says: field trips time the walk from the street to the platforms; a
  station is two buildings, as Piraeus is; walks can be worked out along real
  streets.
