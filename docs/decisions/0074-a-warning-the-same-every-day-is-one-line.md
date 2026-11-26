# 74. A warning that's the same every day is one closed line

Decided 2026-11-26 · In force

## Situation

OASA's metro timetable ended on 31 October 2026 and no newer one was out.
From 1 November the subway planner and the trip page showed a warning above
every answer that used it: three lines of yellow on a phone ("Departure
times come from the OASA timetable that ended on 31/10/2026. They may have
changed since."), the same words every day, louder than the answer under
it. DESIGN.md's own principle is that the answer is the loudest thing, and
[43](0043-messages-and-nothing-under-the-answer.md) had already put a "~"
on every time that comes from a timetable, so each time it touches says it
too.

The design review of 26 November 2026 (Claude's, direction A) found it the
second-worst thing on the pages, after the home page.

## Decision

Agreed with the rider on 26 November 2026.

- **The timetable warning is one closed line**: the step-free notice's
  closable box (`closableNotice` in
  [html.js](../../public/js/core/html.js)), its first line what happened
  ("The OASA timetable ended on 31/10/2026", "The metro timetable has
  ended"), the rest under it once opened. Same tone (a warning), icon and
  place as 43 says.
- **Closed on every page.** Opened, it stays open while that page draws its
  answer again (the planner's 30-second refresh), and the keyboard stays on
  it; the next page starts closed. Not kept on the device, unlike the
  step-free notice: nothing about it is the rider's own.
- Only this warning. A warning about today (a disruption, a way that can't
  be caught any more) and every error stay open: they're new each time.

## What follows

- The next warning that would say the same thing day after day is closed
  the same way; one that's about today isn't.
- The station pages' "timetable ended" line under the first and last trains
  is a quiet sentence already, and stays as it is.

## Look again when

- A rider misses that the times may be off because the warning was closed.
- OASA publishes a newer timetable: the warning goes by itself, and this
  stays for the next time one ends.
- A second warning that repeats every day appears: it should be closed the
  same way, or this should say why not.
