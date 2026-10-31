# 23. The trip page: door to door, beside Subway and Buses

Decided 2026-10-31 · In force

## Situation

Version 1 is one planner from a start address to an end address, in every
mode. Address search exists ([22](0022-address-search.md)), but the only
planners are the Subway page, station to station, and the bus trip finder, a
beta. Addresses could have gone into either, or into a page of their own.

## Decision

- **A page of its own, `/trip`, that grows into version 1.** It starts with
  walks and the metro, marked Beta, and buses and trams join it later. Subway
  and Buses stay as they are; whether it replaces them is decided later.
- **Worked out in the browser**, like metro trips
  ([5](0005-trips-in-the-browser.md)). The server only finds the places.
- **Not just the nearest station.** The three nearest to each end are tried,
  and what arrives first is shown first, as a station a little further away
  can be on a direct line.
- **Walks are estimates and say so**: the straight line plus a third, at 80 m
  a minute, shown with "~", with Google Maps for the way. There's no street
  map behind them.
- **It says when walking is quicker, and shows long walks** with a note that
  a bus may be better, rather than hiding them.
- **Addresses aren't kept.** They're not in the page's address, not remembered
  for coming back, and a location from "My location" stays on the device.

## What follows

- The page needs a connection, as search is on the server. Metro times alone
  would work offline; addresses don't.
- A trip can't be shared by link or bookmarked yet: that would put an address
  in the page's address.
- It says nothing about step-free access, since the walks and station
  entrances aren't known yet (roadmap item 22).
- Metro times here are the timetable's, as on the Subway page; live data
  comes with buses ([11](0011-real-data-first.md)).

## Look again when

- Buses or trams join the page.
- People want trips kept or shared.
- A walking route source would replace the estimate.
