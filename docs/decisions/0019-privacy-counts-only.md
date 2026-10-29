# 19. Privacy: kept on the device; on the server, counts only

Decided 2026-10-29 · In force

## Situation

[Decision 17](0017-privacy.md) said "no analytics": the server kept nothing
about visits. Choosing which language to add after English and Greek
(roadmap item 43) needs to know which languages visitors' browsers ask for,
and the privacy page should say plainly that this is counted rather than
call it no analytics.

## Decision

- What makes Wayhop easier to use is kept on the device only: the language
  and colours chosen, favourites, recent stations, where each tool was left
  for the session, a closed install offer, the last location for 10 minutes
  and that it was allowed, offline copies.
- The server keeps nothing that identifies a person. It sees the stops
  asked for, by number; it keeps an IP address in memory for one minute,
  for the limit on what each visitor may ask for
  ([7](0007-load-on-oasa.md)); and the host keeps its standard logs.
- It counts, per day, the pages opened by the first language the browser
  asks for, and the language served: a number per language, never which
  page, when, or who. The same file counts what is asked of OASA, by stop
  number and route.
- No accounts, no cookies of Wayhop's own, no third-party analytics.
- Requests to OASA carry only the stop number.
- Ads only after Google's consent message.
- The privacy page says all this in both languages, and is changed before
  anything it describes is.

## What follows

- Features that would need personal data, like accounts or a trip
  history, are out.
- Anything counted about visits stays a count per day, never a record of a
  person or of a visit; a new count is named on the privacy page first.

## Look again when

- A feature needs to store what people send (rider reports, say).
- Something would need more than a count per day.
