# 72. The trip page: a way quicker by OASA's live times comes first

Decided 2026-11-24 · In force

## Situation

The Trip page's first card is the way the half hour's answer stands for
([33](0033-trip-half-hour-answer.md)): picked on the timetable and the
weights, before OASA says anything. OASA's live times then time it
([35](0035-trip-live-times.md)) and the other ways shown
([62](0062-other-ways-timed-by-oasa.md)), but they never moved the first
card: [62](0062-other-ways-timed-by-oasa.md) left that for roadmap item
"OASA rank".

From the rider, 24 November 2026: near Omonia to Menelaou 25 in Kallithea,
evening. The first card was "whichever of these buses comes first", the 5
or the A2, 25–45'. OASA had the 5 28' away and no A2 at all. Under "Other
ways", the M2 to Syggrou-Fix and then any bus got there in about 33'.
Why was the slower way first?

Agreed with the rider the same day, on that trip.

## Decision

Everything [63](0063-other-ways-follow-the-rider.md) decided stands, and
the other ways shown can take the first card's place:

- **Compared by the weights on live times.** Each way shown, as OASA's
  live times have it (`liveRank` in
  [buses.js](../../tools/trip/client/buses.js)): when it gets to the door,
  a minute on foot counted as one and a half and each change as 3' on top,
  as the weights put ways in order ([weights.js](../../tools/subway/client/weights.js)).
  Plain arrival would let a metro and a change win a near tie against one
  bus, which the weights were made to stop.
- **A tie or more cheaper leads.** Another way that costs 3' or more less
  than the first card's comes first in its place (`leadOf` in
  [rank.js](../../tools/trip/client/rank.js)); of several, the cheapest.
  The way it replaced goes among the other ways, timed as they are.
- **A bus OASA doesn't show isn't coming.** Once a stop is answered, a line
  OASA doesn't have coming there the rider can catch counts as not coming.
  A stop not answered yet goes by the timetable. A way none of whose buses
  OASA shows has no time on live times, so it can't take the lead, nor lose
  it.
- **OASA's word, not the timetable's hope.** A swap needs OASA's word on
  one side at least: two ways both on the timetable stay as the half hour
  put them, since at one departure the timetable says no more than it did
  over the half hour. And a way whose first ride is a bus from the start
  that OASA hasn't answered for can't take the lead, nor lose it: the wait
  at the start is where the timetable is least to be trusted (the 5 was
  28' away). A bus after a train can go by the timetable, as another way's
  last bus isn't asked for: so the M2 then any bus leads when OASA has the
  first card's bus far off.
- **On a decision**, the way leaving the first ride sooner is the quicker
  way, offered as [36](0036-trip-quicker-way.md) says, so it never leads by
  itself; another way can.
- **"Any of these buses"** gets there by the first of them to, from OASA's
  buses at its stops answered (each as long to the door as its line's ride
  by the timetable) and the timetable's at the others. Shown as another way,
  its heading and its badge are that bus's.
- **It stays.** Once a way leads it stays first until another costs a tie
  less, the half hour's own too, so the card doesn't swap back and forth as
  the minutes move. Nothing moves while either way's cost isn't known.
- **Only before the rider leaves or chooses**: not while followed on the
  way (the switch, [50](0050-trip-follows-the-ride.md), offers a quicker
  way there), and not once they took another way
  ([64](0064-other-ways-can-be-taken.md)), the quicker way
  ([36](0036-trip-quicker-way.md)) or the switch. The way that leads as they
  leave is the way followed. On a decision whose directions another way
  replaces, the quicker way's offer goes with them.
- **Said**: "Quicker right now, by OASA's live times." above the card, in
  place of "It depends on when you leave."; its heading its minutes and
  "Arrive about …" by OASA's times, as another way's timed is, its range
  until it's timed. A screen reader hears it once as it comes first.

## What follows

- No more asked of OASA. The way that leads is timed as the first card
  always is, its own stops asked ([35](0035-trip-live-times.md)); the one it
  replaced as another way, its first bus's stop at most
  ([62](0062-other-ways-timed-by-oasa.md)). "Any of these buses" shown as
  another way still asks nothing: it's timed by the answers the page
  already has for its stops, the timetable's elsewhere.
- So another way's "any of these buses" after a change (the M2 to
  Syggrou-Fix, then any bus) goes by the timetable until it leads and its
  stops are asked. Its time is the timetable's hope, not OASA's word.
- The first card can change a few seconds after the half hour's answer
  shows, as OASA's answers come.
- Roadmap item "Bad day" still stands: it makes the half hour's own pick
  better before OASA says anything; this corrects it once OASA disagrees.

## Look again when

- Riders find a way first that OASA's times didn't bear out, or the card
  swapping more than it should.
- Another way's "any of these buses" after a change turns out to lead on
  the timetable's hope too often: then its stops asked as another way's, a
  number proposed first.
- A way whose buses OASA doesn't show at all stays first too often: the
  rider's call was to leave it, as unknown.
