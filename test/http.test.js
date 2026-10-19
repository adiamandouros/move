import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sendFresh } from '../server/http.js';

// Sending answers (server/http.js)

test('sendFresh: kept by browsers, but checked with us each time', () => {
    const sent = {};
    const res = {
        set(name, value) { sent[name] = value; return this; },
        type(type) { sent.type = type; return this; },
        send(body) { sent.body = body; return this; },
    };
    assert.equal(sendFresh(res, 'html', '<p>x</p>'), res);
    assert.deepEqual(sent, { 'Cache-Control': 'no-cache', type: 'html', body: '<p>x</p>' });
});
