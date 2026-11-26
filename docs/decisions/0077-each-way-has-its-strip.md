# 77. Each way has its strip

Decided 2026-11-26 · In force

## Situation

A way's heading said how long it takes, then its steps followed one by
one. Nothing showed the whole trip at once: a rider read five rows before
knowing it was "walk, metro, done", and the other ways showed their pills
but not how long each part takes, so a long walk to a short ride looked
like any other way.

The design review of 26 November 2026 (Claude's, direction A) put it
fourth: a route strip under each way's heading, then the way in full as a
timeline.

## Decision

Agreed with the rider on 26 November 2026 (direction A, step 4, its first
part; the timeline is the second).

- **Under each way's heading, one strip** the card's width, on the Trip
  page (the way in full, the other ways, the half hour's ways) and the
  Subway page (each route, a closed one too).
- **Each part as wide as its minutes.** A ride is a bar in its line's
  colour (the stations' strip's), a bus the neutral of its plate; a walk a
  dotted line; a wait a thin line.
- **It adds up to the heading's minutes**: from when the way starts, the
  wait for the first train included, to the door. A morning's first train
  and the Subway page's routes start with the walk to it, as their
  minutes do. A wait under a minute isn't drawn.
- **Widths in twentieths**, one class each (`.way-share-1` to `-20`), as
  the pages draw no style attributes (the CSP's aim); every part at least
  one, so a minute's walk still shows.
- **A picture only**: hidden from screen readers, as the steps say all of
  it. Forced colours keep its colours.

## What follows

- The other ways' strip is the small one, so the way in full stays the
  loudest.
- Bus rides are one neutral, whatever the line, as their plates are.

## Look again when

- The timeline (step 4's second part) draws the way's rail in the line's
  colour: the strip and the rail should read as the same way.
- A twentieth turns out too coarse for short parts on a long trip.
