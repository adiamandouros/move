# 40. The suburban railway on the trip page, from railway.gov.gr's timetable

Decided 2026-11-08 · In force

## Situation

The trip page plans by metro, tram, bus and on foot ([39](0039-trip-buses-for-everyone.md)),
but not by the suburban railway (Proastiakos), which is the only rail to
much of west and north Attica, Megara, Kiato and Chalkida, and a second
way to the airport. Version 1 is to plan with every mode.

No one publishes its timetable as open data: Hellenic Train has no feed,
and its terms forbid reuse without written consent; TrainOSE's old GTFS is
gone; neither data.gov.gr nor nap.gov.gr has rail data. Volunteers for
Transitous turn railway.gov.gr into GTFS, but with no license, and they
can't license OSE's times anyway (looked into 7 November 2026).

railway.gov.gr is OSE's train site (OSE is state-owned; the site is ©
the Ministry of Infrastructure and Transport). Its /schedules page shows
every train's timetable and its /train-tracker every train's position,
from open but undocumented addresses on its own server, with no terms,
license or API. Greek law (4727/2020, and the Digital Governance ministry's
circular of 3 July 2026) has public bodies and state-owned transport
companies make the data they hold open by default.

Its schedule board (`/api/public/schedule-board?date=YYYY-MM-DD`) is every
train of a day, with each stop's times in UTC: about 0.75 to 0.9 MB, sent
uncompressed and never cached, from 2 days back to 30 ahead. Each
train has a corridor (Piraeus–Airport, Kiato, Chalkida), its own stops, and
a delay and actual times, filled in only once its trip is over:
while it runs they read 0 everywhere, OSE's own page included (looked at
in the day on 8 November 2026). On the Athens lines (about 134 to 170
trains a day) trains leave on time and arrive a median 3.5 minutes late,
35% of them 5 minutes or more (7 November). Stations have OSE's ids and
Greek names only, spelled more than one way, and no places.

How the railway works for a rider, from the rider's own trips (8 November
2026), checked the same day against Wednesday's board and OpenStreetMap:
four lines, A1 Piraeus–Athens–Airport, A2 Ano Liosia–Airport, A3
Athens–Oinoi–Chalkida and A4 Piraeus–Athens–Kiato, which the data doesn't
name (its Piraeus–Airport corridor holds A1 and A2); trains end sooner than
their line and skip stations they pass; SKA (the Acharnai Railway Centre) is
two stations, A2's and A3's, joined by a narrow, almost hidden footbridge,
under one id; Piraeus's station is a road away from the metro's, with no
signs; and OASA's ticket covers the suburban only from Magoula to Koropi and
from Piraeus to SKA, Pentelis included.

## Decision

The rider's call on 8 November 2026, and the numbers agreed that day:

- **Two prongs**: OSE is asked to publish the timetable and positions as
  open data, or to confirm Wayhop may use them; while it's asked, Wayhop
  uses railway.gov.gr's schedule board, as public data that's meant to be
  open. Not the volunteers' feed.
- **The boards, once an Athens day** ([railway.js](../../server/data/railway.js)),
  with the first data build of the day: yesterday's, today's and the next 4
  days', one at a time, 10 seconds apart: 6 requests, about 4.5 MB. A
  failed request is tried again after 10, 30 and 60 seconds; one still
  failing stops the fetch until the next day, keeping the boards there are.
  Wayhop says who it is (its User-Agent), as to OASA's portal. Yesterday's
  board gives each train's real lateness, kept 91 days, a few KB a day, for
  a train's usual lateness later.
- **Five days held**: the railway stays on the trip page through 4 nights
  of failures. With no board for today it leaves the page, which says so
  under the answer, and `/api/health` warns, as it does when a fetch fails.
- **The lines and stations are ours**: [suburban.json](../../data/curated/suburban.json)
  has the lines A1 to A4 in the rider's colours, each taking a corridor's
  trains, A2 those of the Piraeus–Airport corridor that stop at Ano Liosia;
  and the 46 stations of the Athens lines, each with OSE's ids, its names in
  both languages, where OpenStreetMap has it, and the metro station it
  shares, for the 8 that do. SKA is two stations under OSE's one id, told
  apart by the train's line. Each change to the metro, and SKA's footbridge,
  has a walk in whole minutes, a first guess as the tram's were (the
  straight line × 1.3 at 80 m a minute, plus 2 to reach the platform) until
  field trips time them, with a note where the way needs one (Piraeus,
  SKA); each station outside OASA's ticket is marked. A train at a station
  that isn't there for its line is left out, with a warning.
- **`trains.json`**, built every night ([build-suburban.js](../../server/data/build-suburban.js)):
  the stations, the walks and the stations outside the ticket, and each held
  date's trains by their line and stops, in seconds from that date's
  midnight in Athens, as `buses.json` has its routes. About 1.2
  KB over the wire a day held. A file of its own, not in `rail.json`, whose
  days move on every night: `rail.json` stays the same night to night, so
  browsers keep it.
- **On the trip page** the city's search ([city.js](../../tools/subway/client/city.js))
  has the day's trains with the buses, last night's still running after
  midnight included; the worker loads `trains.json` beside `buses.json`, and
  a trip without it still has its buses. Its walks are suburban.json's where
  it has them, however far, and the straight line's elsewhere. A way by
  train is one the metro planner can't find, so it comes with the ways by
  bus. Its times are the timetable's, without "~", as the metro's; under the
  answer, that they're railway.gov.gr's and that its trains often arrive a
  few minutes late. Each train has its line's pill (A1 to A4) and goes
  toward where **it** ends, not its line: DESIGN.md's rule for the metro
  changes for the suburban (the rider's call, 8 November). A walk with a
  note says it; a ride to or from a station outside OASA's ticket says it
  needs a Hellenic Train ticket.
- **Credited** on the About page, with OpenStreetMap for the stations'
  places, and under every answer with a train.

## What follows

- The walks are guesses until timed on the spot (SKA's footbridge, Piraeus,
  Athens to Larissa Station, Neratziotissa, Doukissis Plakentias), and
  SKA's A3 station is where OpenStreetMap's area for it centres, to be
  checked there.
- Trips to and from the railway's stations get it, by its timetable;
  Megara, Kiato or Chalkida, outside the address index, only from "My
  location" or a place near a station.
- Its times are the plan's. A late train isn't known until live times come,
  in a pull request of their own, with numbers of their own: railway.gov.gr
  publishes no lateness while a train runs, so Wayhop will work it out
  itself from the trains' positions (its live stream, every train with GPS,
  10 seconds late and marked, so OSE can tell where copies go): one look a
  minute while someone has a train on screen, about 225 KB a look,
  proposed on 8 November.
- A cancelled train is left out of tomorrow's board, but not of today's:
  until live times come, a train cancelled during the day is still offered.
- The site can change or stop answering at any time. The boards held keep
  the railway on the page for 4 nights; then it leaves, and the health page
  has warned since the first failed night.
- OSE sees the requests: one Athens day's worth a night, as Wayhop.

## Look again when

- OSE answers the request: yes, no, or open data on data.gov.gr, which
  would replace the board.
- railway.gov.gr changes its addresses or answers, or asks Wayhop to stop.
- Live times are built (their own record), or the trip page is reworked
  and the railway's pill with it.
