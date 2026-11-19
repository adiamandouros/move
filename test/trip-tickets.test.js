import { test } from 'node:test';
import assert from 'node:assert/strict';
import { browserModule } from './support/browser-modules.js';

// The rule for answers that come too late on the Trip page (decision 65,
// tools/trip/client/tickets.js): an answer counts only if its ticket is the
// newest of its kind for the current trip. Each test is a case main.js
// meets; the page's side: test/browser/trip.spec.js.

const { tickets } = await browserModule('tools/trip/client/tickets.js');

test('nothing asked: no answer counts', () => {
    const latest = tickets();
    assert.equal(latest.counts('way', 1), false);
    assert.equal(latest.counts('way', undefined), false, 'an answer with no ticket');
});

test('the way shown timed again and again: only the latest timing counts', () => {
    const latest = tickets();
    const first = latest.take('way');
    assert.equal(latest.counts('way', first), true);
    const second = latest.take('way');
    assert.equal(latest.counts('way', first), false, 'overtaken');
    assert.equal(latest.counts('way', second), true);
});

test('each kind on its own: the other ways timed don\'t overtake the way shown\'s timing, nor one stop another', () => {
    const latest = tickets();
    const way = latest.take('way');
    const others = latest.take('others');
    const kallithea = latest.take('stop 240047');
    const syntagma = latest.take('stop 60002');
    for (const [kind, ticket] of [['way', way], ['others', others], ['stop 240047', kallithea], ['stop 60002', syntagma]]) {
        assert.equal(latest.counts(kind, ticket), true, kind);
    }
});

test('the tickets count up across the kinds, so one kind\'s never passes for another\'s', () => {
    const latest = tickets();
    const taken = [latest.take('way'), latest.take('others'), latest.take('search', 'half'), latest.take('way')];
    assert.deepEqual(taken, [1, 2, 3, 4]);
    assert.equal(latest.counts('others', 4), false, 'the way\'s ticket, as the other ways\'');
    assert.equal(latest.counts('way', 2), false, 'the other ways\' ticket, as the way\'s');
});

test('a trip searched with its half hour, then again for a later time without it: the half hour still counts, the first search doesn\'t', () => {
    const latest = tickets();
    const first = latest.take('search', 'half');
    assert.equal(latest.counts('search', first), true);
    assert.equal(latest.counts('half', first), true);
    const later = latest.take('search');
    assert.equal(latest.counts('search', first), false);
    assert.equal(latest.counts('search', later), true);
    assert.equal(latest.counts('half', first), true, 'its half hour, still being worked out');
    assert.equal(latest.counts('half', later), false, 'not asked for a half hour');
    // Its half hour old enough to be worked out again
    const rework = latest.take('search', 'half');
    assert.equal(latest.counts('half', first), false);
    assert.equal(latest.counts('half', rework), true);
});

test('planned again from where the rider moved to: the way\'s and the other ways\' timing still to come dropped, the stops\' answers not', () => {
    const latest = tickets();
    const way = latest.take('way');
    const others = latest.take('others');
    const stop = latest.take('stop 240047');
    latest.drop('way', 'others');
    assert.equal(latest.counts('way', way), false);
    assert.equal(latest.counts('others', others), false);
    assert.equal(latest.counts('stop 240047', stop), true);
    // The new way timed counts again
    assert.equal(latest.counts('way', latest.take('way')), true);
});

test('a new trip: nothing asked before it counts, of any kind; what\'s asked after does', () => {
    const latest = tickets();
    const trip = latest.take('search', 'half');
    const before = [['search', trip], ['half', trip], ['way', latest.take('way')], ['others', latest.take('others')], ['stop 240047', latest.take('stop 240047')]];
    latest.newTrip();
    for (const [kind, ticket] of before) assert.equal(latest.counts(kind, ticket), false, kind);
    const search = latest.take('search', 'half');
    const stop = latest.take('stop 240047');
    assert.equal(latest.counts('search', search), true);
    assert.equal(latest.counts('half', search), true);
    assert.equal(latest.counts('stop 240047', stop), true, 'the same stop asked for the new trip');
});
