# OASA's bus timetable

`bus-timetable.json` is OASA's open-data bus timetable, its last feed:
published on 6 August 2026 for 3 to 24 August 2026, on
<https://catalog.growthfund.gr/>, under
[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). © OASA.

It's converted, not as published: each route's stop lists and the times of
its trips, by weekday, made by `scripts/bus-feed.js`
(`weekFromFeed` in `server/data/bus-timetable.js`). Each night the data
build changes it again for the trip search: it puts it on the routes of
OASA's live network and takes the ride times Wayhop has measured, for
`/data/buses.json` (decision 30, `docs/decisions/0030-bus-timetable.md`).

It's kept here because the feed stopped in August 2026 and the data build
can't read it as it's published now. Only a new feed from OASA should change
it: download it into `data/raw/bus/`, unpack its archives, and run
`node scripts/bus-feed.js`.
