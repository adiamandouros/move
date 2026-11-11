# 47. The trip page: suburban rides as the subway planner's cards, a late train by when it leaves

Decided 2026-11-11 · In force

## Situation

Since [44](0044-suburban-railway-credited-on-about.md) the trip page's way
shown in full has had each suburban ride as a row: when its train leaves by
the timetable on the left, the line's pill and where the train ends, how
many stops, and the Hellenic Train ticket note. Once the way is timed with
how late the trains run, a line under it says "Running about 5' late",
"At least 3' late" or "On time"; a train the timetable would miss, caught
because it runs late, has its expected time with "~" and "timetable 17:08"
beside the lateness.

Since [46](0046-trip-rail-rides-as-cards.md) the metro's and the tram's
rides are the subway planner's card. 46 left the suburban rides as rows:
their card would come with its own page, as it changes how 44 shows a late
train.

On 10 November 2026 the rider decided the Design Guide's version 2
(DESIGN.md, "Time badge" and "The Trip page"). Their rule there: a late
suburban train shows only when it actually leaves, as its badge, with no
timetable time and no line saying how late it runs. The next train's badge
has its own lateness when that train is running.

The subway planner already draws a suburban ride as a card (44), with no
train diagram, its stations not links, and the ticket note. Its direction is
where its train ends. The card is drawn from `rail.json` with `trains.json`
joined in the browser (`withSuburban`). The trip page plans its own trips
on the metro and the tram (`plan.js`). Its trains come from the city's
search in the worker, which loads `trains.json`; the page itself didn't.
`trains.json` has each trip's train number (42), and `/api/trains` gives
each running train's lateness by that number. `withSuburban` didn't keep
the numbers.

## Decision

Everything 44 decided stands, except how the trip page shows a suburban
ride and a late train. 46 holds for the suburban ride as for the metro and
the tram:

- **Each suburban ride of the way shown in full is the subway planner's
  card** (`legCard`), in the ride's place with nothing on the left, as 46
  has the metro's and the tram's. It has where to board, the A1 to A4 pill
  → where its train ends, the badges and the last trains in words. Then the
  ticket note on a ride to or from a station OASA's ticket doesn't cover,
  where to change or get off, and the ride's minutes and its stations behind
  their button. It has no train diagram and its stations aren't links (44).
  A walk with a note before it (Piraeus, SKA) stays a row.
- **Its badges start with the train the way is timed on**, then the next
  train of its direction: the next that ends at the same station, as in the
  subway planner. A short train to Tavros that comes between two to Piraeus
  isn't among the badges (44).
- **A late train's badge is when it actually leaves**: its timetable time
  plus how late it runs, counted from now. The lateness can be measured at
  a station or "at least" between stations; both count the same. The next
  train's badge has its own lateness when it's running. There's no timetable
  time, no "Running about", "At least" or "On time" line, and no "~" (the
  rider's rule, 10 November). A train with no lateness known keeps its
  timetable time, as before: one without GPS, or not yet left its first
  station.
- **A train caught late is the card's first badge**, when it's expected:
  one the timetable would miss, measured late at a station with 2 minutes
  to spare (44).
- **The lateness is on the badges once the way is timed with it.** That's
  the way shown in full of the next half hour's answer, as with its buses'
  live times ([35](0035-trip-live-times.md)). The answer for leaving now,
  and a way not timed yet, keep the timetable's badges, so a card's badges
  always agree with the trip's times. `/api/trains` is asked as 44 says,
  no more often.
- **The trip page loads `trains.json` itself**, as the subway page does,
  from the browser's copy ([24](0024-opening-without-signal.md)). Nothing
  more is asked of railway.gov.gr. It doesn't load it while the subway
  page's switch hides the railway. It joins the day's trains to what it
  draws on (`withSuburban`, which now keeps each train's number), for the
  cards only. The page still plans its own trips on the metro and the tram,
  and its trains still come from the city's search.
- **The answer doesn't wait for it.** A ride stays a row, its time when its
  train leaves, until the file is in, or when the joined day doesn't have
  its train (just after midnight). The row has no line under it either.

## What follows

- The rider is told when a late train leaves, not when it was due. A
  train that makes up time after the station where it was measured leaves
  sooner than its badge says, by a minute or two (44: its lateness is
  measured at the station before). One known only to be "at least" so late
  leaves no sooner than its badge says.
- The trip page fetches `trains.json` from the page as well as from its
  worker. Both come from the browser's copy, and each checks it is current
  with a small request to Wayhop.
- The suburban card adds nothing to the legend under the way: it has no
  train diagram.
- The way shown in full is longer still: a train's card is taller than its
  row.
- The subway planner doesn't change: its suburban badges stay the
  timetable's (44), as do the trip page's other ways.
- The words "Running about", "At least", "On time" and "timetable" leave
  the trip page.

## Look again when

- Riders miss a train because its badge said it was later, or find the
  badges jump about.
- railway.gov.gr starts filling in a running train's delay, or OSE answers
  the request (44).
- The page follows the rider's own ride (roadmap Plan 7): the card of the
  train they're on.
- As 44 and 46 say.
