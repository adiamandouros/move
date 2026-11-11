# 46. The trip page: metro and tram rides as the subway planner's cards

Decided 2026-11-11 · In force

## Situation

Since [29](0029-trip-page-tram.md) the trip page's way shown in full has
been a list of steps: the walks, and each ride on a line of its own, with
when it leaves on the left, its line's pill, where it goes in words and how
many stops; with buses since [31](0031-trip-page-buses.md), the suburban
railway since [40](0040-suburban-railway-timetable.md). Where to stand on
the train wasn't on it: a way with a metro ride had a "Where to stand on the
train" button, which opened the subway planner for its first and last
stations (29: "Where to stand is for the metro"). There each ride is a card:
where to board, the line's pill and the sign of its direction, the next two
trains as badges, the last trains in words, the train diagram with the
carriage to ride in, notes, where to change or get off, and the stations on
the way. The two pages drew the same ride two ways.

On 10 November 2026 the rider went through the trip page against the
Design Guide and decided its version 2 (DESIGN.md, "The Trip page"). Their
own idea there: each metro, tram and suburban ride on the trip page is the
subway planner's card, inside the trip's card, in the ride's place, chosen
over laying the trip page out as the subway planner is, with the walks
between cards. Its badges start at the first train the rider can catch.
Steps 1 to 6 of version 2 are built (#227 to #232): walks and bus rides are
rows with a time on the left, a bus's badges at the right end of its
heading.

A ride of the city's search ([buses.js](../../tools/trip/client/buses.js))
says its line, a metro or tram ride's direction as rail.json names it, the
stations it boards and gets off at, and when it leaves. The card needs the
direction's stations from one to the other, and the trains from there.

## Decision

Everything [39](0039-trip-buses-for-everyone.md) decided stands, and:

- **Each metro and tram ride of the way shown in full is the subway
  planner's card**, the same one (`legCard` in
  [render.js](../../tools/subway/client/render.js)), inside the trip's card
  in the ride's place, with nothing on the left: where to board, the large
  pill → the direction's sign, the badges, the last trains in words, the
  train diagram (the metro's), its notes, where to change or get off, and
  the stations on the way behind their button. In every answer that shows a
  way in full: for leaving now, the next half hour's, and the quicker way
  once taken ([36](0036-trip-quicker-way.md)). Walks and bus rides stay
  rows; the other ways stay one line each.
- **Its badges start with the train the way is timed on**: the first the
  rider can catch there, leaving now (now plus the walk to its platform) or
  after a ride (from when they get there, OASA's live times included), then
  the next after it: two, as on the subway planner, each counted from now.
  Past an hour, and for the morning's first trains, clock times, as on the
  subway planner.
- **The last trains** are red and amber, with the line of words under the
  heading, as on the subway planner.
- **Its ride's minutes always**, beside its stops ("12' · 3 stops"), as the
  trip's heading is door to door. The subway planner shows them only on a
  trip with a change.
- **No "Change to …" line between two cards**: the first card's "Transfer
  at …" and the next card's "At …:" say it, and a walk between them is its
  row.
- **The legend** of what the trains show comes under the way, after the
  quicker way's offer when there's one, before the other ways: only the
  symbols its trains show, open or closed as the rider last left a legend
  on any page.
- **No "Where to stand on the train" button**: the card shows where. This
  replaces 29's "Where to stand is for the metro".
- **The stations on the way** stay open or closed as the rider left them
  while the page refreshes each minute, as long as the trip goes to the same
  place (a start that follows My location included).
- **The subway planner's words** go to the trip page with its own (tool.json
  `borrows`), so the card reads the same on both: no new words.
- **The suburban railway's rides stay rows** for now. Their card, with a
  late train's badge as when it actually leaves (the rider's rule of 10
  November), comes in a pull request of its own, with its page, as it
  changes how [44](0044-suburban-railway-credited-on-about.md) shows a late
  train.

## What follows

- The way shown in full is longer: a metro ride's card with its diagram is
  taller than its row, so the other ways and the quicker way's offer can sit
  below the fold on a phone.
- A way with a bus and a metro ride now shows where to stand on the train,
  which 31 left for later.
- The two pages draw a ride with one builder: a change to the card shows on
  both.
- Nothing more is asked of OASA or STASY, and nothing more is loaded but
  the subway planner's words: the card is drawn from rail.json, which the
  page has.
- Until the suburban railway's card comes, a way can have both: a metro
  card and a train's row.

## Look again when

- Riders find the way too long to read on a phone, or miss the other ways
  under it.
- The page follows the rider's own ride (roadmap Plan 7): the card of the
  ride they're on.
- The Buses page's stop rows come to the trip page (the Design Guide's
  T15).
- As 39 says: enough rides are measured to rank buses on a bad day; riders
  find a bus offered first through the centre when the metro is quicker;
  the trip page's searches on /admin/usage come close to what
  [45](0045-load-on-oasa-my-location-follows.md) allows; riders miss
  starting from a bus stop, or each line's next buses; walks can be worked
  out along real streets; the page follows the rider's own ride.
