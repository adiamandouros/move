# Curated data

These are the hand-maintained files. Everything else is generated from OASA's
open data by `npm run build:data`, which also runs on server start and daily at
04:30 Athens time.

After editing, run `npm test` (checks these files for mistakes) and
`npm run build:data -- --offline --force` (rebuilds with the feeds you already
downloaded). A file with errors fails the build, and the site keeps serving the
previous build.

These files are under CC BY-SA 4.0, not the code's license: see
[LICENSE.md](LICENSE.md).

## Editing on the go: /admin/stations

Set `ADMIN_PASSWORD` in `.env` to enable a private, phone-friendly editor for
positions.json at `/admin/stations` (it's a 404 without the password). Edits
are stored on the server in `data/local/positions.json` (not in git) and go
live within seconds. They work offline too: saves are queued on the phone and
sent when the connection returns.

To make edits permanent, use **Export** in the editor, replace
`data/curated/positions.json` with the downloaded file, commit and deploy.
The next build notices the committed file now contains those edits and drops
them from `data/local/`.

## positions.json — where to stand

Ordered by line → direction → station in travel order, one station per line:

```json
"monastiraki": { "exits": ["center-back", "center-front"], "elevators": ["center-front"], "transfers": { "M3/dimotiko": ["center-back"] }, "note": "Regular steps - no escalators" }
```

| Field | Meaning |
|---|---|
| `exits` | Cars closest to the exit when getting off here. `[]` = no data yet. |
| `elevators` | Cars closest to the elevator. Optional. |
| `centralPlatform` | `true` if the platform is between the tracks (exit on the left). Optional. |
| `transfers` | Cars closest to the way to another line, keyed `"LINE/direction"` (see lines.json). Optional. |
| `note` | Free text shown under the diagram. Optional. |

Positions, from the back of the train to the front:
`back`, `center-back`, `center`, `center-front`, `front`.

## stations.json — stations and their GTFS platforms

```json
"monastiraki": { "name": { "el": "Μοναστηράκι", "en": "Monastiraki" }, "gtfs": ["MON1", "MON2", "MONA1", "MONA2"] }
```

`gtfs` lists the feed's `stop_code`s for the station's platforms (one per line
and direction, sometimes more). If OASA adds or renames a platform, the build
fails with "Rail stops not mapped to any station" and names the code: add it to
the right station, or to `ignoreGtfs` if it isn't a real station (e.g. the
`CT_PLK` link track at Doukissis Plakentias).

`stasy` (optional) lists how STASY's timetable pages write the station's name,
when that isn't its Greek name: case, accents, dots and spaces don't matter,
nor Latin letters that look Greek. If STASY writes a name the build doesn't
know, the line's first and last trains come from the GTFS and the build warns
'unknown station "…"': add the name here.

## lines.json — lines and directions

Colours, names and direction names. `gtfsDirection` is the feed's
`direction_id` for that direction.

## airport.json — STASY's airport trains

STASY's timetable for the metro's airport trains (line 3, Dimotiko Theatro ↔
Airport), copied from its two PDFs (linked from its
[line 3 page](https://www.stasy.gr/δρομολόγια/γραμμή-3/), "from 24 June 2024").
The GTFS misses some of these trains (the last ones) or ends them early, at
Doukissis Plakentias, so the build adds them (`addTimetabled` in
`server/data/build-rail.js`): a GTFS train within 90 s of one at the airport
is that train and keeps the GTFS's times; the others run with these times,
every day.

Per line and direction (as in lines.json): `pdf` (the PDF's address) and
`sha256` (its fingerprint, `sha256sum file.pdf`), `serves` (the station only
these trains reach), `stations` (in travel order, exactly the line's) and
`trains`, each `{ "train": "332", "times": [...] }` with a time per station,
`HH:MM`, after midnight `24:05`. `checked` is when it was copied, `page` the
page that links the PDFs.

Once a week the nightly build checks that the page still links these PDFs
and that they're unchanged (`server/data/airport-check.js`). If not,
`/api/health` reports it (the health issue emails it) and `/admin/diagnostics`
says what changed; the trains here are still added. To update: download the
new PDFs, copy their times here (`pdftotext -layout file.pdf -` reads them),
set `pdf`, `sha256` and `checked`, and run `npm test`. The check runs again
on the next build.

