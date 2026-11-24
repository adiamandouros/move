# 63. The trip page: the other ways follow the rider, from where they are

Decided 2026-11-18 · Replaced by [72](0072-trip-first-way-by-live-times.md)

## Situation

[62](0062-other-ways-timed-by-oasa.md) timed the other ways shown under the
way shown in full with OASA's live times, but not while the rider is
followed on a ride ([50](0050-trip-follows-the-ride.md)): there they were
still the half hour's ways from the start the rider had left. From the
road, 17 November 2026 (roadmap Road · 10): from Agia Marina to Nea Smyrni,
changing to the tram at Syntagma, "Other ways" still listed ways from Agia
Marina. They should follow where the rider is.

Agreed with the rider on 18 November 2026, planning Road · 10, with the step
after it in mind: the other ways become buttons that take that way, so each
has to be one the rider can take from where they are.

## Decision

Everything 62 decided stands, and once the rider is followed along the way
shown in full, the other ways shown are the ways on from where they are,
in place of the half hour's:

- **On a ride**: the ways the search ahead finds from the ride's stops
  still to come (`aheadWays` in
  [buses.js](../../tools/trip/client/buses.js)), searched as before at each
  stop reached, at most once a minute ([50](0050-trip-follows-the-ride.md)).
  The search ahead now keeps every way it finds, one of each kind, not only
  the best; the first not declined is still the switch's (T14).
- **Walking or waiting**: the ways from where the rider is, leaving now
  (`hereWays`), searched with a fix at most once a minute.
- **Not every position.** A fix comes about every second, and a list the
  rider will tap can't move under their finger; a ride's options can only
  change at a stop.
- **Which ways**: the soonest there first, at most 2 as before, never the
  way shown, nor the way the switch is offering. A way the rider kept
  theirs over stays in the list, as they may change their mind; the switch
  never offers it again.
- **Timed as 62's**, each by its next bus, the only stop asked for it, with
  `&for=plan-other`; on a ride, from where the rider is on it.
- **Drawn as 62's**: its minutes and "Arrive about …", and from where it
  leaves the ride they're on, its rides and its first bus's badge. A search
  that finds none shows none. The list stays until the next search.

## What follows

- For OASA, nothing new: still at most 2 stops a trip for the other ways,
  on the same tiers. On a ride they're the next bus's stops ahead, not the
  start's.
- On the phone, one departure of the city's search a minute while walking
  or waiting, about a hundredth of a second on a laptop, in the worker; on
  a ride, the search ahead already ran.
- Until the first search after leaving the start (the first fix on the
  walk), the other ways are the half hour's, as 62 times them: from the
  start, which the rider is still near.
- Once the rider switches to a way found ahead, the list stays as it was,
  without that way, until the search at the next stop.
- A rider who walks off the way is planned again from where they are, as
  before ([60](0060-trip-follows-within-20-metres.md)), and the other ways
  are the half hour's of the new plan until the next search.

## Look again when

- The other ways become buttons that take that way (roadmap): a way chosen
  has to be checked again as it's taken.
- Riders find the other ways stale on a ride (stops far apart, a minute too
  long), or jumping about while they walk.
- Following by speed and direction (roadmap "Follow · motion") changes when
  a step or a stop counts as reached.
