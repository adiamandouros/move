# 83. The trip page: on a ride, the other ways only when sooner, and where they leave it

Decided 2026-11-28 · In force

## Situation

To a rider followed on a ride, the other ways shown are the ways the search
ahead finds off it ([63](0063-other-ways-follow-the-rider.md)): the soonest
there first, at most 2, whatever they are. Each card showed only its rides
from where it leaves the ride, and its walk from there.

From the road, 27 November 2026, on the M3 both ways between Korydallos
and Chalandri, with little signal. The rider's screenshots, replayed on
that day's data, showed:

- "Walk ~1' · 460 from ST. XALANDRI", arriving at 08:16: stay on to
  Chalandri, the trip's own end, then ride the 460 one stop, to the
  other stop of that name. Staying on got there at 08:11.
- "Walk ~6' · 451 from THISEOS", arriving at 08:50: off one station early,
  at Agia Paraskevi, then the 451 back three stops, with OASA's bus 51'
  away.
- On the way back, "Walk ~1' · 810 from ST. KORYDALLOS": stay on to
  Korydallos, then the 810 one stop and a walk back to the station.
  Staying on got there at 19:22, this at 19:27.

Every one was a detour, slower than staying on. And with the ride left
out, "Walk ~1'" read as a walk from where the rider was, under the centre
of Athens.

Agreed with the rider on 28 November 2026.

## Decision

Everything [72](0072-trip-first-way-by-live-times.md) decided stands, and
[63](0063-other-ways-follow-the-rider.md)'s other ways on a ride change:

- **Only ways there sooner than staying on.** On a ride, another way is
  shown only when it gets to the door before the way followed does,
  both as timed now: OASA's times where it has them, the timetable's
  elsewhere (searcher.js). A way the search ahead finds that gets there
  later, or at the same time, is a detour off the ride and isn't shown.
  Of those sooner, the soonest first, at most 2, as before. None sooner:
  none shown.
- **Not while walking or waiting.** The ways from where the rider is
  ([63](0063-other-ways-follow-the-rider.md)) stay as they were: slower
  ones can be shown there, as the half hour's ways can. Riders know
  things the timetable doesn't, and off a ride the rider can still choose.
- **Where it leaves the ride, said first.** A way found off a ride says
  where the rider gets off before its walk and rides: "Off the M3 at
  Chalandri · Walk ~1' · 460 from ST. XALANDRI" (Greek: "Κατέβα από το M3
  στον σταθμό Χαλάνδρι", or "στη στάση" off a tram or bus). Its strip
  draws the rest of the ride in the line's colour, from now to where it
  leaves it, not as a wait.

## What follows

- For OASA, nothing new: still the first bus's stop of each way shown, at
  most 2 a trip; a way not shown asks nothing.
- On a single train ride, the trip's way in full is often the only
  answer: the list shows nothing then, as it does when the search finds
  nothing.
- The switch ([50](0050-trip-follows-the-ride.md)) is as it was: it
  offers a way 3' or more sooner, and that way isn't in the list.
- A way that was sooner can drop out at the next timing, once OASA has
  its bus later, and come back when OASA has it sooner again.

## Look again when

- Riders want slower ways on a ride too, for a train that has stopped
  (a breakdown or a strike), when staying on isn't really a choice.
- A way only seconds sooner, with a change, turns out to be shown too
  often.
