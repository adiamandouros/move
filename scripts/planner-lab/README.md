# The planner lab

A trial of how version 1's planner could find a trip across every mode, from
any point to any point. **The app doesn't use any of this yet**: nothing here is
loaded by a page or the server. It's here so the trial can be repeated and
trips can be tested as the model gets better, before anything is decided.
Moving it into the app comes with its decision record.

| File | What it is |
|---|---|
| `raptor.js` | The search: earliest arrivals by number of rides, walks at the changes |
| `ways.js` | From what the search finds to the ways a rider could choose from |
| `network.js` | Metro and tram from `rail.json`, buses and trolleys from the file below |
| `build-buses.js` | One day of the bus feed in `data/raw/bus`, small enough to search |
| `trip.js` | Tries one trip from the command line |
| `rush-test.js` | One test of OASA's predictions in the rush hour |

## Trying a trip

```
node scripts/planner-lab/build-buses.js data/local/planner-lab/buses.json
node scripts/planner-lab/trip.js "Πατησίων 100" "Σύνταγμα" 08:30
```

It prints the ways for that departure, on a Wednesday, and which one is the
fastest over the next 90 minutes of departures. Addresses stay on your
computer, and shouldn't go in the repository: it's public, so the trips in the
tests go to public stops.

## Trips as tests

`test/planner-lab.test.js` keeps trips riders really make, with what they know
from making them. What the model gets right must stay right. What it doesn't
yet is a `todo` that says what it needs, so it's on record as a target and
doesn't fail the checks. When a change gets one right, take its `todo` off.

## What's a stand-in

- **Bus times.** The open-data feed stopped in August 2026, so its timetable is
  a summer one. It spreads a trip's time evenly along its route (the first half
  of the distance takes 49 to 54% of the time): it gives Syntagma to Syggrou 2.6
  minutes where riders see 10 to 30. No general rule makes up for that: doubling
  all buses, or slowing a circle around the centre, each gets real trips wrong.
  It takes real times by stretch of road and hour.
- **Walks.** The straight line times 1.4, as 200 walks came out at 1.38 against a
  street router. Typical errors are under a minute in the city, but some are
  much longer, and walks don't count stairs, ramps or the way to a platform.
- **Weights.** Every minute counts the same, so far. Riders don't see it that
  way: a bus in traffic is worth less than a train, and a walk least of all.
- **The ticket and the airport.** Neither is considered: a way can run past 90
  minutes, or use an airport bus, which the ordinary ticket doesn't cover.
- **Lines.** The search leaves out what it finds no better, so it can miss a
  real choice: that's the `todo` about the 750. `bus-lines.json` is no help, as
  it keeps 415 of OASA's 706 routes; `data/raw/oasa/network.json` has them all.

## The rush-hour test

`rush-test.js` asks for 12 stops once a minute through the public API and
appends each answer to a file, to compare what OASA predicted with when buses
really passed. Those numbers were agreed for one morning. Another run, or
other numbers, are agreed first (decision 21).
