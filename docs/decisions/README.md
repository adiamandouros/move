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
| 6 | [Offline: what is kept, and updates that never reload a page](0006-offline.md) | In force |
| 7 | [Our load on OASA and STASY: our own numbers, agreed before they change](0007-load-on-oasa.md) | In force |
| 8 | [Reaching OASA and STASY from a server abroad](0008-routes-and-relays.md) | In force |
| 9 | [Bus lines and stops from OASA's live service](0009-bus-network-from-live-api.md) | In force |
| 10 | [The metro timetable: the open data, held to STASY's](0010-metro-timetable.md) | In force |
| 11 | [Real data first; timetable times marked](0011-real-data-first.md) | In force |
| 12 | [Shared hosting, and what it rules out](0012-shared-hosting.md) | In force |
| 13 | [Accessibility is a requirement](0013-accessibility.md) | In force |
| 14 | [Tests with every change, and no flaky tests](0014-tests.md) | In force |
| 15 | [A Content-Security-Policy by hashes](0015-content-security-policy.md) | In force |
| 16 | [The station editor is never blocked](0016-station-editor.md) | In force |
| 17 | [Privacy: kept on the device, nothing about people on the server](0017-privacy.md) | In force |
| 18 | [The information is given as it is, and says so](0018-information-as-it-is.md) | In force |
