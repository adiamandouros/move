# OASA relay

A fallback route to OASA's live-arrivals API for when the server can't reach
it directly.

OASA's live API only accepts connections from Greek IP addresses (in October
2026 it timed out from Germany, the Netherlands, France, Italy, Cyprus,
Bulgaria and the US, while OASA's website answered everywhere). The Wayhop
server is in Germany, so live bus times only work through a relay whose
requests come from Greece.

There are two relays, and the server tries the routes in this order:

1. **Direct** to OASA, in case the geo-block is lifted one day.
2. **[Cloudflare Worker](#cloudflare-worker)**: free, no hardware. Today
   Cloudflare runs it in Frankfurt for a server in Germany, so OASA blocks it
   too. It stays in place in case Cloudflare starts running it in Greece.
3. **[Home relay](#home-relay)**: an always-on machine at home, e.g. a
   Raspberry Pi. Its requests come from a Greek connection, so it works.

The relays also carry **STASY's pages** (its news page and posts, for the
metro and tram announcements on the home and info pages, and its timetable
pages for metro lines 1–3, for the first and last trains): STASY answers the
server with 403, as it refuses data-centre addresses. Only single-segment
paths on www.stasy.gr (`?act=stasyPage&path=…`), the three Greek
timetable pages (`?act=stasyTimetable&line=1|2|3`) and PDFs STASY has
uploaded (`?act=stasyFile&path=wp-content/uploads/YYYY/MM/….pdf`, for the
weekly check of its airport timetable) are relayed. The app tries
STASY directly first; after a refusal it uses the relays for a day. The
home relay gzips large answers (STASY's news page: 1.1 MB → about 110 KB).
**STASY** on `/admin/diagnostics` shows the route it came through.

A failed request moves on to the next route. After 5 failures in a row a
route rests for a day while the routes after it carry the traffic, then one
request tries it again. So today requests go straight to the home relay, and
once a day one request first retries direct and the Worker (it takes up to
14 s). Right after the app starts, the first few requests are slow until the
blocked routes are put to rest. To retry them sooner, restart the app. The last route only rests for
a minute, as nothing comes after it. Switches are logged as `[oasa] …` lines.
The 2-requests-per-second limit covers all routes together, so the relays
never add load on OASA.

Each relay is optional and turned on by its two settings in the server's
`.env`: `OASA_RELAY_URL`/`OASA_RELAY_KEY` for the Worker and
`OASA_HOME_RELAY_URL`/`OASA_HOME_RELAY_KEY` for the home relay. Use a
different key for each.

Both relays run the same code (`worker.js`). It passes on only the two API
calls the app uses, with numeric stop codes, and only for requests carrying
the relay's key. It can't be used as an open proxy.

## Home relay

`node.js` runs `worker.js` as a plain Node.js server. Caddy sits in front of
it, gets a free HTTPS certificate for the home's DDNS name and is the only
part reachable from the internet.

```
Wayhop server (DE) ──HTTPS──▶ router :2087 ──▶ Caddy :443 ──▶ node.js :8787 ──▶ OASA
                            YOUR-NAME.ddns.net              (localhost only)
```

You need a Raspberry Pi 3 or newer with a 64-bit OS (or any always-on Linux
machine), and a home connection with a public IP address (not behind
carrier-grade NAT). The traffic is tiny: a few KB per request.

### 1. Keep the DDNS name up to date

`YOUR-NAME.ddns.net` must always point to the home's current IP. Check it on
the Pi:

```bash
dig +short YOUR-NAME.ddns.net                                     # what the name says
curl -s https://www.cloudflare.com/cdn-cgi/trace | grep '^ip='     # the actual IP
```

If they differ, the DDNS updater isn't running. Either turn on DDNS in the
router (most routers support No-IP under *DDNS* or *Dynamic DNS*), or install
No-IP's updater on the Pi (noip.com → *Dynamic Update Client*). Free No-IP
names must be confirmed every 30 days by email, or they stop working.

### 2. Forward ports on the router

1. Give the Pi a fixed LAN address: a *DHCP reservation* in the router, or
   if the router doesn't allow that, a manual address on the Pi itself
   (`sudo nmtui` → *Edit a connection*).
2. Forward two ports to the Pi:

   | External (TCP) | Pi port | What for |
   |---|---|---|
   | 80 | 8081 | Let's Encrypt checks the name here, to issue and renew Caddy's certificate |
   | 2087 | 443 | The relay itself, over HTTPS |

   Not external 443: ISP routers often keep it for their own admin page and
   silently ignore forwarding rules for it. And not just any free port: shared
   hosting usually blocks outgoing connections to unusual ports (Mediahost
   refuses 8443, for example), and 2087 gets through because it's cPanel's own
   port. To see which ports the server can reach, run this in the cPanel
   Terminal (portquiz.net answers on every port; `200` means allowed):

   ```bash
   for p in 2087 8443 2083 2096; do printf "$p: "; curl -s -m 5 -o /dev/null -w "%{http_code}\n" http://portquiz.net:$p/ || echo blocked; done
   ```

   Port 80 on the Pi itself (e.g. Pi-hole's admin page) stays private, as
   nothing is forwarded to it.

   Check from outside with check-host.net (*TCP port* check on
   `YOUR-NAME.ddns.net:80` and `:2087`): before Caddy runs, "Connection
   refused" means the port reaches the Pi; "timed out" means the router
   doesn't forward it.

### 3. Install Node.js and the code

```bash
node -v    # must be v20 or newer
```

Raspberry Pi OS based on Debian 13 (Trixie) ships Node.js 20 with
`sudo apt install nodejs`. On Debian 12 (Bookworm) that version is too old:
install Node.js 22 from NodeSource (nodesource.com → *Distributions*)
instead.

```bash
sudo git clone https://github.com/adiamandouros/move.git /opt/move
```

There's no `npm install`: the relay uses only what's built into Node.js.

### 4. Run the relay as a service

```bash
openssl rand -hex 32                              # the key; copy it
echo 'RELAY_KEY=PASTE_THE_KEY' | sudo tee /etc/move-relay.env
sudo chmod 600 /etc/move-relay.env
sudo cp /opt/move/proxy/move-relay.service /etc/systemd/system/
sudo systemctl enable --now move-relay
systemctl status move-relay                       # "OASA relay listening on http://127.0.0.1:8787"
```

Check it reaches OASA (use your key):

```bash
curl -H "X-Relay-Key: YOUR_KEY" "http://127.0.0.1:8787/?act=getStopArrivals&p1=10361"
```

You should get a JSON list of arrivals (or `null` if no bus is due).

### 5. Put Caddy in front of it

Do this once the DDNS name points to the home (step 1) and the ports are
forwarded (step 2). Otherwise Caddy's certificate requests fail, and repeated failures
get it rate-limited by Let's Encrypt for a while.

```bash
sudo apt install caddy           # it may fail to start: port 80 is taken; fine
sudo cp /opt/move/proxy/Caddyfile /etc/caddy/Caddyfile
sudo nano /etc/caddy/Caddyfile   # replace YOUR-NAME.ddns.net with your DDNS name
sudo systemctl enable caddy
sudo systemctl restart caddy
journalctl -u caddy -n 30        # look for "certificate obtained successfully"
```

Caddy's own plain-HTTP port is moved to 8081 in the Caddyfile, so it doesn't
clash with whatever already uses port 80. If something else already uses
port 443 on the Pi, add the `YOUR-NAME.ddns.net { … }` block to that setup
instead.

Check it from outside: a check-host.net *HTTP* check of
`https://YOUR-NAME.ddns.net:2087/?act=getStopArrivals&p1=10361` should
answer `401 Unauthorized` (no key, so refused, as it should be).

Optionally, uncomment the two lines in the Caddyfile that let only the Wayhop
server connect (its IP is on `/admin/diagnostics` under **Internet access**)
and reload Caddy. Everyone else is then cut off before reaching the relay.
The key already keeps strangers out, so this only adds a second layer. It
also means that if the hosting company moves the server to a new IP, live
times stop until you update the Caddyfile.

### 6. Point the server at it

In the server's `.env`, then restart the app:

```
OASA_HOME_RELAY_URL=https://YOUR-NAME.ddns.net:2087/
OASA_HOME_RELAY_KEY=THE_SAME_KEY
```

On startup the log shows `[oasa] Fallback home relay: YOUR-NAME.ddns.net:2087`.
`/admin/diagnostics` should then show **Home relay with your key** working
and **Home relay location** in `GR`. While OASA blocks the Worker, its rows
show as *INFO* ("expected… the home relay carries the traffic").

### Updating

```bash
sudo git -C /opt/move pull && sudo systemctl restart move-relay
```

Do this after any change to `proxy/` (e.g. October 2026: STASY pages; then
version 3, the calls the nightly data build makes for the bus network:
webGetLines, webGetRoutes, webGetStops; then version 4, STASY's timetable
pages; then version 5, STASY's uploaded PDFs; then version 6, which
accepts the airport PDFs' long names). If `/admin/diagnostics` says "The
relay doesn't know STASY pages yet", the relay hasn't been updated.

Every change a deployed relay needs also raises `RELAY_VERSION` in
`worker.js`. The server's health check (`/api/health`, checked every 30
minutes by `.github/workflows/health.yml`) asks each relay for its version
and opens a GitHub issue while one is behind. So after merging such a change,
update both relays: the home relay as above, and the Worker with
`cd proxy && npx wrangler deploy`.

### If the home connection goes down

Live bus times stop until it's back. The rest of the site isn't affected. The
bus page shows its last cached times as usual.

## Cloudflare Worker

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

   On startup the log shows `[oasa] Fallback relay: move-oasa-relay…`.

A Worker normally runs in the Cloudflare data centre closest to whoever calls
it, so for a server in Germany it runs in Frankfurt and OASA blocks it.
`wrangler.toml` asks Cloudflare to run it near OASA instead (a "placement
hint", only applied by `npx wrangler deploy`, not by dashboard edits). The
feature is experimental and didn't place it in Greece in October 2026.
`/admin/diagnostics` shows where it runs under **Relay location**.

## Changing the key

Generate a new one with `openssl rand -hex 32` and set it on the relay:

- Home relay: edit `/etc/move-relay.env`, then `sudo systemctl restart move-relay`.
  Then update `OASA_HOME_RELAY_KEY` in the server's `.env`.
- Worker: `npx wrangler secret put RELAY_KEY` (or edit the secret in the dashboard).
  Then update `OASA_RELAY_KEY` in the server's `.env`.

Restart the app afterwards.

## When something goes wrong

Run the diagnostics. They check, from the server itself, whether it can reach
the internet, OASA, the relay and the open-data portal, explain each failure
(e.g. "HTTP 403, typical when an IP address is blocked" or "the relay rejects
the key") and end with what to do:

- in the browser at `/admin/diagnostics` (needs `ADMIN_PASSWORD`), or
- if the site is down: cPanel → **Setup Node.js App** → your app →
  **Run JS script** → `diagnose` (or `npm run diagnose` in a terminal).

For the home relay, also check on the Pi: `systemctl status move-relay caddy`
and `journalctl -u move-relay -u caddy -n 50`. A timeout from the server
usually means the DDNS name points to an old IP (step 1) or the router's port
forwarding was lost (step 2). If the certificate stops renewing, check the
port-80 rule.
