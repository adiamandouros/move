# 76. From and To are one block

Decided 2026-11-26 · In force

## Situation

On the Trip and Subway pages each end of the trip was a bold label, a
full-width input and, on From, the location toggle as words and an icon
("My location", "Nearest") on the label's line. The swap button sat on a
row of its own between the fields, and on the Subway page the walk to the
boarding station was an icon beside its field. The form took about 160 px
before the answer, the Subway page's switches more, and the icons at the
right didn't line up with the fields.

The design review of 26 November 2026 (Claude's, direction A) put it third:
give the answer the first screen back.

## Decision

Agreed with the rider on 26 November 2026 (direction A, step 3).

- **One block, two rows**: From above To, each label small inside its row,
  over the top of its field (a tap on it types there), one divider between.
- **The swap button beside both rows**, at the block's right, between them.
- **The location toggle is its icon alone**, at the right end of From's
  row, blue and filled when on; "My location" / "Nearest" stays its name
  for screen readers and its tooltip. The field itself says what it holds
  ("My location", the nearest station). The rider's call, over keeping the
  words.
- On the Subway page **the walk to the boarding station** is on the same
  row, just before the toggle.
- What a field's status says ("About here, between 41 and 49") is inside
  its row, under the field.
- **At large text** (the block under 20em wide) the row's icons go on a
  line of their own under the field, so what's typed keeps the width.
- The block's edge is `--wh-control-edge` (3:1, WCAG 1.4.11); the focus
  ring is inside the field, round its label too.

## What follows

- The Tab order is From, its icons, To, swap.
- The block is its own stacking context (a size container), lifted over
  what follows so the suggestions open over the page.
- The tram and suburban switches stay under the block, as they were.

## Look again when

- Riders don't find My location without its words.
- A third thing wants a place on From's row: at normal text it holds two
  icons and still leaves the field most of the width.
