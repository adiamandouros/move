# 4. One process and no database

Decided 2026-10-20 · In force

## Situation

Everything Wayhop serves is read-only for its visitors: timetables, stops
and lines built every night, live times kept for seconds. Nothing visitors
send is stored. The host runs Node 20 (its built-in SQLite needs Node 22.5)
and limits how many threads an account may run.

## Decision

- One Node process serves everything.
- What the nightly build makes are JSON files in `data/build/`, served as
  they are. Caches live in memory; those worth keeping through a restart
  (OASA's route names, the announcements, the lifts) are also kept on disk
  as JSON, written through a temporary file and a rename
  ([files.js](../../server/files.js)).
- No database.

## What follows

- Nothing to migrate or back up beyond files, and browsers can download the
  data and work offline ([5](0005-trips-in-the-browser.md)).
- The caches and the limit on what each visitor may ask for belong to the
  one process. A second process would split the caches and double our load
  on OASA ([21](0021-load-on-oasa-with-trips.md)), so Wayhop runs one. Node is not the
  bottleneck: OASA is.

## Look again when

- A feature needs queries on the server over data too big for browsers, or
  stores what people send (rider reports, accounts). Then the first step is
  a read-only SQLite file built every night beside the JSON.
