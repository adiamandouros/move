# 12. Shared hosting, and what it rules out

Decided 2026-10-03 · In force

## Situation

Wayhop runs on shared cPanel hosting (CloudLinux, LiteSpeed) in Germany,
with Node 20, beside the account's other apps. It is cheap, and deploys
are a button.

## Decision

Wayhop fits the host:

- **No top-level `await`** anywhere `server.js` imports: LiteSpeed starts
  the app by `require()`-ing it, and one such `await` took the site down
  on 19 October 2026 (`test/startup.test.js`).
- **Every file's address carries its version** (`?v=`, `assets.js`), since
  LiteSpeed serves `public/` itself and lets browsers keep files for a week.
- **No `npm` in the app's folder**: `node_modules` is a link the host
  manages, so a deploy installs through cPanel's own tool
  ([cpanel-deploy.sh](../../scripts/cpanel-deploy.sh)).
- **The account may run 100 threads**, all its apps together, about 11 per
  Node app; at the limit nothing new starts, not even cPanel's Node.js page.
  Copies of apps left running after a restart filled it twice. The newest
  copy of Wayhop stops its own older copies, a deploy stops the copies from
  before it, and a data build ends with `process.exit()`, since the host
  preloads LiteSpeed's `lsnode.js` into it, which kept builds running for
  hours; one still running after an hour is stopped
  ([processes.js](../../server/processes.js), #138, #146). `/api/health`
  warns from 70 threads.
- **No system cron**: the nightly build is scheduled inside the app.
- **Only a few outgoing ports are open**, which decided the relay's port
  ([proxy/README.md](../../proxy/README.md)).

## What follows

- Some code exists only for the host: the process guard, the deploy
  script, and their tests.
- Node 22's features wait until the host offers it.

## Look again when

- One of the account's limits is reached.
- A host with Greek addresses, at a price that makes sense, would also make
  the relays unnecessary ([8](0008-routes-and-relays.md)).
