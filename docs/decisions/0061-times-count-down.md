# 61. Every time counts down by itself, and is gone once past

Decided 2026-11-17 · In force

## Situation

Wayhop shows when a bus or a train comes as a badge of minutes (7'), live
from OASA or from a timetable ([11](0011-real-data-first.md)). The pages
already kept each time as when it comes, not as a number of minutes, and
worked the minutes out from the clock, but only when they drew the whole
answer again:

- the Buses page every second, so its times counted down;
- the Subway page every 30 seconds;
- the Trip page every minute, never while the keyboard was in its answer
  (so the keyboard isn't lost from under the rider), and not on coming
  back to the page, as the phone stops a page's timers while it's locked.

From the road, 17 November 2026 (roadmap Road · 9 and Road · 14): on the
metro the minutes sometimes seemed stuck, a 7' that stays for minutes and
then jumps, so a rider takes the train for stuck. And a time that had
passed stayed at 0': once a ride was done or being ridden, its badges ran
down to 0' and stayed there, in green, drawing the eye with nothing to say.
On the Trip page a live bus also read a minute less than on the Buses page
for the same answer.

## Decision

The rider's idea, agreed on 17 November 2026: every time shown counts down
on its own, signal or not, until a fresh answer draws it again; a time
that would read -1' is gone.

- **One rule** (`minutesLeft` in [times.js](../../public/js/core/times.js)),
  for every page. A timetable's time is to the second: 4'30" away reads
  4', and it goes as the train leaves. OASA's is whole minutes: its 2' reads
  0' for the minute after its time, then goes, as the Buses page always
  counted (its `countDown` is the same rule in minutes, and a test holds
  them together).
- **Each badge carries its time** (seconds since 1970, `data-at`) and how
  it was drawn, so `countBadges` draws it again as its minute changes and
  removes it once gone, every second, with no page data. Badges only, so
  it runs while the Trip page holds its answer for the keyboard, and the
  keyboard stays where it is. A badge gone draws the answer again once
  nobody's in it, for what comes after it (the next bus moving up, no
  more trains).
- **Coming back** to the Trip page counts at once.
- **A ride done or being ridden** shows no times on the Trip page: its
  card's or its row's badges, and the stops' of "Any of these buses", are
  gone. Waiting for it, they're there.
- **No signal:** no extra cutoff. Times count down to -1' and the existing
  "live times may be older" line above the answer is the warning.

## What follows

- OASA is asked no more often: nothing about when stops are asked changes.
- A live time keeps counting from OASA's last answer for as long as there's
  no signal, so a late bus can go from the page before it comes. The line
  above the answer says the times may be older; a fresh answer brings it
  back.
- The Trip page reads OASA's times as the Buses page does: a bus 6'30" from
  an answer 30 s old is 7' on both.
- The times count against the phone's clock, as before; a phone whose clock
  is wrong had wrong timetable times already.
- The Buses page is unchanged: it draws its stops itself as their minutes
  change.

## Look again when

- Riders find buses gone from the page that were still coming, with no
  signal: a cutoff, or a "~" after some minutes, would say so instead.
- A page draws times another way than `minutesBadge` or the Subway page's
  `departureChip`: it needs `data-at` to count.
