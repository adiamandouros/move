# 71. Strikes from apergia.gr, in their words, in the disruption box

Decided 2026-11-24 · In force

## Situation

Strikes and work stoppages are announced days ahead, in the news and on
apergia.gr, a Greek site that keeps a calendar of planned strikes. OASA
and STASY often post their own notice only the day before or on the day:
on 24 November 2026 a strike for the 25th was in every newspaper, and
neither had said anything. The disruption box on the home and Info pages
only read OASA's and STASY's announcements, so it said "No service
disruption announcements" the day before a strike.

apergia.gr publishes no API, but its pages read a JSON API of their own
(`https://api.apergia.gr/api/v1/events/summary`): the coming events, each
with a category (`strikeTransportation` for transport), a network
(`mmm.metro`, `mmm.isap`, `mmm.bus`…), a title, its day and an id. The
hours a network runs are only in the title and the text, as their
editors write them, often "pending confirmation". Nothing on the site
grants or refuses reuse; the rider is contacting them.

## Decision

Agreed with the rider on 24 November 2026.

- **A third source for the announcements** (`server/info/announcements.js`):
  apergia.gr's `events/summary`, asked by the server only, **at most
  twice a day** (every 12 hours, the rider's number), only when someone
  opens a page, the copy kept on disk; a restart doesn't ask sooner.
  Riders' phones never ask apergia.gr.
- **Only transport strikes on Wayhop's networks**: metro, M1, tram,
  buses, trolleys and the suburban railway; not ships, planes, taxis or
  strikes elsewhere.
- **Their title as written, nothing worked out from it.** No hours or
  lines are read out of the text, and nothing is planned around a
  strike: the planners don't change. Each line links to the strike's
  page on apergia.gr and says "from apergia.gr".
- **Shown in the disruption box** of the home and Info pages, from when
  apergia.gr lists it until it ends, before OASA's and STASY's notices.
  On the English pages it keeps its Greek title with "Only available in
  Greek", as STASY's notices do.
- "No service disruption announcements" is said only when apergia.gr was
  read too, as for the other sources.
- The About page names apergia.gr among Wayhop's sources.

## What follows

- A strike reaches riders as soon as apergia.gr lists it, up to 12 hours
  later at worst. Their updates ("confirmed", new hours) arrive as late;
  opening `/admin/diagnostics` reads every source again by hand.
- The API is theirs and unpublished: it can change or close without
  notice. A failing read keeps the last copy and shows on
  `/admin/diagnostics` ("apergia.gr (strikes)") and in `/api/health`.
- A title can be wrong or out of date; it is shown as theirs
  ([18](0018-information-as-it-is.md)).

## Look again when

- apergia.gr answers the rider, asks us to stop, or publishes an API.
- A strike's notice comes too late at 12 hours, or a strike shows up
  that isn't on Wayhop's networks.
- Wayhop sends notifications to phones: strikes would be a first case.
