# 80. Bus plates a step darker

Decided 2026-11-26 · In force

## Situation

A bus line's plate was drawn in the raised parts' grey
(`--bs-secondary-bg`): #e9edf4 in light, #1e2538 in dark. That's nearly the
page's colour, 1.09:1 on the light page and 1.24:1 on the dark one, so the
plates read as bold numbers floating on the page. The later buses' time
badges use the same grey, so a plate and a time looked like the same kind
of box.

It wasn't a WCAG failure: a plate's meaning is its number (14.7:1 on it in
light), and the 3:1 rule for shapes (1.4.11) is for shapes needed to
understand or use something.

## Decision

Agreed with the rider on 26 November 2026, from their question. Two
darker tones were shown in both themes, on a real opened stop; they chose
the lighter of the two, "distinguishable, but since it isn't functional,
no need to make it too loud". A darker plate rather than an edge was
their call too.

- **The plate has a grey of its own**, `--wh-plate-bg`: #d3d9e4 in light,
  #262f47 in dark. About 1.3:1 on the page and cards (1.31 and 1.42 in
  light, 1.42 and 1.29 in dark).
- **What's written on it still meets AA**: its number 12.1:1 in light and
  11.1:1 in dark, a link's blue 5.4:1 and 5.5:1.
- **Only the plates change.** Chips, time badges and everything else in
  the raised grey stay as they are.

## What follows

- Plates stand apart from the time badges beside them (11', 13'…).
- A test holds the plate between 1.25:1 and 2:1 on the page and cards, and
  its number and a link's blue at 4.5:1 or more on it, in both themes.
- The Trip page's strip draws a bus in the secondary text grey, not the
  plate's, so it doesn't change.

## Look again when

- The raised grey or the page's colour changes: the plate must still be a
  step darker than both.
