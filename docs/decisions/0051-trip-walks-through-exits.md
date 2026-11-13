# 51. The trip page: walks through a metro station's exits

Decided 2026-11-13 · In force

## Situation

Since [37](0037-trip-one-walk.md) every walk the trip page times is the
straight line × 1.4 at 80 m a minute, to where a station is: one point,
the middle of its platforms. A rider doesn't walk there. They walk to one
of its exits, and at a big station the right one can be 150 m from the
wrong one, across a square or a busy road.

The station editor has recorded each exit's name, its place and how it's
reached from inside (`street.json`, since #166). On 13 November 2026 there
were 34 exits at 12 stations, every one with a place: Korydallos, Agia
Varvara, Agia Marina, Aigaleo, Elaionas, Kerameikos, Monastiraki,
Chalandri, Syntagma, Neos Kosmos, Panepistimio and Omonia. None of it
reached the trip page. Not every exit goes both ways: Agia Varvara's
Kalantzakou exit has only an escalator up. Not every exit leads to a
connection either. The rider's field trips found that Syntagma's tram is
reached only by the Amalias/National Garden exit, and Neos Kosmos's by
Kassomouli/Pissa.

The rider asked for this on 12 November. The plan session of 13 November
settled the details, and asked for the minutes from the street down to the
platforms to be measured first, at 2 minutes at every metro station, as
the tram's walks count them ([25](0025-trams-in-the-planner.md)). Measured
on 37's set (400 random trips within 10 km of Syntagma, at 08:30 and 13:00
on a Wednesday, 800 in all), on the data built on 13 November, against the
page as it was:

| | First option changed, metro and tram | First option changed, with buses | First option by metro (642 before) | Same first option, later by |
|---|---|---|---|---|
| Exits only | 14 (1.8%) | 52 (6.5%) | 645 | a median 0′ |
| Exits and 1′ to the platform | 39 (4.9%) | 152 (19%) | 619 | a median 1′ |
| Exits and 2′ to the platform | 59 (7.4%) | 219 (27%) | 591 | a median 2′, at most 20′ |

The platform's minutes land at every metro station and at every change
between the metro and a bus, and never at a bus stop, so they moved trips
off the metro. With 2 minutes, a rider's rule from their own trips
(Korydallos to Peristeri: M3 to Aigaleo, then a bus, first on most
departures) no longer held. The rider chose exits only.

## Decision

Everything [48](0048-trip-bus-stops-as-buses-rows.md) decided stands, and:

- **A walk into a metro station or out of it goes through its nearest exit
  that goes the rider's way**, by the straight line: in by the stairs or an
  escalator down, out by the stairs or an escalator up. An exit without how
  it's reached recorded goes both ways. The minutes and the distance are
  from that exit, still the straight line × 1.4 at 80 m a minute.
- **Wherever a walk meets a metro station**: from the door, to the door, and
  on a change between the metro and a bus or a tram stop. Both searches do
  it the same way: the metro and tram one (`tools/trip/client/plan.js`) and
  the city's (`tools/subway/client/city.js`, `streetEnd`).
- **How far a station is stays measured to where it is.** So the same
  stations are tried, within 16 minutes, and the same changes, within 10.
  Only the minutes of a walk come from the exit.
- **A walk between the tram and the metro that needs one exit says which**:
  `exit` in `tram.json`, the exit's Greek name in `street.json`, for
  Syntagma and Neos Kosmos so far. A walk that doesn't say names no exit,
  since the nearest may not lead there. Its minutes stay `tram.json`'s. The
  city's search now takes these walks as known walks, as the subway planner
  always has. A name `street.json` doesn't have is a warning, never an
  error, so the station editor is never blocked
  ([16](0016-station-editor.md)).
- **A station picked as the start or the end is its platforms**, with no
  walk to an exit, as before.
- **No minutes from the street to the platforms.** Until field trips time
  some, a walk ends at the exit.
- **How it's shown**: going in, the walk step's grey line says
  "Way in: Syntagma Square · About 300 m", and its walking directions lead
  to that exit. Coming out, a step of its own after the ride's card says
  "Way out: Syntagma Square", and the walk after it starts there. In Greek,
  «Είσοδος:» and «Έξοδος:». The name is in the page's language, or the other
  one when only one is recorded, without the sign's "Exit" or "Έξοδος". A
  station without exits recorded, or an exit without a name, says nothing,
  as before. Following the rider's ride
  ([50](0050-trip-follows-the-ride.md)), a walk into a station ends at its
  exit.

## What follows

- At the 12 stations a walk is a minute or so shorter or longer than
  before. Of the 66 first options that changed in the measurement (both
  searches), 31 get there at the same time, 29 sooner (by 1 to 17 minutes:
  a nearer exit, or a tram walk the city's search now knows) and 6 later
  (by 1 to 10). Elsewhere nothing changes until the station editor records
  exits.
- `rail.json` carries each metro station's exits with a place (`exits`,
  about 3 KB), and the tram's walks the exit they go through.
- Making the day's city takes about 10% longer on a computer (150 ms
  against 135), the searches no longer.
- A walk still knows nothing of the streets: the nearest exit by the
  straight line can be across a road with no crossing.

## Look again when

- Field trips time the walk from the street to the platforms at a few
  stations: then the platform's minutes, measured as above, perhaps per
  station.
- A station is two buildings, as Piraeus is for the M1 and the M3: then an
  exit says which lines it serves.
- Riders can say how much they can walk (the stairs, escalators only, lifts
  only), once most stations have their exits: the street's lifts become the
  ways in.
- Riders find an exit named that isn't the one they'd take.
- As 48 says: riders miss seeing each line's minutes at a stop without
  opening it; riders want to save a stop from the trip page; as 46 says:
  riders find the way too long to read on a phone; as 39 says: enough rides
  are measured to rank buses on a bad day; riders find a bus offered first
  through the centre when the metro is quicker; the trip page's searches on
  /admin/usage come close to what 50 allows; riders miss starting from a
  bus stop; walks can be worked out along real streets.
