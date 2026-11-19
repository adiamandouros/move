# 65. One rule for answers that come too late

Decided 2026-11-19 · In force

## Situation

The Trip page asks five kinds of question in the background and draws
each answer as it comes: its worker searches the trip for leaving now and
works out its half hour ([32](0032-trip-searches-in-the-background.md),
[33](0033-trip-half-hour-answer.md)), times the way shown in full with
OASA's live times ([35](0035-trip-live-times.md)) and the other ways
([62](0062-other-ways-timed-by-oasa.md)), and the page asks OASA for each
stop. Any answer can come back after its question was overtaken: another
trip picked, the trip searched again, the way shown timed again.

Each kind had grown a guard of its own (`asked.id`, `askedHalf.id`,
`live.seq`, `live.others.seq`, `live.trip` in `tools/trip/client/main.js`),
each moved on in its own places. An outside review of the code on
19 November 2026 named that page's state as its weak spot, and the bugs
agreed: a tapped button's focus stopped every redraw (#250), a kept ride
was searched a second time and an answer drawn under the keyboard (#272),
and, found while planning this, a new trip took the way timed for the trip
before as its own and asked OASA for all its stops (#274: one guard of
five not moved on). Agreed with the rider the same day as the first step
of moving the page's state into a controller tested in Node (roadmap
Trip · state).

## Decision

- **The rule**: every question a page asks in the background carries a
  ticket for its kind, taken as it's asked, and its answer counts only if
  that ticket is still the newest of its kind for the current trip. A
  later question of the kind overtakes it, so does a new trip, and so does
  the kind dropped without a new question.
- **On the Trip page** the kinds are the trip searched, its half hour, the
  way shown timed, the other ways timed, and each stop asked of OASA (a
  kind per stop, as several are asked at once). A trip searched with its
  half hour is one question of two kinds, so searching it again a minute
  later without its half hour leaves the half hour being worked out. A
  new trip overtakes everything; planned again from where the rider moved
  to ([63](0063-other-ways-follow-the-rider.md)), the way's and the other
  ways' timing are dropped, while the stops keep their answers.
- **One small helper** (`tools/trip/client/tickets.js`), tested in Node, in
  place of the five guards. Its tickets are numbers counting up across the
  kinds, so they go to the worker and come back as they did before, and
  one kind's can't pass for another's.
- **It stays beside the Trip page** until a second page asks several kinds
  of question in the background; then it moves to `public/js/core/`. The
  Subway and Buses pages are left as they are, as neither does.

## What follows

- How often OASA is asked doesn't change, nor anything a rider sees.
- The next steps of Trip · state build on it: a controller with no page in
  it, told what happened and answering what to do, the trip and its
  searches first, then the live times, following the ride, and the switch
  and the other ways.
- A guard of its own for a new question in the background is a review
  finding: it takes a ticket instead.

## Look again when

- A second page asks several kinds of question in the background (then:
  the helper to `public/js/core/`).
- An answer has to count although a newer one of its kind was asked (two
  of the same kind at once, both wanted): then that's two kinds, or the
  rule changes here.
