import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gzipSync, gunzipSync } from 'zlib';
import { buildIndex } from '../scripts/places/build.js';
import { countsOf, problemsWith } from '../scripts/places/check.js';
import { makeIndex, publishedCounts } from '../scripts/places/index.js';
import { raw, rail } from './fixtures/places.js';

// Only a good index goes out: a bad week of data stops before the live site

const { index } = buildIndex(raw, rail);
const fits = { floors: { towns: 2, streets: 5, numbers: 5, places: 4 }, answers: [], notThere: [] };
const answer = { query: 'Μενελάου 45, Καλλιθέα', town: 'Καλλιθέας', at: [37.955, 23.707] };

test('counts what the index holds', () => {
    assert.deepEqual(countsOf(index), { towns: 2, streets: 10, numbers: 18, places: 5 });
});

test('a good index has no problems', () => {
    assert.deepEqual(problemsWith(index, { ...fits, answers: [answer], notThere: ['Μενελάου 25, Νέας Σμύρνης'] }), []);
});

test('the real floors stop an index that came out small', () => {
    assert.equal(problemsWith(index, { answers: [], notThere: [] }).length, 4);
});

test('losing a tenth since last week stops it, losing a little doesn\'t', () => {
    const previous = countsOf(index);
    assert.match(problemsWith(index, { ...fits, previous: { ...previous, streets: previous.streets * 2 } })[0], /^streets: 10, down from 20/);
    assert.deepEqual(problemsWith(index, { ...fits, previous: { ...previous, numbers: 19 } }), []);
});

test('an answer that went missing or moved stops it', () => {
    const problems = answers => problemsWith(index, { ...fits, answers });
    assert.match(problems([{ ...answer, query: 'Ανύπαρκτη 1' }])[0], /no answer/);
    assert.match(problems([{ ...answer, town: 'Νέας Σμύρνης' }])[0], /in Καλλιθέας, not Νέας Σμύρνης/);
    assert.match(problems([{ ...answer, at: [37.975, 23.707] }])[0], /\d+ m away/);
});

test('a street in the wrong town stops it', () => {
    assert.match(problemsWith(index, { ...fits, notThere: ['Μενελάου 25, Καλλιθέα'] })[0], /isn't in that town/);
});

const site = published => async url => {
    if (url.endsWith('rail.json')) return Response.json(rail);
    return published ? new Response(gzipSync(JSON.stringify(published))) : new Response('', { status: 404 });
};
const quiet = { log: () => {} };

test('the first index has nothing to be compared with', async () => {
    assert.equal(await publishedCounts(site(null)), null);
});

test('a published index that can\'t be read stops the build', async () => {
    await assert.rejects(publishedCounts(async () => new Response('', { status: 500 })), /500/);
});

test('makes the compressed index, with the stations from the live site', async () => {
    const file = await makeIndex({ ...quiet, get: site(index), raw, checks: fits });
    const made = JSON.parse(gunzipSync(file).toString());
    assert.equal(made.streets.length, index.streets.length);
    assert.ok(made.places.some(place => place[2] === 'metro'));
});

test('an index with problems isn\'t made, and the error lists them', async () => {
    await assert.rejects(makeIndex({ ...quiet, get: site(index), raw }), /isn't good enough:\ntowns: 2, the least expected is 60/);
});

test('without the stations there\'s no index', async () => {
    const get = async () => new Response('', { status: 503 });
    await assert.rejects(makeIndex({ ...quiet, get, raw, checks: fits }), /rail\.json: 503/);
});
