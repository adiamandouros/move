# 11. Real data first; timetable times marked

Decided 2026-10-28 · In force

## Situation

Wayhop started because trip planners that show only the timetable are
wrong in Athens: buses and trolleys rarely keep to it. Until October 2026
the rule was real data only. But a trip with a bus leg later on needs a
time for a bus OASA isn't predicting yet, since it only predicts buses
already on the road.

## Decision

- Live data always comes first.
- Where there is none yet, a timetable time may be shown, always with a
  small warning, and never looking like a live prediction.
- Meanwhile live data is asked for again, until it comes.

## What follows

- As far as we know, OASA's schedules give departures from the start of a
  line, not times at each stop, so a timetable time at a stop along the way
  is an estimate. It shows as a clock time with "~", and the warning is in
  words, not colour alone ([13](0013-accessibility.md)).
- Reading OASA's schedules adds to our load on OASA
  ([21](0021-load-on-oasa-with-trips.md)) and needs new relay calls
  ([8](0008-routes-and-relays.md)).
- Nothing reads a bus timetable yet.

## Look again when

- OASA's schedules turn out too far from what really runs to be worth
  showing.
