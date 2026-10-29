import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'fs';
import { builtinModules } from 'module';
import { dirname, join, relative, resolve } from 'path';
import { fileURLToPath } from 'url';
import { loadConfig } from '../server/config.js';

// The settings (server/config.js): read from the environment in one place,
// tidied, and the ones that can't be used left off and listed as problems

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const texts = config => config.problems.map(p => p.text);

test('with no settings: everything optional is off', () => {
    const config = loadConfig({});
    assert.deepEqual({ ...config, adsense: { ...config.adsense } }, {
        port: 3000,
        siteUrl: '',
        contactEmail: null,
        userAgent: 'Wayhop (Athens transit web app)',
        adminPassword: '',
        exportKey: '',
        cspMode: 'report-only',
        adsense: { client: null, slots: {} },
        relays: [],
        problems: [],
    });
});

test('settings are read and tidied', () => {
    const config = loadConfig({
        PORT: '8080',
        SITE_URL: ' https://wayhop.gr/ ',
        CONTACT_EMAIL: 'hello@wayhop.gr',
        ADMIN_PASSWORD: 'secret',
        STATION_EXPORT_KEY: ' k'.padEnd(40, 'k') + ' ',
        CSP_MODE: 'enforce',
        ADSENSE_CLIENT: 'ca-pub-1234567890123456',
        ADSENSE_SLOT_HOME: '1111111111',
        ADSENSE_SLOT_STATION: '3333333333',
        // In the order they're tried, whatever order they're written in
        OASA_HOME_RELAY_URL: 'https://h.example/', OASA_HOME_RELAY_KEY: 'b',
        OASA_RELAY_URL: 'https://w.example/', OASA_RELAY_KEY: 'a',
    });
    assert.equal(config.port, '8080');
    assert.equal(config.siteUrl, 'https://wayhop.gr');
    assert.equal(config.userAgent, 'Wayhop (Athens transit web app; hello@wayhop.gr)');
    assert.equal(config.adminPassword, 'secret');
    assert.equal(config.exportKey, 'k'.repeat(39));
    assert.equal(config.cspMode, 'enforce');
    assert.deepEqual(config.adsense, { client: 'ca-pub-1234567890123456', slots: { home: '1111111111', station: '3333333333' } });
    assert.deepEqual(config.relays, [
        { name: 'relay', env: 'OASA_RELAY', url: 'https://w.example/', key: 'a' },
        { name: 'home relay', env: 'OASA_HOME_RELAY', url: 'https://h.example/', key: 'b' },
    ]);
    assert.deepEqual(config.problems, []);
});

test('nothing can change the settings once read', () => {
    const config = loadConfig({ ADSENSE_CLIENT: 'ca-pub-1234567890123456' });
    assert.throws(() => { config.siteUrl = 'https://evil.example'; }, TypeError);
    assert.throws(() => { config.adsense.client = null; }, TypeError);
    assert.throws(() => { config.adsense.slots.home = '1'; }, TypeError);
});

test('a public address that isn\'t one is left off', () => {
    for (const url of ['wayhop.gr', 'ftp://wayhop.gr', 'https://wayhop.gr/el', 'https://']) {
        const config = loadConfig({ SITE_URL: url });
        assert.equal(config.siteUrl, '', url);
        assert.match(texts(config)[0], /^SITE_URL should be an address like https:\/\/wayhop\.gr/, url);
    }
});

test('a contact address that isn\'t an email is left out of every request', () => {
    for (const email of ['hello', 'hello@wayhop.gr\r\nX-Injected: 1', 'a b@c.d']) {
        const config = loadConfig({ CONTACT_EMAIL: email });
        assert.equal(config.contactEmail, null, JSON.stringify(email));
        assert.equal(config.userAgent, 'Wayhop (Athens transit web app)');
        assert.equal(config.problems[0].title, 'Contact email');
    }
});

test('an unknown policy mode only reports', () => {
    const config = loadConfig({ CSP_MODE: 'enforced' });
    assert.equal(config.cspMode, 'report-only');
    assert.deepEqual(texts(config), ['CSP_MODE should be "report-only" or "enforce", not "enforced"']);
});

test('AdSense settings that look wrong leave their ads off', () => {
    const config = loadConfig({ ADSENSE_CLIENT: 'pub-123', ADSENSE_SLOT_HOME: 'abc', ADSENSE_SLOT_INFO: '1234567' });
    assert.deepEqual(config.adsense, { client: null, slots: {} });
    assert.deepEqual(texts(config), [
        'ADSENSE_CLIENT should look like ca-pub-1234567890123456',
        "ADSENSE_SLOT_HOME should be the ad unit's number (data-ad-slot)",
        'ADSENSE_SLOT_INFO needs ADSENSE_CLIENT too',
    ]);
    assert.ok(config.problems.every(p => p.title === 'AdSense' && /off until it's fixed/.test(p.hint)));
});

test('a station export key short enough to guess is off', () => {
    const config = loadConfig({ STATION_EXPORT_KEY: 'too-short' });
    assert.equal(config.exportKey, '');
    assert.deepEqual(texts(config), ['STATION_EXPORT_KEY should be at least 32 characters long']);
});

test('a relay with only its address or key, or an address that isn\'t one, is off', () => {
    const half = loadConfig({ OASA_RELAY_URL: 'https://w.example/', OASA_HOME_RELAY_KEY: 'b' });
    assert.deepEqual(half.relays, []);
    assert.deepEqual(half.problems, [
        { title: 'Relay fallback', text: 'Only OASA_RELAY_URL is set, so the relay is disabled', hint: 'Set both OASA_RELAY_URL and OASA_RELAY_KEY in .env, then restart the app.' },
        { title: 'Home relay fallback', text: 'Only OASA_HOME_RELAY_KEY is set, so the home relay is disabled', hint: 'Set both OASA_HOME_RELAY_URL and OASA_HOME_RELAY_KEY in .env, then restart the app.' },
    ]);
    const wrong = loadConfig({ OASA_RELAY_URL: 'relay.example', OASA_RELAY_KEY: 'a' });
    assert.deepEqual(wrong.relays, []);
    assert.match(texts(wrong)[0], /^OASA_RELAY_URL should be an https:\/\/ address/);
});

// ── Guards ──────────────────────────────────────────────────────────────────

const files = dir => readdirSync(dir).flatMap(name => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : path.endsWith('.js') ? [path] : [];
});

test('only server/config.js reads the environment', () => {
    const readers = [join(ROOT, 'server.js'), ...files(join(ROOT, 'server'))]
        .filter(file => relative(ROOT, file) !== join('server', 'config.js'))
        .filter(file => /process\.env/.test(readFileSync(file, 'utf8')))
        .map(file => relative(ROOT, file));
    assert.deepEqual(readers, []);
});

test('the scripts GitHub runs without npm install need nothing from node_modules (the health check, the station edits)', () => {
    const seen = new Set();
    const visit = file => {
        if (seen.has(file)) return;
        seen.add(file);
        const code = readFileSync(file, 'utf8');
        for (const [, spec] of code.matchAll(/^\s*import\s+(?:[^'"]*?\s+from\s+)?['"]([^'"]+)['"]/gm)) {
            if (spec.startsWith('.')) visit(resolve(dirname(file), spec));
            else assert.ok(spec.startsWith('node:') || builtinModules.includes(spec), `${relative(ROOT, file)} imports ${spec}`);
        }
    };
    visit(join(ROOT, 'scripts', 'health-check.js'));
    visit(join(ROOT, 'scripts', 'station-edits.js'));
    assert.ok(seen.size > 1, 'it follows the script\'s imports');
});
