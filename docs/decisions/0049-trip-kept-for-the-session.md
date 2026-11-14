# 49. The trip page: the trip kept for the session, 12 hours at most

Decided 2026-11-12 · Replaced by [52](0052-trip-kept-on-the-device.md)

## Situation

The trip page started with "addresses aren't kept": not in the page's
address, not remembered for coming back ([23](0023-trip-page.md),
[29](0029-trip-page-tram.md)). Subway and Buses already open where they were
left, for the tab or app session, as their choices are in their address
(`remember.js`, [19](0019-privacy-counts-only.md)). The trip page has
nothing there, so a rider who looked up a bus on the Buses page, or opened
a station, came back to empty fields and typed both ends again, often in the
middle of the trip they had set.

## Decision

- **The trip comes back while the tab or app stays open**, from the
  navigation, a reload or Back: planned again for the time it is then, with
  the fields hidden as for a trip just set.
- **For 12 hours at most** since it was last changed, so a tab left open
  overnight doesn't bring back yesterday's trip. Closing the tab or the app
  forgets it, as `sessionStorage` does.
- **What's kept of each end is the place as search found it**, so it's
  chosen again on the network the page plans on now (a tram stop with the
  tram hidden is an address again) and in the page's language.
- **My location isn't kept, nor where it was.** With no start kept, the page
  starts from where the rider is by itself, as it always has.
- **The link to the page you're on starts it over**, as on the other tools.
  "Change" is still how a trip is changed; there's no Clear button.
- **Still not in the page's address**, and nothing is sent anywhere: it stays
  in the tab ([19](0019-privacy-counts-only.md)).

## What follows

- The privacy page says it, in both languages, under what stays on the
  device.
- A trip kept and opened again asks OASA for its live times as a new trip
  does: the same as typing it again, and less than keeping the page open
  ([45](0045-load-on-oasa-my-location-follows.md)).
- Specs that open the trip page twice in a tab get the trip back the
  second time.
- A trip still can't be shared by link or bookmarked.

## Look again when

- Riders want a trip kept past closing the app, or a list of recent trips
  (that would be kept on the device, and said on the privacy page first).
- People want trips shared by link.
- Riders say 12 hours is too long or too short.
