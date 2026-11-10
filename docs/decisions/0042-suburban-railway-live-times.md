# 42. The suburban railway on the trip page and in the subway planner, from railway.gov.gr's timetable, with how late its trains run

Decided 2026-11-09 · Replaced by [44](0044-suburban-railway-credited-on-about.md)

## Situation

The trip page plans by metro, tram, bus and on foot ([39](0039-trip-buses-for-everyone.md)),
and since [40](0040-suburban-railway-timetable.md) by the suburban railway
(Proastiakos) too, the only rail to much of west and north Attica, Megara,
Kiato and Chalkida, and a second way to the airport, and since
[41](0041-suburban-railway.md) the subway planner has it the same way as the
tram. By the timetable alone: a late train isn't known, and so the change
after it (the walk to the M2 at Larissa Station) is often planned wrong.

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

Its live stream (`/api/train-stream`) is server-sent events: every train
with a GPS unit, its next station and where it is, each second, 10 seconds
late and marked "watermarked", so OSE can likely tell where copies go;
about 40 to 50 KB a second, the trains' last 20 points (about 200 KB) first
on connecting, then the positions within a second or two (about 40 KB).
Looked at on Sunday 8 November at midday and in the evening rush of Monday
9 November: every Athens suburban train running had GPS tied to its
timetabled trip (9 of 9, then 10 of 10, with 2 more still running past
their timetabled arrival, at least 10 and 18 minutes late), and every one's
delay read 0. A train's position by its progress along the track, which the
stream also sends, is too rough to time it (±12 minutes against the
timetable's).

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

The subway planner works on `rail.json`'s shape: each line's directions go to
one end, each train a profile of its stops. `trains.json`'s routes are each a
list of stops of their own, and a line's trains end at several stations
(Tavros on A1 and A4, Afidnes and Oinoi on A3). Its older route finder
(`findRoutes`) lists every route with the fewest changes or one more: where
the railway's lines share track, every station they share is a change, and
it would list up to 2,177 routes for one trip, against at most 40 with the
metro and the tram.

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
- **In the subway planner, the same way as the tram.** `withSuburban` in
  [network.js](../../tools/subway/client/network.js) joins the day's
  `trains.json` to the metro and the tram in `rail.json`'s shape, in the
  browser, so one planner serves all three and a problem with the railway
  can't touch the metro. Every station a train calls at is a row of its own
  in the same list; the 9 with a metro station's id (the 7 changes, Tavros
  and Irakleio) say "(suburban)", "(Προαστιακός)" in Greek. A line's trains
  go in a direction for each station they end at, so a leg says where its
  train ends, as signed, without "(suburban)": its stops are those of every
  train ending there, in order, and each train's own stops a profile of them.
  Before anything is typed, a field still offers the metro's and the tram's
  stations to start from: the railway's lines share track, so nearly every
  station of its is on two lines. Its stations come up when typed, starred or
  picked lately.
- **Its routes**: the route finder doesn't change from one suburban train to
  another at the same station, only on foot (SKA's footbridge); the trip
  search (raptor.js) still finds those changes, as the quickest way with
  each number of rides. The same ride on trains that end at different
  stations is one option, on the train that gets there first. A train is
  marked the last only when none of its line leaves for the same stretch
  after it, whatever its end. A route with more changes stays only if it
  gets there 5 minutes sooner, as the metro's: two trains on the same track
  are no choice worth offering, unlike a tram beside the metro.
- **A suburban leg has no train diagram**, nor any word about where to stand,
  as its stations aren't recorded; its stations aren't links, having no
  pages. A walk with a note says it, a leg to or from a station outside OASA's
  ticket says it needs a Hellenic Train ticket, and a trip by suburban train
  says under it that its times are railway.gov.gr's.
- **A switch shows or hides the railway**, beside the tram's: its stations and
  routes together, kept on the device (`suburban-hidden`). The trip page
  follows it, as it does the tram's ([29](0029-trip-page-tram.md)): hidden,
  its worker doesn't load `trains.json`, and the page doesn't say the railway
  is missing. An address naming a suburban station shows it for that visit.
- **The subway page doesn't wait for `trains.json`**: it plans on the metro
  and the tram at once, and the railway joins when the file comes (with no
  signal a request can hang rather than fail), a list being typed in staying
  open with the railway's stations in it. It's kept for offline use with
  `rail.json`. Without it, or without trains for today, there's no switch and
  the planner is the metro's and the tram's.
- **How late the trains run, worked out by Wayhop** ([server/railway/](../../server/railway/)),
  as no one publishes it while they run. A look at the live stream reads its
  first positions and hangs up, about 250 KB, skipping the trains' history
  as it comes. From one look to the next, against each train's timetable on
  today's board (yesterday's for a train still running after midnight): a
  train whose next station has changed left the station before it between
  the two looks, so its lateness there is measured, to within half a minute;
  one still on its way to its next station after its timetabled arrival
  there is at least that late. The larger counts, never below 0. A train
  first seen (after a restart too) is only "at least" until its next station
  changes; a position back at a station it has passed counts as the furthest
  seen.
