// Can the server reach OASA: the settings, DNS, the internet, OASA's live
// API, each relay and the open-data portal, and the verdict they add up to.

import { CKAN_API, SOURCES } from '../data/sources.js';
import { FALLBACK_REST_MS, OASA_API, TEST_STOP } from '../oasa/client.js';
import { capital, check, describeHttp, failureText, isApiAnswer, probe } from './probe.js';

const PORTAL = CKAN_API + SOURCES.rail.dataset;
const INTERNET = 'https://www.cloudflare.com/cdn-cgi/trace';
// Longer than the relay's own 6 s limit on OASA, so its "can't reach OASA" answer arrives
const RELAY_TIMEOUT_MS = 12_000;
const MIN_NODE = 20;

// The settings (server/config.js): the ones that matter for reaching OASA,
// and every setting that was given but can't be used
/** @param {import('../../types/config.js').Config} config @param {string} nodeVersion */
export function configChecks(config, nodeVersion) {
    const major = Number(nodeVersion.replace(/^v/, '').split('.')[0]);
    const relays = config.relays.map(r => check('Configuration', `${capital(r.name)} fallback`, 'ok', `Configured: ${new URL(r.url).host}`));
    const relayProblems = config.problems.some(p => / fallback$/.test(p.title));
    return [
        major >= MIN_NODE
            ? check('Configuration', 'Node.js version', 'ok', nodeVersion)
            : check('Configuration', 'Node.js version', 'fail', `${nodeVersion} is too old`, `Select Node.js ${MIN_NODE} or newer in cPanel → Setup Node.js App.`),
        config.contactEmail
            ? check('Configuration', 'Contact email', 'ok', `Sent to OASA as ${config.contactEmail}`)
            : check('Configuration', 'Contact email', 'warn', 'CONTACT_EMAIL is not set', 'Set it in .env so OASA can contact you instead of blocking the server.'),
        ...relays,
        ...(relays.length || relayProblems ? []
            : [check('Configuration', 'Relay fallback', 'warn', 'Not configured: if OASA blocks this server, live times stop', 'See proxy/README.md to set up a relay.')]),
        ...config.problems.map(p => check('Configuration', p.title, 'fail', p.text, p.hint)),
    ];
}

export async function dnsCheck(dnsLookup, host) {
    try {
        const { address } = await dnsLookup(host);
        return check('DNS', host, 'ok', address);
    } catch (err) {
        return check('DNS', host, 'fail', `Can't look up ${host} (${err.code ?? err.message})`);
    }
}

export async function internetCheck(fetch) {
    const p = await probe(fetch, INTERNET);
    if (!p.ok) return { result: check('Network', 'Internet access', 'fail', `Can't reach cloudflare.com: ${failureText(p)}`), ip: null, loc: null };
    const fields = Object.fromEntries(p.text.split('\n').map(l => l.split('=')));
    return { result: check('Network', 'Internet access', 'ok', `Public IP ${fields.ip ?? '?'}${fields.loc ? ` (${fields.loc})` : ''}, ${p.ms} ms`), ip: fields.ip ?? null, loc: fields.loc ?? null };
}

// OASA's live API silently dropped connections from outside Greece from
// October to November 2026 (checked from 8 countries), so a timeout from
// abroad most likely means that block is back
const GEO_BLOCK = 'OASA\'s live API seems to accept connections only from Greece again';

export const probeOasa = fetch => probe(fetch, `${OASA_API}?act=getStopArrivals&p1=${TEST_STOP}`);

// Interpreted once the server's country is known (from the internet check)
export function oasaCheck(p, serverCountry) {
    if (isApiAnswer(p)) return { result: check('Services', 'OASA live API (direct)', 'ok', `${describeArrivals(p.json)}, ${p.ms} ms`), probe: p };
    const geo = p.kind === 'timeout' && Boolean(serverCountry) && serverCountry !== 'GR';
    return {
        result: check('Services', 'OASA live API (direct)', 'fail', geo ? `${failureText(p)}. ${GEO_BLOCK}, and this server is in ${serverCountry}` : failureText(p)),
        probe: p,
        geo,
    };
}

const describeArrivals = json => Array.isArray(json) ? `${json.length} arrivals at the test stop` : 'answered (no buses due at the test stop)';

