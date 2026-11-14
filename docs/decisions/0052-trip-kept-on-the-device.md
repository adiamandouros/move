# 52. The trip page: the trip kept on the device for 3 hours

Decided 2026-11-14 · In force

## Situation

[49](0049-trip-kept-for-the-session.md) kept the trip set on the Trip page
for the tab or app session (`sessionStorage`), 12 hours at most, and said to
look again if riders wanted it kept past closing the app.

From the road (roadmap Road · 2): on Android, the installed app is closed
by the phone now and then while the screen is off. Opened again, it's a new
session, so the trip was gone, though the rider never closed anything.
Wayhop can't tell the phone closing the app from the rider closing it.

## Decision

Agreed with the rider on 14 November 2026.

- **The trip is kept on the device** (`localStorage`), so it comes back
  after the app or the tab is closed, by the phone or by the rider, as well
  as from the navigation, a reload or Back.
- **For 3 hours since it was last changed**, so it's the trip the rider is
  on, not one from the morning. The same trip set again doesn't make it
  younger, as in 49.
- Everything else in 49 stands: each end kept as the place search found it;
  My location isn't kept, nor where it was; the link to the page you're on
  starts it over; nothing in the page's address, nothing sent anywhere
  ([19](0019-privacy-counts-only.md)).

## What follows

- A new tab of the Trip page opens with the trip too, within the 3 hours.
- The privacy page says it, in both languages, under what stays on the
  device.
- OASA is asked no more often: a trip kept and opened again asks for its
  live times as a new trip does
  ([50](0050-trip-follows-the-ride.md)).

## Look again when

- Riders say 3 hours is too long or too short.
- Riders find a trip coming back in a new tab gets in the way.
- Riders want a list of recent trips, or trips shared by link.