- **The looks, agreed on 8 November** (bandwidth is no limit; one a minute
  because OSE sees each one): only while someone has asked for the trains in
  the past 3 minutes, one a minute, one look for every visitor; the first
  request with no answer waits for it, at most its 10 seconds; after 3
  failures in a row, a rest of 10 minutes, and the trip page says the
  trains' lateness is unavailable. Nothing is served from over 3 minutes ago.
  `/api/trains` gives each running train's lateness by its number, which
  `trains.json` now has for every trip. Counted on `/admin/usage` (the
  visitors' requests, the looks, those that failed and the bytes), and
  `/api/health` warns while the looks rest and someone wants them.
- **On the trip page**, the way shown in full asks for the trains while it has
  one, on the bus page's tiers by when its train leaves, nothing while out of
  sight, paused after 10 minutes untouched, as for its buses. A late train's
  ride keeps the timetable's time, so a train that makes up time isn't
  missed, and says "Running about 5′ late", or "At least 3′ late" between
  stations, or "On time" when measured so; the rest of the way is timed from
  its later arrival (the rider's call, 9 November). A train the timetable
  would miss is planned on when its lateness was measured at a station and
  leaves 2 minutes to spare (the rider's call): its expected time with "~",
  and the timetable's beside how late it is. Under the answer, that a
  train's lateness is Wayhop's estimate. Its times stay without "~"
  otherwise, live or not.
- **Credited** on the About page, with OpenStreetMap for the stations'
  places, and under every answer with a train.

## What follows

- The walks are guesses until timed on the spot (SKA's footbridge, Piraeus,
  Athens to Larissa Station, Neratziotissa, Doukissis Plakentias), and
  SKA's A3 station is where OpenStreetMap's area for it centres, to be
  checked there.
- Trips to and from the railway's stations get it, by its timetable; on the
  trip page, Megara, Kiato or Chalkida, outside the address index, only from
  "My location" or a place near a station. The subway planner has them as
  stations.
- Planning a trip in the subway planner takes longer with the railway:
  measured on a desktop over every pair of stations on Wednesday 11 November,
  a median 1.7 ms against 0.8, and at most 37 ms against 8.5. A phone is a
  few times slower, so the slowest trips (from a far tram stop to a station
  in the middle of a suburban line) take a tenth of a second or two. The
  route finder lists at most 300 routes for a trip with a suburban station,
  where the metro and the tram alone stay within 40; a test keeps that true.
  Metro and tram trips may now find a train quicker: from Syntagma to the
  Airport at 12:00 on the tests' Wednesday, M3 to Doukissis Plakentias and
  A1 get there at 12:51, against 13:10 by the next M3 that goes all the way.
- A leg's times are its direction's: a short train to Tavros that would come
  between two to Piraeus isn't among their chips. The search finds the
  earliest arrival, not the latest departure: from Ano Liosia to Chalkida,
  the first train is offered even when a later one makes the same A3.
- Only the trip page's way shown in full is timed with how late its trains
  run; the subway planner, and the trip page's other ways, keep the
  timetable's times.
- A train without GPS, or not yet left its first station before its time,
  is on the timetable's times; one that has made up time since its last
  station is still said as late as it was there, until its next.
- A cancelled train is left out of tomorrow's board, but not of today's, and
  the stream's sign for one isn't known yet: a train cancelled during the day
  is still offered.
- OSE sees each look, as Wayhop, and the stream's marks can likely tell where
  its positions went: at most one a minute, only while someone asks.
- The site can change or stop answering at any time. The boards held keep
  the railway on the page for 4 nights; then it leaves, and the health page
  has warned since the first failed night.
- OSE sees the requests: one Athens day's worth of boards a night, and the
  looks while someone has a train on the trip page, as Wayhop. The subway
  planner asks it for nothing: `trains.json` is Wayhop's.

## Look again when

- OSE answers the request: yes, no, or open data on data.gov.gr, which
  would replace the board.
- railway.gov.gr changes its addresses or answers, or asks Wayhop to stop.
- The trip page is reworked, and the railway's pill with it.
- The stream changes, a running train's delay starts being filled in, or
  trains in a rush are seen without GPS.
- Riders find the lateness wrong on the road, or miss a train caught late.
- The subway planner feels slow on a phone with the railway, or riders miss
  a short train among a leg's times.
