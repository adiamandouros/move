import { test } from 'node:test';
import assert from 'node:assert/strict';
import { browserModule } from './support/browser-modules.js';

// The tools open where they were left (public/js/core/remember.js): what's
// kept for the tab, and where the links to the tools go. The browser tests
// (test/browser/remember.spec.js) go through it on the pages.

// A browser of its own: sessionStorage (or one that throws, as when it's
// blocked), the page's address and its links to the tools
function browser(t, { blocked = false, pathname = '/info', links = [] } = {}) {
    const stored = new Map();
    const refuse = () => { throw new Error('blocked'); };
    const env = {
        sessionStorage: blocked ? { getItem: refuse, setItem: refuse, removeItem: refuse } : {
            getItem: key => stored.get(key) ?? null,
            setItem: (key, value) => stored.set(key, String(value)),
            removeItem: key => stored.delete(key),
        },
        location: { pathname },
        document: { querySelectorAll: () => links },
    };
    for (const [name, value] of Object.entries(env)) {
        const before = Object.getOwnPropertyDescriptor(globalThis, name);
        Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
        t.after(() => before ? Object.defineProperty(globalThis, name, before) : delete globalThis[name]);
    }
    return stored;
}

const link = (tool, pathname) => ({ dataset: { tool }, pathname, href: pathname });

test('a tool’s choices are kept as its query, and none forget them', async t => {
    const stored = browser(t);
    const { remember, rememberedHref } = await browserModule('public/js/core/remember.js');
    assert.equal(rememberedHref('subway', '/subway'), '/subway');
    remember('subway', 'from=syntagma&to=airport');
    remember('buses', '?stop=10341');
    assert.equal(rememberedHref('subway', '/subway'), '/subway?from=syntagma&to=airport');
    assert.equal(rememberedHref('buses', '/el/buses'), '/el/buses?stop=10341', 'shared by both languages');
    remember('buses', '');
    remember('subway', '?');
    assert.deepEqual([...stored], []);
});

test('the links to the tools go back to them, except the one to this page', async t => {
    const subway = link('subway', '/el/subway');
    const buses = link('buses', '/el/buses');
    browser(t, { pathname: '/el/buses', links: [subway, buses] });
    const { remember, restoreLinks } = await browserModule('public/js/core/remember.js', 'el');
    remember('subway', 'to=airport');
    remember('buses', 'line=040&dir=1');
    restoreLinks();
    assert.equal(subway.href, '/el/subway?to=airport');
    assert.equal(buses.href, '/el/buses', 'tapping the tool you’re on starts it over');

    // Brought back later, after the subway was started over
    remember('subway', '');
    restoreLinks();
    assert.equal(subway.href, '/el/subway');
});

test('without storage the tools just start over', async t => {
    const subway = link('subway', '/subway');
    browser(t, { blocked: true, links: [subway] });
    const { remember, restoreLinks } = await browserModule('public/js/core/remember.js');
    assert.doesNotThrow(() => remember('subway', 'to=airport'));
    assert.doesNotThrow(() => remember('subway', ''));
    restoreLinks();
    assert.equal(subway.href, '/subway');
});
