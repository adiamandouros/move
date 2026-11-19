# 64. The trip page: the other ways can be taken

Decided 2026-11-19 · In force

## Situation

Since [62](0062-other-ways-timed-by-oasa.md) and
[63](0063-other-ways-follow-the-rider.md) the Trip page lists up to two
other ways under the way shown in full, timed by OASA and, once the rider
is followed, from where they are. They could only be read: the way
followed was always the half hour's own (or the quicker way, or the
switch's). Agreed on 18 November 2026 as the step after them (roadmap
Road · 10 · 3): a tap on another way makes it the way shown, so the rider
can follow it. 63 left it under "look again when": a way chosen has to be
checked again as it's taken.

Planned with the rider on 19 November 2026: eight choices, each with its
options, taken as recommended. Built in two pull requests: before the
rider leaves and kept with the trip first; walking or waiting, on a ride
and the check on the tap next.

## Decision

A tap on another way takes it, by where the rider is:

- **Before they leave** (the half hour's ways): it becomes the way shown
  in full, with "The way you picked" in its heading in place of "Best on
  most departures", and the way it replaced goes among the other ways, to
  take back the same way. It's found in each new half hour by its key
  (`rowKey` in answer.js: its rides, or for a last bus that can be any of
  several, where that's caught). When a new half hour no longer has it,
  the half hour's own is first again, and a warning above the answer says
  the way picked can't be caught any more.
- **Followed, walking or waiting** (the ways from where they are): the
  trip is planned again from there, as off the way
  ([60](0060-trip-follows-within-20-metres.md)), with that way picked by
  its key.
- **Followed, on a ride** (the ways off it): taken at once, as the
  switch's "Take the quicker way" ([50](0050-trip-follows-the-ride.md),
  T14): the rider stays on their step, "Back to my route" goes back. A
  countdown on the switch is called off, its way not declined. Gone back
  from, the way taken is never offered by the switch again, and stays
  listed (63).
- **How it looks** (DESIGN.md, T18): the whole card is one button, a
  chevron at its right, one Tab stop each, said "Take this way: …". From
  the keyboard, the keyboard goes on to the way shown's heading; a tap is
  said.
- **Every way can be taken**, live or not: one OASA hasn't listed yet is
  timed by the timetable, with "~", as the way shown in full is.
- **Checked on the tap**: a way with a bus has its first bus's stop asked
  again if that answer is older than 30 s (the server keeps a stop's
  answer that long anyway), at most one request a tap. When its bus can't
  be caught any more it isn't taken: that's said, and the ways are
  searched again at once.
- **Kept with the trip** ([52](0052-trip-kept-on-the-device.md),
  [58](0058-trip-ride-kept.md)): before the rider leaves, the way picked by
  its key, a change to the trip (3 hours from then); on a ride, the way
  itself, as it can't be searched again from the start. A way taken from
  the switch is kept the same way, which it wasn't before.

## What follows

- For OASA: nothing more before the rider leaves; the way picked is timed
  as the way shown in full always is, the one it replaced as another way.
  The check on the tap is at most one request a tap, said `&for=plan-take`
  and counted on /admin/usage ("Trip page stops checked as another way is
  taken"). It asks only for a way whose bus OASA had coming, as only then
  can that bus be gone: the same vehicle in the new answer (or any bus
  where OASA gives no vehicle codes) is still caught; with no answer in
  5 s, the way is taken on the answer there is.
- A way picked is on the device with the trip, nothing more than the trip
  already is; the privacy page already says the lines and stops taken are
  kept.
- On a decision, a way picked other than the directions has no quicker way
  under it; taking the directions back brings it back.

## Look again when

- Riders take ways by accident on a moving bus (then: a step to confirm on
  a ride).
- A half hour's ways often change their keys from one rework to the next,
  so a way picked is said to be lost when it's really still there.
