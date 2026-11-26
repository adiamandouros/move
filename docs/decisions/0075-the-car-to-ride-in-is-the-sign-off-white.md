# 75. The car to ride in is the station sign's off-white

Decided 2026-11-26 · In force

## Situation

The train diagram marked the car to ride in with amber (`#f59e0b`, a tint
with an amber edge and symbol). On the same Subway answer the timetable
warning was yellow (`#ffc107`) and the second-to-last train amber
(`#fbbf24`). Side by side the three read as one colour, so the most useful
highlight on the card, where to stand, looked like a warning. DESIGN.md's
"one meaning per colour" was broken by three near-identical hues.

The design review of 26 November 2026 (Claude's, direction A) put it second
on its list, after the warning itself ([74](0074-a-warning-the-same-every-day-is-one-line.md)).

## Decision

Agreed with the rider on 26 November 2026 (direction A, step 2).

- **The car to ride in is solid, in the station sign's off-white**
  (`#f4f5f7`, `--wh-sign`), its symbol in ink: "stand here", like the sign
  on the platform, and the brightest thing on a dark card.
- **On light it's the other way round**: an ink car (`#0f131c`) with an
  off-white symbol, as an off-white car would vanish on a white card.
- Its name under the cars ("Near Back") is in the same colour, bold.
- Yellow stays for warnings and the brand, amber for the second-to-last
  train. A lift's blue on the car still reads (3:1, tested).
- Forced colours: unchanged, the car gets an outline.

## What follows

- `--wh-highlight` is the car's fill and `--wh-on-highlight` its symbol;
  test/accessibility.test.js checks the car against the card and the other
  cars, its symbol and a lift on it, in both modes.
- Nothing else may use the off-white as a fill for a part of a card but
  signs and this car.

## Look again when

- A rider reads the bright car as "full" or "closed" rather than "ride here".
- The station signs' panel changes colour: the car follows it.
