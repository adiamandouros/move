import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { BROWSER_SHARED } from '../server/pages/layout.js';
import { renderPages } from '../server/pages/index.js';
import { loadTools, stringTables } from '../server/pages/registry.js';

// The strings a page sends its scripts (server/pages/layout.js): its own and
// the shared ones the scripts every page can load use (BROWSER_SHARED), not
// all the shared ones its view used

const ROOT = new URL('..', import.meta.url).pathname;
const tools = loadTools();
const { pages } = renderPages(tools);
const sent = html => JSON.parse(html.match(/<script type="application\/json" id="strings">(.*?)<\/script>/s)[1]);

// Every key the browser's code looks up: t('key') and s('key'), and the start
// of one it builds (t(`location.${problem}`))
function keysLookedUp() {
    const dirs = ['public/js/core', ...tools.map(t => `tools/${t.id}/client`)];
    const code = dirs.flatMap(dir => readdirSync(join(ROOT, dir)).filter(f => f.endsWith('.js')).map(f => readFileSync(join(ROOT, dir, f), 'utf8'))).join('\n');
    return [...code.matchAll(/\b[ts]\((?:'([a-z0-9.-]+)'|`([a-z0-9.-]+)\$\{)/g)].map(m => m[1] ?? m[2]);
}

test('every shared string the browser\'s code looks up is one pages send', () => {
    // The shared tables: the site's own strings and the tools' names; the rest are a page's own
    const [shellStrings, toolNames, ...own] = stringTables(tools);
    const ownKeys = new Set(own.flatMap(table => Object.keys(table.en)));
    const shared = new Set([...Object.keys(shellStrings.en), ...Object.keys(toolNames.en)]);
    // A whole key, or the start of one the code builds ('location.')
    const has = (keys, key) => keys.has(key) || (key.endsWith('.') && [...keys].some(k => k.startsWith(key)));
    const keys = keysLookedUp();
    assert.ok(keys.length > 50, 'found the lookups');
    for (const key of keys) {
        if (has(ownKeys, key)) continue;
        assert.ok(has(shared, key), `${key} isn't a string`);
        assert.match(key, BROWSER_SHARED, `${key} is looked up in the browser but not sent`);
    }
});

test('a page sends its own strings and the shared ones scripts use, in its language', () => {
    const home = sent(pages['/']);
    assert.ok(home['announcements.loading'] && home['shell.offline-ready'] && home['location.denied']);
    // Its view's strings stay in the HTML
    for (const key of ['home.title', 'nav.home', 'menu.about', 'tool.subway.title']) assert.equal(home[key], undefined, key);
    for (const page of Object.values(pages)) {
        for (const key of Object.keys(sent(page))) assert.ok(BROWSER_SHARED.test(key) || !key.match(/^(home|nav|menu|tool|theme|language|install|offline|notfound|error|about|privacy|contact|ads|app)\./), key);
    }
    const buses = sent(pages['/el/buses']);
    assert.ok(Object.keys(buses).some(k => k.startsWith('buses.')), 'the tool\'s own');
    assert.equal(buses['location.try-again'], stringTables(tools)[0].el['location.try-again'], 'in Greek');
});
