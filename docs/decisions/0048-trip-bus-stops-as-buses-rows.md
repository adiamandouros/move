# 48. The trip page: a last bus's stops as the Buses page's stop rows

Decided 2026-11-11 · Replaced by [51](0051-trip-walks-through-exits.md)

## Situation

When the last bus of a way can be any of several
([33](0033-trip-half-hour-answer.md)), the trip page's way shown in full
lists the stops it can be caught at, the nearest 3 and "N more stops". With
OASA's live times ([35](0035-trip-live-times.md)) the stops with a bus the
rider can catch come first, by when it comes. Until now each stop was a step
like a walk: the walk's minutes on the left, the stop's name, each of the
rider's lines with its minutes, "Not on live times yet" when OASA had none
of them, and the walking figure at the right. On the Buses page the same
stop is a row of its own: a band with its name, code and distance, the next
bus's plate, where it goes and its minutes, the walking figure, and opened,
every bus coming. The two pages drew a bus stop two ways.

The Design Guide's version 2 (10 November 2026, T15) said the trip page's
stops become the Buses page's stop rows, after steps 1 to 7 (#227 to #234).
In the plan session of 11 November the rider chose, with sketches:

- the Buses page's row as it is, with the next bus only beside it, over
  each of the rider's lines with its minutes, as before, and over keeping
  the walk's minutes in the trip page's left column;
- that it opens, to the next buses of the rider's lines only, over every
  bus at the stop (as on the Buses page), and over a row that doesn't open;
- no star to save the stop.

OASA's answer for a stop already has every bus coming there, with where it
goes. The page kept only the first bus of each of the rider's lines.

## Decision

Everything [46](0046-trip-rail-rides-as-cards.md) decided stands, and:

- **Each stop a way's last bus can be caught at is the Buses page's stop
  row**, drawn by the same code (`stopRow` in
  [render.js](../../tools/buses/client/render.js)), across the step with
  nothing on the left. Its band has the stop's name, its code, and the walk
  to it (`~4'`, "Walk about 4 minutes" to a screen reader) where the Buses
  page shows how far it is.
- **Beside it, the next bus of the rider's lines** they can still catch
  there: its large plate, where it goes, and its minutes badge, counted from
  now, as on the Buses page. The walking figure at the far right.
- **Not on OASA's live times**: the rider's lines' plates beside it, and
  when OASA answered but has none of them coming, "Not on live times yet"
  after them, in the quiet italic the Buses page uses when there are none.
- **Opened**, as on the Buses page and from the keyboard too: every bus of
  the rider's lines they can still catch there, soonest first, each with
  its plate, where it goes and its minutes, then the rider's lines. Lines
  that don't take the rider there stay out. Its list is called "Your buses
  at …" for a screen reader, not "All arrivals". The lines aren't links, so
  nothing takes the rider away from the trip.
- **No star** to save the stop: that's the Buses page's.
- **A stop the rider opened stays open** while the page refreshes, as long
  as the trip goes to the same place, as the cards' stations do (46).
- A row with buses from OASA's live times is marked `trip-live`, as a
  ride's badges are.
- The order of the stops, the nearest 3 shown and "N more stops" are as
  before. "Any of these buses, whichever comes first" and "N more stops"
  line up with the rows' left edge.

## What follows

- A bus stop looks and opens the same on both pages; a change to the Buses
  page's row shows on the trip page too.
- Each stop shows one bus rather than each of the rider's lines with its
  minutes: the second line's time is behind the opened row.
- Opened, a stop shows each line's next buses, which 39 listed as something
  the bus trip finder did that the trip page didn't, for the stops of a last
  bus.
- Nothing more is asked of OASA: the same stops, as often
  ([45](0045-load-on-oasa-my-location-follows.md)), with more kept from
  each answer. An opened stop isn't asked more often, as it is on the Buses
  page.
- The trip page gets the Buses page's words with its own (tool.json
  `borrows`).

## Look again when

- Riders miss seeing each line's minutes at a stop without opening it.
- Riders want to save a stop from the trip page, or to open a line's stops.
- As 46 says: riders find the way too long to read on a phone, or miss the
  other ways under it; the page follows the rider's own ride (roadmap
  Plan 7); as 39 says: enough rides are measured to rank buses on a bad
  day; riders find a bus offered first through the centre when the metro is
  quicker; the trip page's searches on /admin/usage come close to what 45
  allows; riders miss starting from a bus stop; walks can be worked out
  along real streets.
