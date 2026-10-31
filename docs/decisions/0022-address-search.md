# 22. Address search from OpenStreetMap, built on GitHub

Decided 2026-10-31 · In force

## Situation

Version 1's planner takes a start and an end address, so Wayhop has to find
addresses in Attica. Nominatim, OpenStreetMap's own search, doesn't allow
searching as someone types, and public alternatives promise nothing. A
trial, the Address Lab, showed that OpenStreetMap's data for Attica is good
enough: about 117,000 house numbers on 33,500 streets. It's patchy, though:
many numbers aren't mapped, and some streets aren't either.

The index takes about 550 MB to build. The host's 1 GB is shared with the
account's other apps and about half used ([12](0012-shared-hosting.md)).

## Decision

- **Our own index, in the server's memory, behind our own address.** Search
  runs on our server, at least for now; a person's search reaches no third
  party, and OpenStreetMap's servers are never asked on a search.
- **It answers as exactly as the data allows, and says how exactly**: a
  mapped number, one from a mapped range, between two known numbers, past
  the last one if the numbers clearly run that way, the nearest known
  number, or only the street.
- **It never jumps.** A street that isn't in the town typed says so, and lists
  the other towns that have it. A finished town name is strict; one still
  being typed may match more than one town.
- **Built once a week on GitHub**, not on the host. A workflow fetches the
  data from Overpass, builds the index and checks it against floors, last
  week's counts and known answers. Only a good index is published, as the
  release `places-index`, and the site downloads that one file.
- **A bad week changes nothing.** The last good index stays published.

## What follows

- The build is `scripts/places/`, on GitHub, which needs nothing installed;
  the search is `server/places/`. They share one file's code, so the checks
  run the same search as the site.
- The search adds about 95 MB to what the app uses on the host, from the
  first search on. A new index replaces the old by dropping it, so the two
  are never in memory together. Its load on the host is one 2 MB download a
  week, and nothing changes for OASA.
- The index is a database made from OpenStreetMap, so it's public under the
  same licence (ODbL), and the site must credit OpenStreetMap wherever it
  shows these results.
- What someone types goes to our server, in the body of a `POST`, so that
  addresses stay out of the host's request logs, and it isn't kept. The
  privacy page says so ([19](0019-privacy-counts-only.md)).
- Metro and tram stops come from the live site's `rail.json`, so a broken
  site stops the week's index, not the search.
- Coverage comes from volunteers. A wrong or missing address is fixed in
  OpenStreetMap, and reaches Wayhop within a week.

## Look again when

- Search needs more memory than the host can spare, or the host's limits
  change.
- Overpass stops answering GitHub's machines: Geofabrik's Greece extract
  holds the same data.
- A hosted search with guarantees, at a price that makes sense, would give
  better answers than our own.
