// Runs the OASA relay (worker.js, unchanged) as a plain Node.js server, for
// an always-on machine with a Greek IP address such as a Raspberry Pi at home.
// OASA's live API only accepts connections from Greece, so this is the relay
// to use when the Cloudflare Worker can't run there. Setup: README.md, "Home relay".
//
//   RELAY_KEY=... node proxy/node.js
//
// It listens on localhost only (PORT, default 8787); a web server in front of
// it (Caddy) provides HTTPS and is the only part exposed to the internet.
// No npm packages needed: Node.js 20 or newer is enough.

import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';
import worker from './worker.js';

export function createRelayServer(env) {
    return createServer(async (req, res) => {
        let response;
        try {
            // Only the headers the relay reads are passed on
            const headers = new Headers();
            for (const name of ['x-relay-key', 'user-agent']) {
                if (typeof req.headers[name] === 'string') headers.set(name, req.headers[name]);
            }
            const request = new Request(new URL(req.url, 'http://relay'), { method: req.method, headers });
            response = await worker.fetch(request, env);
        } catch {
            // e.g. a method the Request constructor rejects, like CONNECT
            response = new Response('Bad request', { status: 400, headers: { 'Content-Type': 'text/plain' } });
        }
        const body = Buffer.from(await response.arrayBuffer());
        res.writeHead(response.status, { ...Object.fromEntries(response.headers), 'Content-Length': body.length });
        res.end(body);
    });
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
    const env = { RELAY_KEY: process.env.RELAY_KEY };
    if (!env.RELAY_KEY) {
        console.error('RELAY_KEY is not set (see proxy/README.md, "Home relay")');
        process.exit(1);
    }
    const port = Number(process.env.PORT ?? 8787);
    const host = process.env.HOST ?? '127.0.0.1';
    createRelayServer(env).listen(port, host, () => console.log(`OASA relay listening on http://${host}:${port}`));
}
