# 17. Privacy: kept on the device, nothing about people on the server

Decided 2026-10-16 · In force

## Situation

Nobody should have to trade their data for a timetable. Wayhop has no
accounts and needs none.

## Decision

- What makes Wayhop easier to use is kept on the device only: the language
  and colours chosen, favourites, recent stations, the last location for 10
  minutes, offline copies.
- The server keeps nothing that identifies a person. It sees the stops
  asked for, by number; it keeps an IP address in memory for one minute,
  for the limit on what each visitor may ask for
  ([7](0007-load-on-oasa.md)); and the host keeps its standard logs. No
  analytics, no accounts.
- Requests to OASA carry only the stop number.
- Ads only after Google's consent message.
- The privacy page says all this in both languages, and is changed before
  anything it describes is.

## What follows

- Features that would need personal data, like accounts or a trip
  history, are out.
- Anything counted about visits stays a count, never a record of a
  person.

## Look again when

- A feature needs to store what people send (rider reports, say).
