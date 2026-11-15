# 56. The trip page: the last three places picked, kept on the device

Decided 2026-11-15 · In force

## Situation

Riders plan trips to the same few places again and again: home, work, a
friend's street. Each time they typed the address again and picked it from
the list. The trip itself is kept for 3 hours
([52](0052-trip-kept-on-the-device.md)), which said to look again if riders
wanted recent trips. The Subway page already offers the last three stations
picked.

## Decision

Agreed with the rider on 15 November 2026.

- **The last three places picked from search on the Trip page are kept on
  the device** (`localStorage`), for either end, most recent first, each
  once. Addresses, stations and named places all count; My location never
  does. Each is kept as search found it, as the trip is.
- **No time limit.** A fourth place pushes out the oldest; picking a kept
  place again puts it first. There's no button to forget them: they go when
  replaced, or when the browser's site data is cleared, as the privacy page
  says.
- **Offered in an empty field**, tapped or with ArrowDown, as the Subway
  page's stations are, under "Places you picked lately".
- **First while typing**: kept places whose words start with what's typed,
  in Greek or Latin letters as address search reads them, go above what
  search found, each place once.
- Nothing is sent anywhere ([19](0019-privacy-counts-only.md)): the places
  are compared with what's typed on the device.

## What follows

- The privacy page says it, in both languages, under what stays on the
  device.
- The Subway page's and the Trip page's recent lists share one way of
  keeping them (`public/js/core/recent.js`), and the Trip page compares
  spellings with the server's own `fold` (`public/js/core/text.js`).
- OASA and address search are asked no more often.

## Look again when

- Riders want to forget them, or to keep more than three.
- Riders want places of their own, named (home, work), or whole trips kept.
