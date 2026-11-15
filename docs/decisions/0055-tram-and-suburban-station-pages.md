# 55. Station pages for the tram and the suburban railway: one page per network

Decided 2026-11-15 · In force

## Situation

Only the 66 metro stations had pages (`/subway/stations/<id>`): which
carriage to ride for the exit, connections, lifts, step-free access per
platform, first and last trains. The tram's 60 stops (`rail.json`'s
`tram`) and the suburban railway's 46 stations (`trains.json`) had none, so
the planners named them without a link, and someone looking up a stop's
last tram had nowhere to go.

The data for them is thinner than the metro's: no car positions, no exits,
no lift list from STASY, nothing recorded about steps. The tram's timetable
is the metro's feed, which ended on 31 October. `trains.json` holds the
railway's trains by date, yesterday to about four days ahead, with no
typical week.

Six tram stops and nine suburban stations share an id with a metro
station. Some are the same place (Syntagma, Neos Kosmos, Piraeus); others
aren't: the tram's Agia Paraskevi, Kallithea, Moschato and Elliniko are
kilometres from the metro stations of those names, and the railway's
Tavros and Irakleio a kilometre or more.

## Decision

Agreed with the rider on 15 November 2026.

- **One page per network.** Syntagma the tram stop has a page of its own,
  apart from Syntagma the metro station. Pages are joined only by the
  walks the planner knows (`tram.json`'s and `suburban.json`'s), listed
  under "Changes" on both ends, with their minutes and notes (Piraeus,
  SKA's footbridge). A name shared without a walk joins nothing.
- **Each network has its own paths**, by the data's own ids:
  `/tram/stops`, `/tram/stops/<id>`, `/suburban/stations`,
  `/suburban/stations/<id>`, and the same under `/el`. "Plan a trip" links
  and the star use the subway planner's id (`syntagma-tram`,
  `piraeus-suburban`), so a stop starred on its page comes first in the
  planner's lists, as a metro station does.
- **All 46 suburban stations get a page**, Chalkida and Kiato too, as the
  planner has them; one outside OASA's ticket says so, as the planner does.
- **The railway's first and last trains are shown by date**, a row for each
  day `trains.json` holds from today ("Today, Sun 15/11", "Mon 16/11"), with
  "No trains" for a date without any. They aren't folded into a week:
  five or six days can't say what every Monday is, and a holiday would
  pass for its weekday ([18](0018-information-as-it-is.md)).
- **The tram's are by weekday**, as the metro's, from its timetable, with
  the metro's notice that the feed has ended.
- **Nothing is said about step-free access** but "not known yet", for each
  direction: nothing is recorded, and a surface stop is never guessed
  ([13](0013-accessibility.md)). No lift status, no lift caution, no
  "getting off here" diagram.
- **A card per direction that leaves from the stop**, as the metro's: the
  line and where it ends, the stops either side, linked, and the first and
  last trains. A direction that ends there has no card: with no exits to
  show, it would only name the stop before, which the other direction's
  card names.

## What follows

- The metro's station pages list the walks to the tram and the railway
  too, so they follow `trains.json` as well as `rail.json`.
- The subway planner and the Trip page link every station they name to its
  page (`stationPath` in `public/js/core/metro.js`), tram and railway
  included.
- The suburban pages can't be drawn before the first `trains.json` (503,
  as the metro's before `rail.json`); they're drawn again each day.
- The railway's index lists only the metro to change to: its lines share
  their track, so A4 beside A1 at Piraeus isn't a change.
- Not done here: step-free data and lifts for either network (field
  trips first); the Info page's maps and lists still open the planner, not
  the pages; the railway's stations as places in the Trip page's From and
  To.

## Look again when

- Field trips record the tram's or the railway's step-free access or
  lifts: the cards say how, as the metro's do, with the lift caution.
- `trains.json` holds a typical week (OSE's data, or enough days kept): a
  week's table may then read better than dates.
- Riders look for one page per place (Syntagma with its metro and tram
  together): the walks already say which ids are the same place.