// What to check when a relay can't be reached at all
const UNREACHABLE_HINT = {
    'home relay': 'Is the machine at home on, and its internet up? Check that the DDNS name points to the home\'s current IP and that the router still forwards the relay\'s ports. If check-host.net reaches it but this server can\'t, the hosting blocks that outgoing port: use one it allows (proxy/README.md, "Home relay", step 2).',
};

// One relay ({ name, env, url, key }): its guard, its answer with the key, and where it runs
export async function relayChecks(fetch, relay) {
    const { name, env: prefix } = relay;
    const Name = capital(name);
    const url = `${relay.url}?act=getStopArrivals&p1=${TEST_STOP}`;
    const key = { 'X-Relay-Key': relay.key };
    const [anon, keyed, where] = await Promise.all([
        probe(fetch, url),
        probe(fetch, url, key, RELAY_TIMEOUT_MS),
        probe(fetch, `${relay.url}?act=whereami`, key),
    ]);
    const location = where.ok && where.json?.loc ? where.json : null;

    let info = null;
    let result;
    if (isApiAnswer(keyed)) {
        result = check('Services', `${Name} with your key`, 'ok', `${describeArrivals(keyed.json)}, ${keyed.ms} ms`);
    } else if (keyed.status === 401) {
        info = 'key';
        result = check('Services', `${Name} with your key`, 'fail', `The ${name} rejects the key`,
            `${prefix}_KEY in .env must equal the ${name}'s RELAY_KEY. Set them to the same value (proxy/README.md, "Changing the key") and restart the app.`);
    } else if (keyed.status === 400) {
        info = 'old-worker';
        result = check('Services', `${Name} with your key`, 'fail', `The ${name} refused the request as invalid`, `The ${name} may be outdated. Update it to the latest proxy/worker.js.`);
    } else if (keyed.status === 404 || anon.status === 404) {
        info = 'url';
        result = check('Services', `${Name} with your key`, 'fail', describeHttp(404), `Check ${prefix}_URL in .env against the ${name}'s address.`);
    } else if (keyed.status === 502 || (keyed.status >= 400 && /Upstream error/.test(keyed.text ?? ''))) {
        info = 'oasa-from-relay';
        result = check('Services', `${Name} with your key`, 'fail', `The ${name} is fine but can't reach OASA either: ${keyed.text?.slice(0, 120)}`);
    } else if (keyed.ok) {
        result = check('Services', `${Name} with your key`, 'fail', `Relayed, but OASA's answer isn't API data: ${failureText(keyed)}`);
        info = 'oasa-from-relay';
    } else {
        result = check('Services', `${Name} with your key`, 'fail', failureText(keyed), keyed.status === null ? UNREACHABLE_HINT[name] : undefined);
    }

    const place = location
        ? (location.loc === 'GR'
            ? check('Services', `${Name} location`, 'ok', `Its requests come from GR (nearest Cloudflare data centre: ${location.colo})`)
            : check('Services', `${Name} location`, 'warn', `Its requests come from ${location.loc} (nearest Cloudflare data centre: ${location.colo}), outside Greece, where OASA's live API blocks connections`,
                'The relay needs to run in Greece. See proxy/README.md, "Home relay".'))
        : where.status === 400
            ? check('Services', `${Name} location`, 'info', `Unknown: the ${name} is older than this check`, 'Update it to the latest proxy/worker.js to see where it runs.')
            : null;

    const guard = anon.status === 401
        ? check('Services', `${Name} without a key`, 'ok', 'Refused (401), so strangers can\'t use it')
        : anon.status === null
            ? check('Services', `${Name} without a key`, 'fail', failureText(anon))
            : check('Services', `${Name} without a key`, 'warn', `Expected 401, got ${describeHttp(anon.status)}`, `If this isn't your ${name}, check ${prefix}_URL.`);
    return { name, results: [guard, result, ...(place ? [place] : [])], result, keyed, anon, info, location };
}

export async function portalCheck(fetch) {
    const p = await probe(fetch, PORTAL);
    return p.ok && p.json?.success
        ? check('Services', 'OASA open-data portal (timetables)', 'ok', `${p.ms} ms`)
        : check('Services', 'OASA open-data portal (timetables)', 'warn', `${failureText(p)}. Timetable updates can't be downloaded; the last downloaded data keeps being used.`);
}

