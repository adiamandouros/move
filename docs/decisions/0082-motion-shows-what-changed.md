# 82. Motion shows what changed

Decided 2026-11-26 · In force

## Situation

Wayhop had almost no motion: a spinner, colour fades on hover, chevrons
that turn. Pages switched with a blank flash, a minute changed in place,
a list jumped open. The design review of 26 November 2026 (direction A,
step 7) proposed seven small motions, each answering something the
person did or a time that changed.

## Decision

Agreed with the rider on 26 November 2026: all four groups, one pull
request each, in this order.

1. **Moving between pages**: the page cross-fades and the current tab's
   highlight slides to the new one, the bars staying put (CSS's
   `@view-transition`, a quarter of a second). The station editor has
   none.
2. **Times**: a badge's minute rolls up when it changes and grows once
   as it turns due; a bus badge OASA's new answer changed gets one short
   ring, unchanged ones stay still.
3. **Opening lists**: stops on the way, the legend, Info's sections and
   Home's disruption line open to their height rather than jumping.
4. **On the Trip page**: the way taken slides into first place, the
   switch's countdown gets a bar that drains (pausing as its timer does),
   and a new answer's strip draws left to right once, never on a refresh.

For all of them:

- **Nothing moves when the phone asks for less motion**
  (`prefers-reduced-motion: reduce`): it's as before.
- **Nothing loops, nothing plays on every card**: no entrances, no hover
  lifts, no pulsing "live" dot, no skeleton shimmer.
- **A browser that can't do one just shows the change**, as before.

## What follows

- Each step's tests check it plays, and that it doesn't with reduced
  motion (`test/browser/motion.spec.js`).
- A transition between pages cut short by the next page rejects its
  promises; `shell.js` catches them, as they're nothing to report.

## Look again when

- The rider finds any of them slow or distracting on the phone: each
  group is its own pull request, so it can go alone.
