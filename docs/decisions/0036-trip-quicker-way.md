# 36. The trip page: the quicker way on a decision, offered from OASA's live times, the buses behind a switch for now

Decided 2026-11-07 · In force

## Situation

Since [35](0035-trip-live-times.md), `/trip?buses` times the way it shows
in full again with OASA's live times. When the half hour's answer is a
decision on the way (two ways on the same first ride, one leaving it sooner
for a bus, each well ahead of the other often enough: `answer.js`), the page
shows the directions that stay on, and the other way was only on the
`/trip?timing` line.

Agreed with the rider on 3 November (Plan 5, the trip answers mock-up):
no warnings about decisions; the directions come first, and the quicker way
is offered only when OASA has its bus coming in time, padded by how late
buses run that far out, and saves 3 minutes or more; the rider chooses.
Record [35](0035-trip-live-times.md) said this was next, with the same
asking at the decision's stop.

## Decision

Everything [35](0035-trip-live-times.md) decided stands, and on a decision:

- **The directions stay as they are**, timed with the live times they have.
- **The quicker way's bus stop is asked for too**, right after the stops of
  the directions' own bus rides, within the 10 stops a trip and on the same
  tiers as the others ([34](0034-load-on-oasa-with-live-trips.md)): by when
  the first of its buses the rider can catch there comes, from when the
  first ride, as timed now, gets to the change. Directions with no bus of
  their own ask for that one stop.
- **It's offered under the directions** (`quickerWay` in `answer.js`, from
  `liveWay` in `tools/trip/client/buses.js`) when OASA has one of its buses,
  matched by OASA's route, coming after the rider can be at its stop, and,
  padded by how late buses come that far out (by how far ahead OASA said it,
  not by now), it gets there 3 minutes or more sooner than staying on.
  Staying on is timed as the way is now; when its last bus can be any of
  several, by the first of them to get there, by the timetable or by OASA's
  buses at its stops. An older answer offers nothing. So a quicker way may
  be offered too rarely, not too often.
- **What it says**: how much sooner, in whole minutes; get off the first
  ride at the change, for the bus, due at its stop at OASA's time, and the
  walk there. Then "Take the quicker way" or "Keep my route". It's said to
  a screen reader when it comes up.
- **Taken**, the quicker way is the way shown in full, timed with the live
  times as any way is, marked "The quicker way", with "Back to my route".
  **Kept**, nothing more is offered for the trip.
- From the keyboard, the choice leaves the keyboard on what's there now.

## What follows

- At the door, a rider sees the directions and, when OASA has the bus in
  time, the quicker way, and can take it.
- The page still plans for leaving now, from the start: on the way, the
  directions and the offer are for someone leaving the start this minute,
  not for the train or bus the rider is on. The quicker way is right for the
  rider at the door, and goes on being worked out from there, so the
  decision's stop is asked as often as at the door, not more often as the
  rider's ride nears it. The rider's call, 7 November: following the ride
  will be switched on by "My location", the button beside From. A trip that
  starts where the rider is gets followed, as the position changes along
  the way; one from a typed start is planned ahead and isn't.
- A trip whose directions had no bus asks OASA for one stop, about one
  request every 30 seconds to 2 minutes while it's open and in sight. A
  trip's most, 10 stops, is unchanged.
- Which of OASA's buses at a change is the rider's own still isn't known, so
  how late the rider's bus is at the change doesn't count yet (`here` in
  `quickerWay`).

## Look again when

- The page follows the rider's own ride once they've left, with "My
  location" on: then the offer is for their train or bus, and its stop is
  asked more often as it nears.
- Riders find an offer that wasn't quicker, or a quicker way that wasn't
  offered.
- Enough rides are measured: then buses for everyone, as
  [31](0031-trip-page-buses.md) says.
- Riders find a bus that would do missing because its route has no timetable.
