import { test } from 'node:test';
import assert from 'node:assert/strict';
import { browserModule } from './support/browser-modules.js';

// The starred stations, bus stops and bus lines (public/js/core/favourites.js),
// kept on the device, and the star that adds and removes them. The browser
// tests (test/browser/favourites.spec.js) tap it on the pages.

// localStorage of its own, or one that throws, as when it's blocked
function storage(t, { blocked = false } = {}) {
    const stored = new Map();
    const refuse = () => { throw new Error('blocked'); };
    const before = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
    Object.defineProperty(globalThis, 'localStorage', {
        configurable: true, writable: true,
        value: blocked ? { getItem: refuse, setItem: refuse } : {
            getItem: key => stored.get(key) ?? null,
            setItem: (key, value) => stored.set(key, String(value)),
        },
    });
    t.after(() => before ? Object.defineProperty(globalThis, 'localStorage', before) : delete globalThis.localStorage);
    return stored;
}

const module = () => browserModule('public/js/core/favourites.js');

test('starring adds to the front of its kind, starring again removes', async t => {
    storage(t);
    const { favourites, isFavourite, lineFavourite, toggleFavourite } = await module();
    assert.deepEqual(favourites(), { station: [], stop: [], line: [] });
    assert.equal(toggleFavourite('station', 'syntagma'), true);
    assert.equal(toggleFavourite('station', 'airport'), true);
    assert.equal(toggleFavourite('stop', '10341'), true);
    assert.equal(toggleFavourite('line', lineFavourite('040', 1)), true);
    assert.deepEqual(favourites(), { station: ['airport', 'syntagma'], stop: ['10341'], line: ['040/1'] });
    assert.ok(isFavourite('station', 'syntagma') && !isFavourite('stop', 'syntagma'), 'per kind');
    assert.ok(!isFavourite('line', '040/0'), 'a line is starred in one direction');
    assert.equal(toggleFavourite('station', 'syntagma'), false);
    assert.deepEqual(favourites().station, ['airport']);
});

test('anything else saved under the name counts as none; unknown kinds are ignored', async t => {
    const stored = storage(t);
    const { favourites, isFavourite, toggleFavourite } = await module();
    for (const saved of ['not json', '[1,2]', '"syntagma"', 'null', '{"station":"syntagma"}']) {
        stored.set('favourites', saved);
        assert.deepEqual(favourites(), { station: [], stop: [], line: [] }, saved);
    }
    stored.set('favourites', '{"station":["syntagma",3,null],"stop":{}}');
    assert.deepEqual(favourites(), { station: ['syntagma'], stop: [], line: [] });
    assert.equal(toggleFavourite(/** @type {any} */ ('trip'), 'x'), false);
    assert.equal(isFavourite(/** @type {any} */ ('trip'), 'x'), false);
    assert.equal(isFavourite(/** @type {any} */ ('constructor'), 'x'), false);
});

test('without storage nothing is starred, and nothing breaks', async t => {
    storage(t, { blocked: true });
    const { favourites, toggleFavourite } = await module();
    assert.doesNotThrow(() => toggleFavourite('station', 'syntagma'));
    assert.deepEqual(favourites(), { station: [], stop: [], line: [] });
});

test('the star: a toggle button that says what it stars, outline when off and filled when on', async () => {
    const { favouriteButton } = await module();
    const off = String(favouriteButton({ kind: 'stop', key: '10341', label: 'Favourite: SYNTAGMA 10341' }));
    assert.match(off, /^<button type="button" class="favourite-btn" data-favourite="stop" data-key="10341" aria-pressed="false">/);
    assert.match(off, /#favourite"><\/use>/);
    assert.match(off, /<span class="sr-only">Favourite: SYNTAGMA 10341<\/span><\/button>$/);
    const on = String(favouriteButton({ kind: 'station', key: 'syntagma', on: true, text: 'Favourite', cls: 'btn', hidden: true }));
    assert.match(on, /class="favourite-btn btn" data-favourite="station" data-key="syntagma" aria-pressed="true" hidden>/);
    assert.match(on, /#favourite-filled"><\/use><\/svg><span>Favourite<\/span><\/button>$/);
    assert.match(String(favouriteButton({ kind: 'stop', key: '"><x>' })), /data-key="&quot;&gt;&lt;x&gt;"/, 'escaped');
});