export function verdict({ internet, ip, loc, dns, oasa, relays, appStatus }) {
    const ipText = ip ? ` (this server's public IP is ${ip})` : '';
    const abroad = r => Boolean(r.location) && r.location.loc !== 'GR';
    const directResting = appStatus?.routes.find(r => r.name === 'direct')?.resting;

    if (internet.status === 'fail' && oasa.probe.status === null && relays.every(r => r.keyed.status === null)) {
        return { status: 'fail', text: 'The server can\'t reach the internet at all. Nothing in the app can fix this: contact Mediahost support and send them this report.' };
    }
    if (dns.every(d => d.status === 'fail')) {
        return { status: 'fail', text: 'DNS isn\'t working on the server: it can\'t look up any address. Contact Mediahost support.' };
    }
    if (oasa.result.status === 'ok') {
        if (directResting) return { status: 'warn', text: `OASA is reachable again. The app is still resting direct access after earlier failures and will try it again on its own within ${FALLBACK_REST_MS / 60_000} minutes (or restart the app to try now).` };
        return { status: 'ok', text: 'Everything needed for live bus times is working.' };
    }
    if (!relays.length) {
        if (oasa.geo) return { status: 'fail', text: `${GEO_BLOCK}, and this server is in ${loc}, so live times are down. Set up the relay (proxy/README.md) so requests reach OASA from Greece.` };
        return { status: 'fail', text: `OASA can't be reached from this server and there is no relay, so live times are down. Reason: ${oasa.result.detail}. If OASA blocked the server${ipText}, set up the relay (proxy/README.md) and contact OASA.` };
    }
    const working = relays.find(r => r.result.status === 'ok');
    if (working && oasa.geo) {
        return { status: 'ok', text: `${GEO_BLOCK} and this server is in ${loc}, so live times go through the ${working.name}${working.location ? ` (${working.location.colo}, GR)` : ''}. Working as intended.` };
    }
    if (working) {
        return { status: 'warn', text: `OASA can't be reached directly from this server (${oasa.result.detail}), but the ${working.name} works, so the site keeps working. If this lasts, OASA has probably blocked the server${ipText}: contact OASA, or Mediahost if they block outgoing traffic.` };
    }
    // Relays that work but can't reach OASA themselves
    const blocked = relays.filter(r => r.info === 'oasa-from-relay');
    if (blocked.some(r => !abroad(r))) {
        return { status: 'fail', text: `OASA is unreachable both from this server and through the ${blocked.find(r => !abroad(r)).name}, so OASA itself is most likely down. Nothing to fix on our side; live times return when it does.` };
    }
    const broken = relays.find(r => r.info === 'key' || r.info === 'url' || r.info === 'old-worker');
    if (broken) {
        return { status: 'fail', text: `OASA can't be reached directly (${oasa.result.detail}), and the ${broken.name} is misconfigured: ${broken.result.detail}. ${broken.result.hint}` };
    }
    if (blocked.length === relays.length) {
        const where = blocked.map(r => `the ${r.name} runs in ${r.location.colo} (${r.location.loc})`).join(' and ');
        return { status: 'fail', text: `${GEO_BLOCK}. This server is in ${loc ?? 'another country'} and ${where}, so OASA blocks ${relays.length > 1 ? 'all of them' : 'both'} and live times are down. A relay has to reach OASA from Greece: see proxy/README.md, "Home relay".` };
    }
    const down = relays.filter(r => !blocked.includes(r));
    const hint = down.map(r => r.result.hint).find(Boolean)
        ?? 'If the internet check passed, outgoing traffic to them may be blocked: contact Mediahost with this report.';
    return { status: 'fail', text: `Neither OASA (${oasa.result.detail}) nor ${down.map(r => `the ${r.name} (${r.result.detail})`).join(' nor ')} can be reached from this server, so live times are down. ${hint}` };
}

// A relay that OASA blocks from abroad is expected while another relay
// carries the traffic (as from October to November 2026: the Cloudflare
// Worker, with the home relay behind it), so it is reported as information
// rather than a failure
export function expectBlockedRelays(relays) {
    const working = relays.find(r => r.result.status === 'ok');
    if (!working) return;
    for (const r of relays) {
        if (r.info !== 'oasa-from-relay' || !r.location || r.location.loc === 'GR') continue;
        for (const c of r.results.slice(1)) {
            c.status = 'info';
            c.hint = `Expected while OASA's live API accepts only Greek IPs: the ${working.name} carries the traffic.`;
        }
    }
}
