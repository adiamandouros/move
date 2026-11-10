# 43. What an answer says around it: messages by what they mean, and nothing under it

Decided 2026-11-10 · In force

## Situation

The trip page and the subway planner each grew a grey paragraph under the
answer, a sentence for each thing the answer used: walking times estimated
from the distance, train times from the timetable, bus times from OASA's
timetable of August 2026 or its live times, the suburban railway's times
from railway.gov.gr ([42](0042-suburban-railway-live-times.md)), a train's
lateness as Wayhop's estimate (42), and what the next half hour's range
covers ([33](0033-trip-half-hour-answer.md)). The same paragraph said when
the suburban railway was left out for the day.

The messages above the answer had been chosen one at a time: the bus times
not loading was information, how late the trains run being unavailable a
warning, and the train times not loading a bare line of text.

On 10 November 2026 the rider went through the trip page against the
Design Guide and decided its version 2; these are its T9 and T10.

## Decision

- **A message's type is what it means for the answer** (DESIGN.md,
  "Notice"): an error when something Wayhop uses isn't working, so the
  answer is missing it; a warning when the answer may be off; information
  on how to read it. An error, a warning and all clear show their own
  status icon; information shows what it's about (night, walk, bus).
- **So these are errors now**: the bus times not loaded (the trip is by
  metro and tram only), the train times not loaded (on the trip page and
  in the subway planner), how late the suburban trains run being
  unavailable, and the suburban railway left out for the day, above the
  answer instead of under it. "Wayhop has been updated" stays information,
  about the buses.
- **Nothing under an answer says where its times come from**, on either
  page: the About page credits every source
  ([18](0018-information-as-it-is.md)). The trip page's paragraph goes
  whole, the range's sentence too. The subway planner keeps its one line
  that departure times are approximate, without the railway's sentence.
- **A timetable's time says so on the time itself**: "~" before it, which
  a screen reader hears as "about" (`aboutTime` in
  [times.js](../../public/js/core/times.js)), and "Not on live times yet"
  on a bus OASA isn't predicting. That is [11](0011-real-data-first.md)'s
  small warning, in words, now that no sentence under the answer repeats
  it.

## What follows

- Where a time comes from is on the About page only. That the buses'
  timetable is August's, and that a range leaves out the quickest and the
  slowest tenth, isn't said on the page any more (the rider's call).
- 42 said three times what goes under the answer, so
  [44](0044-suburban-railway-credited-on-about.md) restates it.
- A new source is credited on the About page, as 18 says, not under the
  answer. OpenStreetMap's credit for the addresses stays at the foot of the
  trip page, as its licence asks ([22](0022-address-search.md)).
- A new message takes its type from DESIGN.md's table; the tests check each
  message's type and icon (`notices()` in
  [markup.js](../../test/support/markup.js)).
- The lift status's own error, when it's over 30 minutes old or missing,
  comes with the step-free notice on the trip page (the Design Guide's
  T12), in a pull request of its own.

## Look again when

- Riders misread a range or a "~" time, or ask where a time comes from.
- A source asks to be credited beside what it gives.
- A message fits none of the types.
