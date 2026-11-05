# 27. Reaching OASA and STASY: direct first, now that OASA answers from abroad

Decided 2026-11-05 · In force

## Situation

[8](0008-routes-and-relays.md) was decided while OASA's live API only
answered Greek addresses. The server, in Germany, and the Cloudflare Worker,
in Frankfurt, were blocked, so every request went through the home relay.
On 4 November 2026 the server's own test found OASA answering it directly,
and OASA answered from 30 countries (check-host.net). STASY's website still
refuses the server, as it refuses data centres. It answered the Worker.

A route that failed rested for a day, as the block wasn't expected to change
quickly. With direct carrying the traffic, a moment of trouble at OASA would
then leave the routes behind it carrying everything for a day, the home
relay too: the home connection was never meant to be the main way in.

## Decision

- Every request to OASA goes through an ordered list of routes: direct, the
  Cloudflare Worker, then the home relay
  ([proxy/README.md](../../proxy/README.md)). The Worker is in use again.
- A route with another one behind it is used only after a test request in
  the background has passed, and rests for 10 minutes after repeated
  failures ([client.js](../../server/oasa/client.js)). The last route rests
  for a minute.
- STASY's pages go through the same relays
  ([stasy.js](../../server/stasy.js)). After a refusal, direct access to
  STASY still rests for a day: STASY hasn't changed.
- Relays pass on only the calls they list. Each has a version, and the
  health check reports a relay that is behind.

## What follows

- Live times no longer depend on the home connection. The Worker and the
  home relay carry them only while the routes before them fail.
- After a moment of trouble at OASA, direct is back in use within about 10
  minutes. Each test is one request, so a resting route costs at most 6
  requests an hour, well inside the budget ([26](0026-bus-pass-collector.md)).
- If OASA blocks addresses abroad again, direct and the Worker are tested
  every 10 minutes in the background. Nobody waits on them.
- Routes with one behind them wait 3 seconds for an answer, the last route
  8. Direct's answer times on /admin/usage are read after its first rush
  hours before that changes.
- A new OASA or STASY call needs a new relay version, deployed to both
  relays, before Wayhop can use it.

## Look again when

- Direct's answers in the rush hour come close to 3 seconds.
- OASA blocks addresses abroad again, or the server moves.
- The home relay is down often enough to matter.
