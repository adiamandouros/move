import { test } from 'node:test';
import assert from 'node:assert/strict';
import { elementsOf, fetchAll, fetchOne, QUERIES } from '../scripts/places/fetch.js';

// Asking Overpass: only a whole answer counts, and busy servers are tried again

const whole = JSON.stringify({ elements: [{ type: 'node' }] });
const reply = (body, status = 200) => new Response(body, { status });
const quiet = { wait: async () => {}, log: () => {} };

test('an answer is whole if it has elements and no remark', () => {
    assert.deepEqual(elementsOf(whole), [{ type: 'node' }]);
    assert.equal(elementsOf(JSON.stringify({ elements: [{}], remark: 'runtime error: timed out' })), null);
    assert.equal(elementsOf(JSON.stringify({ elements: [] })), null);
    assert.equal(elementsOf('<html>busy</html>'), null);
});

test('a municipality comes with its members', () => {
    assert.match(QUERIES.municipalities, /;out geom;$/);
});

test('asks for Attica in JSON, says who\'s asking, and stops at the first whole answer', async () => {
    const asked = [];
    const get = async (url, options) => { asked.push({ url, options }); return reply(whole); };
    assert.deepEqual(await fetchOne('streets', { ...quiet, get }), [{ type: 'node' }]);
    assert.equal(asked.length, 1);
    assert.match(asked[0].url, /overpass-api\.de\/api\/interpreter$/);
    assert.match(asked[0].options.headers['user-agent'], /wayhop\.gr/);
    assert.match(asked[0].options.body.get('data'), /^\[out:json\].*GR-I.*way\["highway"\]/);
});

test('a busy server, a bad answer and a dropped connection all move on to the next try', async () => {
    const answers = [() => reply('busy', 429), () => reply('{}'), () => { throw new Error('reset'); }, () => reply(whole)];
    const servers = [];
    let waits = 0;
    const get = async url => { servers.push(new URL(url).host); return answers.shift()(); };
    const elements = await fetchOne('streets', { get, log: () => {}, wait: async () => { waits++; } });
    assert.equal(elements.length, 1);
    assert.equal(new Set(servers).size, 2, 'both servers tried');
    assert.equal(waits, 3);
});

test('gives up in the end, saying what it was fetching', async () => {
    const get = async () => reply('busy', 504);
    await assert.rejects(fetchOne('streets', { ...quiet, get, rounds: 2 }), /streets/);
});

test('fetches each answer in turn', async () => {
    const get = async () => reply(whole);
    assert.deepEqual(Object.keys(await fetchAll({ ...quiet, get })), Object.keys(QUERIES));
});
