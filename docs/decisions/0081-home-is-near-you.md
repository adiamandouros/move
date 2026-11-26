# 81. Home is "Near you"

Decided 2026-11-26 · In force

## Situation

Home was a heading, four lines about Wayhop, a box saying whether anything
was disrupted, five tiles and the latest announcements. Four of the tiles
repeated the bottom bar, the fifth was the only way to the metro stations'
pages, and nothing on the page was live. Someone opening Wayhop at a stop
had to tap again before anything useful showed. This was step 6 of
direction A in the design review of 26 November 2026.

## Decision

Agreed with the rider on 26 November 2026, every option as recommended.

- **Home shows what's near, now.** From the top: Wayhop's name (on phones;
  the sidebar has it on wider screens) with "No disruptions" at its right,
  "Where to?" (a link to the Trip page), the starred stations, then "Near
  you": the next two trains each line and direction at the metro station
  or tram stop nearest the rider, from the timetable, and the next buses
  of the bus stop nearest them, from OASA, at most four of its lines and
  where they go, drawn as an opened stop on the Buses page (decision 79),
  with the way to all the stops near you.
- **A disruption is one closed line under the top**, the first one's title
  cut to the line and "+N more"; opened, each of them, and the way to every
  announcement on Info. "No disruptions" only once every source answered,
  as before (decision 71). Info keeps its open banner.
- **A starred station is a trip to it**: `/trip?to=<station>` opens the
  Trip page from My location to that station, by the key its star has
  (metro, tram or suburban). The link's `to` is taken out of the address
  once read, so the trip is kept like any other (decision 58). Addresses
  in such a link are still Links · 1's question.
- **The intro, the tiles and the announcements go.** The search engines
  keep Home's description in its meta tags; About says what Wayhop is;
  the announcements are on Info, a link away from the disruption line.
  The metro stations go into the menu and the sidebar's lower links.
- **Nothing asks for the location by itself.** A position from another
  page in the past 10 minutes shows at once, and the location is followed
  when the browser already allows it; otherwise "Use my location".
- **What it asks of OASA** (the numbers proposed first and agreed): the
  nearest stop only, on the Buses page's tiers (every 32 s when its next
  bus is within 10 minutes, 62 s within 20, 122 s otherwise), only while
  Home is in sight and touched in the past 10 minutes, picked again after
  40 m. One open Home asks at most about two requests a minute, and the
  server's 30-second cache shares each stop with everyone. Its requests say
  `&for=home`, counted apart on /admin/usage.

## What follows

- Home loads `rail.json` (cached for offline use with the Subway and Trip
  pages) and, once there's a position, `bus-stops.json` (about 140 KB
  compressed, the Buses page's). It sends the Subway and Buses pages'
  strings, as it draws their trains and buses.
- A starred suburban station waits for `trains.json` before it shows.
- Home is short enough to fit a phone's screen without scrolling.

## Look again when

- /admin/usage shows Home's stops asked of OASA growing beyond the Buses
  page's: the tiers or the idle pause may need to be stricter for Home.
- Links · 1 decides how an address goes in a link: `/trip?to=` should take
  it the same way.
