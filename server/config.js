// Every setting the app takes from its environment (.env, see .env.example),
// read and checked in one place. Only the entry points (server.js, the data
// build's command, scripts/diagnose.js) load .env and call loadConfig();
// everything else is handed the result, so tests pass their own settings
// instead of changing process.env (test/config.test.js checks nothing else
// reads it).
//
// A setting that's given but can't be used is left off and listed in
// `problems`, which server.js logs at startup and /admin/diagnostics shows.

/** @typedef {import('../types/config.js').Config} Config */
/** @typedef {import('../types/config.js').ConfigProblem} ConfigProblem */

// The relays, in the order they're tried after direct access, and the
// settings (<env>_URL and <env>_KEY) that turn each one on. See proxy/README.md.
const RELAYS = [
    { name: 'relay', env: 'OASA_RELAY' },           // Cloudflare Worker
    { name: 'home relay', env: 'OASA_HOME_RELAY' }, // e.g. a Raspberry Pi at home
];

const ADSENSE_CLIENT = /^ca-pub-\d{16}$/;
const ADSENSE_SLOT = /^\d{6,12}$/;
const EMAIL = /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/;
const CSP_MODES = ['report-only', 'enforce'];
// The station-export key is guessed by no one: at least this long
const EXPORT_KEY_MIN = 32;

// What OASA, STASY and the data portal see us as, with the contact address
// so they can reach us instead of blocking the server
/** @param {string | null} [contactEmail] */
export const userAgentFor = contactEmail => `Wayhop (Athens transit web app${contactEmail ? `; ${contactEmail}` : ''})`;

const capital = text => text[0].toUpperCase() + text.slice(1);

/** @param {string} url */
function isHttpUrl(url) {
    try { return ['http:', 'https:'].includes(new URL(url).protocol); } catch { return false; }
}

/** @param {Record<string, string | undefined>} [env] @returns {Config} */
export function loadConfig(env = process.env) {
    const value = name => env[name]?.trim() || '';
    /** @type {ConfigProblem[]} */
    const problems = [];
    const problem = (title, text, hint) => problems.push({ title, text, hint });

    // SITE_URL: the public origin, for canonical links, the sitemap and the
    // redirect from other addresses (canonical-host.js)
    let siteUrl = value('SITE_URL').replace(/\/+$/, '');
    if (siteUrl && (!isHttpUrl(siteUrl) || new URL(siteUrl).pathname !== '/')) {
        problem('Site address', `SITE_URL should be an address like https://wayhop.gr, not "${siteUrl}"`, 'It\'s ignored until it\'s fixed: no canonical links, and other addresses don\'t redirect.');
        siteUrl = '';
    }

    // CONTACT_EMAIL goes into a request header, so it has to be one line
    let contactEmail = value('CONTACT_EMAIL') || null;
    if (contactEmail && !EMAIL.test(contactEmail)) {
        problem('Contact email', `CONTACT_EMAIL should be an email address, not "${contactEmail}"`, 'It\'s left out of requests and the contact page until it\'s fixed.');
        contactEmail = null;
    }

    let cspMode = value('CSP_MODE') || 'report-only';
    if (!CSP_MODES.includes(cspMode)) {
        problem('Content-Security-Policy', `CSP_MODE should be "report-only" or "enforce", not "${cspMode}"`, 'The policy is only reported until it\'s fixed.');
        cspMode = 'report-only';
    }

    // AdSense (server/ads.js): ADSENSE_CLIENT, and ADSENSE_SLOT_<PLACE> per ad unit
    let client = value('ADSENSE_CLIENT') || null;
    if (client && !ADSENSE_CLIENT.test(client)) {
        problem('AdSense', 'ADSENSE_CLIENT should look like ca-pub-1234567890123456', 'Ads are off until it\'s fixed.');
        client = null;
    }
    /** @type {Record<string, string>} */
    const slots = {};
    for (const key of Object.keys(env).filter(k => k.startsWith('ADSENSE_SLOT_')).sort()) {
        const id = value(key);
        if (!id) continue;
        if (!ADSENSE_SLOT.test(id)) problem('AdSense', `${key} should be the ad unit's number (data-ad-slot)`, 'That ad unit is off until it\'s fixed.');
        else if (!client) problem('AdSense', `${key} needs ADSENSE_CLIENT too`, 'That ad unit is off until it\'s fixed.');
        else slots[key.slice('ADSENSE_SLOT_'.length).toLowerCase()] = id;
    }

    // STATION_EXPORT_KEY: lets the nightly workflow (.github/workflows/station-edits.yml)
    // read the station editor's export without logging in, and nothing else
    let exportKey = value('STATION_EXPORT_KEY');
    if (exportKey && exportKey.length < EXPORT_KEY_MIN) {
        problem('Station export key', `STATION_EXPORT_KEY should be at least ${EXPORT_KEY_MIN} characters long`, 'The nightly pull request of station edits can\'t read them until it\'s fixed.');
        exportKey = '';
    }

    // Relays: each needs both its URL and its key
    const relays = [];
    for (const relay of RELAYS) {
        const url = value(`${relay.env}_URL`);
        const key = value(`${relay.env}_KEY`);
        const title = `${capital(relay.name)} fallback`;
        if (url && key && !isHttpUrl(url)) {
            problem(title, `${relay.env}_URL should be an https:// address, so the ${relay.name} is disabled`, `Fix ${relay.env}_URL in .env, then restart the app.`);
        } else if (url && key) {
            relays.push({ ...relay, url, key });
        } else if (url || key) {
            problem(title, `Only ${relay.env}_${url ? 'URL' : 'KEY'} is set, so the ${relay.name} is disabled`, `Set both ${relay.env}_URL and ${relay.env}_KEY in .env, then restart the app.`);
        }
    }

    return Object.freeze({
        port: value('PORT') || 3000,
        siteUrl,
        contactEmail,
        userAgent: userAgentFor(contactEmail),
        adminPassword: env.ADMIN_PASSWORD ?? '',
        exportKey,
        cspMode: /** @type {Config['cspMode']} */ (cspMode),
        adsense: Object.freeze({ client, slots: Object.freeze(slots) }),
        relays,
        problems,
    });
}
