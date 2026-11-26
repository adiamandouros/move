# 79. A bus stop is a line over its buses

Decided 2026-11-26 · In force

## Situation

On the Buses page each stop's row had a grey column at its left, 5rem
wide, for the stop's name, code and distance, and the next bus beside it.
The column broke names mid-word ("PL. SYNTAGMAT OS") and left where the
next bus goes too little room ("AER/NAS ATHIN…"), though that's what
decides whether to get on it. Below 18 letters (large text) the row
changed shape altogether. The favourite star showed only once a stop was
opened, as a closed row had no room for it. The Trip page draws its stops
where any of several buses will do with the same row
([48](0048-trip-bus-stops-as-buses-rows.md)).

Opened, a stop listed every bus OASA sent, one row each. On a real answer
that's the same line again and again: at Syntagma (10361) on 26 November
2026, the X95 seven times, each row "AER/NAS ATHINON - SYNTAGMA
[EXPRESS]" with a smaller plate than the closed row's, a line between each,
then "Lines:" with every line's plate in blue. The rider, who built the
page, found it intimidating: about 20 numbers in four kinds (plates, line
links, the stop's code, minutes).

The design review of 26 November 2026 (Claude's, direction A) proposed the
stop as a one-line header with its buses as full-width rows under it; the
opened stop was looked at again the same evening, with mock-ups on real
answers.

## Decision

Agreed with the rider on 26 November 2026 (direction A, step 5): the star's
place by their call, and of four proposals for the opened stop, three (a
row a line, one plate size with no lines between, the code inside).

- **Two lines.** On top, the stop's line: its name, how far it is, and at
  its right end the star and the walking figure. Under it the next bus
  across the whole row: its plate, where it goes (up to two lines before
  it's cut short) and its minutes at the right, level with the plate.
- **The star is always there**, on the stop's line before the walking
  figure, opened or not (the rider's call, of three: there always, only
  once opened as before, or a "Star this stop" button inside).
- **Opened, the list takes the next bus's place**, drawn as it is: one row
  a line and where it goes, in the order of their first bus. The line's
  next bus is the badge at the right; its next two are under where it
  goes, "then in 15', 31'". Those are badges too (they count down by
  themselves on the Trip page, as decision 61 has every time), drawn as
  the words around them: a quiet line, not three more boxes. A stop with
  no bus on its way keeps the next bus's line (on the Trip page, "Not on
  live times yet").
- **One plate size, one edge, no lines between.** The list's plates are
  the closed row's large ones, every plate in a stop as wide, so where
  each bus goes starts at one edge. The space between the rows groups
  them; the line under the stop ends it.
- **The stop's code only inside**, as "Stop 10361" above its lines: on the
  stop's line it was one number too many for someone new. Screen readers
  still hear it with the name, as five stops near Syntagma are all
  called SYNTAGMA; on screen, how far each is and its next bus tell them
  apart. Searching by code works as before.
- **"Lines:" stays** as it was, each line's plate a link to its stops
  (a quieter "N more lines stop here" was offered and not taken).
- **At large text** (below 18 letters wide) where a bus goes moves under its
  plate, on as many lines as it needs, the time beside the plate.
- The button that opens a stop still holds both lines, so a screen reader
  hears the stop and its next bus as before, and the keyboard goes from it
  to the star, then the walking directions.

## What follows

- A closed stop is 83px tall on a Pixel 7, from 68px (97px where a long
  name broke over three lines): about one stop fewer on the first screen,
  every destination whole or on two lines, every name on one.
- At 10361 the opened stop is one row instead of seven. A stop where eight
  lines come once each (60718) still has eight rows: there, it's the
  lines between and the plates' edge that go.
- A line's buses after the third aren't shown (OASA sent up to 76' ahead).
  The next three are what decides whether to wait.
- The Trip page's stops change with it, without a star as before.
- Which stop the Buses page's request trace opens after a scroll changed
  (the rows are taller): 42 requests as before, the same rules; OASA is
  asked no more often.
- OASA's route names (both ends, roadworks notes, capitals) stay as OASA
  writes them. They're now the busiest part of an opened stop.

## Look again when

- The Trip page's rail ([78](0078-the-way-in-full-is-a-timeline.md)) is
  looked at: without the left column, these rows may fit beside the rail,
  so it could run on through "Any of these buses".
- Riders miss the code on the stop's line, for instance to tell stops
  apart on the street.
