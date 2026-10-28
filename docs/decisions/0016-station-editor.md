# 16. The station editor is never blocked

Decided 2026-10-25 · In force

## Situation

Where to stand on each train, how platforms are reached without steps and
each station's notes are collected by hand, often from a phone on the
platform, sometimes underground.

## Decision

- `/admin/stations` (only when `ADMIN_PASSWORD` is set) saves each edit to
  `data/local/positions.json`, beside the committed
  `data/curated/positions.json`. The next build uses both
  ([overlay.js](../../server/data/overlay.js)).
- Once the committed file has caught up (export, commit, deploy), the edits
  it now holds are removed from the local file.
- Nothing stands in the way of a save: no check, test or deploy step. Only
  an entry that isn't valid data is refused, with the reason.
- The editor opens offline on the device that uses it.

## What follows

- Until they are committed, edits exist only on the server's disk.
- Any change near the editor, the positions data or the build after a save
  is checked against this rule.
- Tests read the station data rather than writing what it says into
  themselves, so a hand edit never fails a commit (#124).

## Look again when

- Edits come from more than one person.
