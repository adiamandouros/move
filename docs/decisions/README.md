# Why Wayhop is built the way it is

One page for each decision the rest of Wayhop rests on: the situation it
answered, what was decided, what follows from it, and when to look at it
again. [ARCHITECTURE.md](../../ARCHITECTURE.md) says how the code works;
these pages say why.

A decision that changes gets a new page, and the old one says what replaced
it, so the reasons stay readable. A pull request that changes one of these
decisions, or makes one of the same weight, comes with its page.
`test/decisions.test.js` keeps every page in the same shape and listed here.

| # | Decision | Status |
|---|---|---|
| 1 | [No build step and no front-end framework](0001-no-build-step.md) | In force |
| 2 | [Pages rendered on the server; HTML only through views and `html```](0002-server-rendered-pages.md) | In force |
| 3 | [Every page in each language, rendered on the server](0003-languages.md) | In force |
| 4 | [One process and no database](0004-one-process-no-database.md) | In force |
| 5 | [Metro trips worked out in the browser](0005-trips-in-the-browser.md) | In force |
| 6 | [Offline: what is kept, and updates that never reload a page](0006-offline.md) | Replaced by 24 |
| 7 | [Our load on OASA and STASY: our own numbers, agreed before they change](0007-load-on-oasa.md) | Replaced by 21 |
| 8 | [Reaching OASA and STASY from a server abroad](0008-routes-and-relays.md) | Replaced by 27 |
| 9 | [Bus lines and stops from OASA's live service](0009-bus-network-from-live-api.md) | In force |
| 10 | [The metro timetable: the open data, held to STASY's](0010-metro-timetable.md) | In force |
| 11 | [Real data first; timetable times marked](0011-real-data-first.md) | In force |
| 12 | [Shared hosting, and what it rules out](0012-shared-hosting.md) | In force |
| 13 | [Accessibility is a requirement](0013-accessibility.md) | In force |
| 14 | [Tests with every change, and no flaky tests](0014-tests.md) | Replaced by 20 |
| 15 | [A Content-Security-Policy by hashes](0015-content-security-policy.md) | In force |
| 16 | [The station editor is never blocked](0016-station-editor.md) | In force |
| 17 | [Privacy: kept on the device, nothing about people on the server](0017-privacy.md) | Replaced by 19 |
| 18 | [The information is given as it is, and says so](0018-information-as-it-is.md) | In force |
| 19 | [Privacy: kept on the device; on the server, counts only](0019-privacy-counts-only.md) | In force |
| 20 | [Tests with every change, no flaky tests, and when each kind runs](0020-tests-and-when-they-run.md) | In force |
| 21 | [Our load on OASA and STASY, with the bus trip finder](0021-load-on-oasa-with-trips.md) | Replaced by 26 |
| 22 | [Address search from OpenStreetMap, built on GitHub](0022-address-search.md) | In force |
| 23 | [The trip page: door to door, beside Subway and Buses](0023-trip-page.md) | Replaced by 29 |
| 24 | [Offline, and opening at once with no signal](0024-opening-without-signal.md) | In force |
| 25 | [Trams in the subway planner](0025-trams-in-the-planner.md) | Replaced by 28 |
| 26 | [Our load on OASA and STASY, with the bus-pass collector](0026-bus-pass-collector.md) | Replaced by 34 |
| 27 | [Reaching OASA and STASY: direct first, now that OASA answers from abroad](0027-oasa-direct-first.md) | In force |
| 28 | [Trams in the subway planner, and the trip search behind it](0028-trip-search.md) | In force |
| 29 | [The trip page: door to door by metro and tram, beside Subway and Buses](0029-trip-page-tram.md) | Replaced by 31 |
| 30 | [The buses' timetable: OASA's last feed, on today's routes, with the rides we measure](0030-bus-timetable.md) | In force |
| 31 | [The trip page: by metro, tram and bus, the buses behind a switch for now](0031-trip-page-buses.md) | Replaced by 32 |
| 32 | [The trip page: by metro, tram and bus, searched in the background, the buses behind a switch for now](0032-trip-searches-in-the-background.md) | Replaced by 33 |
| 33 | [The trip page: the next half hour's answer in place of the answer for leaving now, the buses behind a switch for now](0033-trip-half-hour-answer.md) | Replaced by 35 |
| 34 | [Our load on OASA and STASY, with the Trip page's live times](0034-load-on-oasa-with-live-trips.md) | In force |
| 35 | [The trip page: OASA's live times on the way shown in full, the buses behind a switch for now](0035-trip-live-times.md) | Replaced by 36 |
| 36 | [The trip page: the quicker way on a decision, offered from OASA's live times, the buses behind a switch for now](0036-trip-quicker-way.md) | Replaced by 37 |
| 37 | [The trip page: one walking estimate, the straight line × 1.4, the buses behind a switch for now](0037-trip-one-walk.md) | In force |
