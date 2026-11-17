import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cancelledFetch } from './browser/fixtures.js';

// What the browser tests' fixtures (test/browser/fixtures.js) don't take for a
// script error. A real browser can't be made to show it on cue: it's a race
// with the next page, seen on CI's iPhone.

const PAGE = 'http://localhost:3457/buses?stop=99999999';
// A page error as Playwright hands on WebKit's message, split at its first colon
const pageError = text => {
    const at = text.indexOf(':');
    return { name: text.slice(0, at), message: text.slice(at + 2) };
};

test('a fetch to the site cut off by leaving the page is WebKit\'s, not the page\'s', () => {
    // As it made "an unknown stop or line says so" flaky
    assert.equal(cancelledFetch(pageError('Fetch API cannot load http://localhost:3457/data/buses.json due to access control checks.'), PAGE), true);
});

test('anything else is still a script error', () => {
    // Another site's: a real cross-origin failure
    assert.equal(cancelledFetch(pageError('Fetch API cannot load https://example.com/data.json due to access control checks.'), PAGE), false);
    assert.equal(cancelledFetch(pageError('TypeError: undefined is not an object'), PAGE), false);
    assert.equal(cancelledFetch(pageError('Fetch API cannot load http://localhost:3457/data/buses.json due to something else.'), PAGE), false);
});
