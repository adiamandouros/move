# 68. The trip page: exits and metro stations as the signs riders follow

Decided 2026-11-21 · Replaced by [73](0073-trip-stations-of-two-buildings.md)

## Situation

Since [51](0051-trip-walks-through-exits.md) and
[57](0057-osm-exits-until-field-trips.md) the Trip page names a metro
station's exits in plain text: "Way in: Syntagma Square · About 300 m" under
the walk into a station, and "Way out: Amalias/National Garden" as a step of
its own after a ride. The station a walk goes to was plain text too.

On 17 November the rider asked for the station in "Walk to" and the exit in
"Way out" to look like signs to follow (Road · 11). The design talk of 21
November settled what riders actually see:

- In a station, the way out has its own signs. They are the station signs
  (off-white, the name in bold), with a grey line along the top in place of a
  line's colour.
- At street level an entrance carries only the station's own sign
  ("Syntagma"), never the entrance's name, so naming the way in helps nobody.
- Tram, suburban and bus stops are open and have no signs of this kind.
- Once the rider is in the metro, the walk that got them there has nothing
  left to say: its distance is no use any more.

## Decision

Everything 57 (and through it 51) decided stands, apart from how the Trip
page says an exit:

- **A way out is its sign**: "Way out:" and then the exit sign (`exitSign` in
  `public/js/core/lines.js`). That is the station sign with a grey top edge
  (`--wh-sign-exit`), the same in every theme, and no line colour on its
  bottom edge. This applies to the step after a ride and to each stop of
  "Then any of these buses". Screen readers hear "Way out: …" as before.
- **No way in is named.** The walk into a station still goes through the exit
  57 picks, and its walking directions still lead there. Only the words go.
- **A walk to a metro ride's station names the station as its sign**:
  "Walk to [Syntagma]", with the station's metro lines on its edges, like the
  direction's sign on a leg card. This applies only when the ride from there
  is a metro line. A tram stop, a suburban station (even one that shares a
  metro station's id), a bus stop and the destination stay as words.
- **A walk behind the rider says no distance.** When Wayhop is following the
  rider, a walk marked done drops its "About N m". A suburban change's note
  stays.

## What follows

- The searches, the exits picked, the minutes and the OASA requests stay as
  they were. This changes only how the page looks.
- The `trip.way-in` strings are gone.
- A long exit name wraps inside its sign, as station signs already do at
  large text sizes.

## Look again when

- Field trips find exit signs that differ from this, such as a colour other
  than grey, both edges, or a pictogram worth drawing.
- Entrances at street level turn out to be named somewhere riders see them.
- Tram or suburban stops get signs worth drawing.
