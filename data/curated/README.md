# Curated data

These are the hand-maintained files. Everything else is generated from OASA's
open data by `npm run build:data`, which also runs on server start and daily at
04:30 Athens time.

After editing, run `npm test` (checks these files for mistakes) and
`npm run build:data -- --offline --force` (rebuilds with the feeds you already
downloaded). A file with errors fails the build, and the site keeps serving the
previous build.

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

## lines.json — lines and directions

Colours, names and direction names. `gtfsDirection` is the feed's
`direction_id` for that direction.

## overrides.json — timetable fixes

Replaces a line's trips on given days with trains every N minutes, for when the
feed is known to be wrong. Each entry needs a `reason`. Periods are
`["HH:MM", "HH:MM", minutes]`, with times after midnight written as 24:00+.
