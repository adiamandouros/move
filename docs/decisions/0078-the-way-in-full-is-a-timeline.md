# 78. The way in full is a timeline

Decided 2026-11-26 · In force

## Situation

On the Trip page, the way shown in full drew each metro, tram or suburban
ride as the Subway page's card, box and all, inside the trip's card
([46](0046-trip-rail-rides-as-cards.md)). That made boxes inside boxes, and
the steps had nothing joining them. The strip under the heading
([77](0077-each-way-has-its-strip.md)) showed the whole way at a glance,
but nothing in the steps below matched it.

The design review of 26 November 2026 (Claude's, direction A) proposed the
way in full as one timeline, its rail drawn in the line's colour as the
black maps draw it, and the leg cards without their box.

## Decision

Agreed with the rider on 26 November 2026 (direction A, step 4, its second
part).

- **A rail down the steps' left column**, the 3rem column a walk's minutes
  and a bus's clock time already use. It's drawn the way the strip draws
  each part: a walk (and a "Way out:" step) a 3px dotted line, a train's
  ride a bar in its line's colour (`.strip-m1`), a bus's the plate's
  neutral. Each step's minutes or clock time sit on the rail, with the
  card's colour around them.
- **A train's ride is its card beside the rail, without its box**: no edge,
  no fill, no padding, and everything the card says left as it is. A
  station's mark crosses the rail where the train is boarded, and the way
  ends at a square. Both are in the text's colour, so they show in either
  theme (the sign's off-white was lost on the light card).
- **Where any of several buses will do, the rail pauses.** There's no one
  line through several stops, and beside a rail the Buses page's stop
  rows fall back to their stacked layout, twice as tall. So they keep the
  card's width as before, and the rail starts again under them.
- **Behind the rider**, the rail of the steps done fades with them. The bar
  marking the step they're on stays in the card's padding.
- **At large text** (the steps narrower than about 14 letters, as for the
  left column already) there's no rail: the steps go one under the other
  and a ride's card takes the whole width.
- **A picture only**, as the strip: the steps say all of it.

## What follows

- The train diagram is about 26px narrower on a phone (286px of a 380px
  card on a Pixel 7, from 312px): the card's box gave back 34px, the rail's
  column took 60. Its labels ("Near Back") can take two lines.
- The Subway page keeps its cards boxed. Its routes are a list of cards
  with "Change to" between them, not one way in full.
- Decision 77's "look again when the timeline draws the rail" is answered:
  the rail's colours, dots and grey are the strip's.

## Look again when

- The Buses page's stop rows change (direction A, step 5): if they fit
  beside the rail, the rail can go on through them.
- The narrower train diagram turns out to be hard to read on small phones.
