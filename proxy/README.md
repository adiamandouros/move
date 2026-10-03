# OASA relay (Cloudflare Worker)

A fallback route to OASA's live-arrivals API for when the server can't reach
it directly. Shared hosting IPs are sometimes blocked because of another site
on the same server; the relay keeps the bus page working if that happens.

The server only uses it when a direct request fails. If direct requests keep
failing, it uses the relay alone for 10 minutes, then tries direct again.
Switches are logged as `[oasa] …` lines. The 2-requests-per-second limit
covers both routes together, so the relay never adds load on OASA.

The Worker relays only the two API calls the app uses, with numeric stop
codes, and only for requests carrying the shared key. It can't be used as an
open proxy.

## Set up

You need a free Cloudflare account. The free plan allows 100,000 requests a
day, far more than the relay will normally see.

1. **Make a key** (any long random string):

   ```bash
   openssl rand -hex 32
   ```

2. **Deploy the Worker.** Either with the command line:

   ```bash
   cd proxy
   npx wrangler login
   npx wrangler deploy                 # prints the Worker's URL
   npx wrangler secret put RELAY_KEY   # paste the key when asked
   ```

   or in the Cloudflare dashboard: **Workers & Pages → Create → Create
   Worker**, name it `move-oasa-relay`, deploy, then **Edit code**, replace
   everything with the contents of `worker.js` and deploy again. Add the key
   under **Settings → Variables and Secrets** as a *Secret* named
   `RELAY_KEY`.

3. **Check it works** (use your Worker's URL and key):

   ```bash
   curl -H "X-Relay-Key: YOUR_KEY" "https://move-oasa-relay.YOUR-SUBDOMAIN.workers.dev/?act=getStopArrivals&p1=10361"
   ```

   You should get a JSON list of arrivals (or `null` if no bus is due).
   Without the key header you should get `Unauthorized`.

4. **Tell the server about it** in its `.env`, then restart the app:

   ```
   OASA_RELAY_URL=https://move-oasa-relay.YOUR-SUBDOMAIN.workers.dev/
   OASA_RELAY_KEY=YOUR_KEY
   ```

   On startup the log shows `[oasa] Relay fallback: move-oasa-relay…`.

## If OASA blocks the relay too

OASA's live API only accepts connections from Greek IP addresses (in October
2026 it timed out from Germany, the Netherlands, France, Italy, Cyprus,
Bulgaria and the US, while OASA's website answered everywhere). A Worker
normally runs in the Cloudflare data centre closest to whoever calls it, so
for a server in Germany it runs in Frankfurt and is blocked as well.

`/admin/diagnostics` shows this under **Relay location**: it should say `GR`
(Cloudflare's Athens `ATH` or Thessaloniki `SKG` data centres).

1. **Deploy with the command line** (`npx wrangler deploy` in `proxy/`).
   `wrangler.toml` asks Cloudflare to run the Worker near OASA (a
   "placement hint"); edits made in the dashboard don't apply it. The key
   secret stays as it is. Give Cloudflare a few minutes to measure, then run
   the diagnostics again. The feature is experimental, so it may not work.
2. **If the relay still isn't in Greece**, it has to run on a machine with a
   Greek IP address instead, for example a small VPS hosted in Greece, or an
   always-on computer at home made reachable with Cloudflare Tunnel.
3. Either way, you can also ask OASA to allow your server's IP address (the
   diagnostics show it under **Internet access**).

## Changing the key

Run `npx wrangler secret put RELAY_KEY` again (or edit the secret in the
dashboard), update `OASA_RELAY_KEY` in the server's `.env`, and restart the
app.

## When something goes wrong

Run the diagnostics. They check, from the server itself, whether it can reach
the internet, OASA, the relay and the open-data portal, explain each failure
(e.g. "HTTP 403, typical when an IP address is blocked" or "the Worker rejects
the key") and end with what to do:

- in the browser at `/admin/diagnostics` (needs `ADMIN_PASSWORD`), or
- if the site is down: cPanel → **Setup Node.js App** → your app →
  **Run JS script** → `diagnose` (or `npm run diagnose` in a terminal).
