import { test } from 'node:test';
import assert from 'node:assert/strict';
import { browserModule } from './support/browser-modules.js';

// Which way leads the Trip page by OASA's live times (decision 72,
// tools/trip/client/rank.js): what each way costs by the weights on live
// times, compared with a tie (3') to spare. The page's side:
// test/trip-controller.test.js and test/browser/trip-buses.spec.js.

const { leadOf } = await browserModule('tools/trip/client/rank.js');

const MIN = 60;
const way = (key, minutes, live = true, waiting = false) => ({ key, cost: minutes === null ? null : minutes * MIN, live, waiting });

test('the half hour\'s own leads unless another costs a tie (3\') or more less', () => {
    assert.equal(leadOf(way('bus', 40), [way('metro', 38)], null), null, '2\' less');
    assert.equal(leadOf(way('bus', 40), [way('metro', 37)], null), 'metro', '3\' less');
    assert.equal(leadOf(way('bus', 40), [way('metro', 30)], null), 'metro');
});

test('of several a tie or more cheaper, the cheapest leads', () => {
    assert.equal(leadOf(way('bus', 40), [way('a', 35), way('b', 30)], null), 'b');
    assert.equal(leadOf(way('bus', 40), [way('a', 30), way('b', 35)], null), 'a');
});

test('a way whose cost isn\'t known can\'t take the lead, nor lose it', () => {
    assert.equal(leadOf(way('bus', null), [way('metro', 20)], null), null, 'the half hour\'s unknown');
    assert.equal(leadOf(way('bus', 40), [way('metro', null)], null), null, 'the other unknown');
    assert.equal(leadOf(way('bus', 20), [way('metro', null)], 'metro'), 'metro', 'the one leading not timed yet');
});

test('OASA\'s word on one side at least, never the timetable\'s alone on both; a way starting by a bus not answered yet neither leads nor loses the lead', () => {
    assert.equal(leadOf(way('bus', 40, false, true), [way('metro', 30)], null), null, 'the half hour\'s own not answered yet');
    assert.equal(leadOf(way('bus', 40), [way('any bus', 30, false, true)], null), null, 'the other\'s bus from the start not answered');
    assert.equal(leadOf(way('bus', 40), [way('metro', 30, false)], null), 'metro', 'the other on its timetable, OASA having the bus far off');
    assert.equal(leadOf(way('tram', 40, false), [way('bus', 30, false)], null), null, 'both the timetable\'s');
    assert.equal(leadOf(way('tram', 40, false), [way('bus', 30, true)], null), 'bus', 'a way with no bus to ask, the other OASA\'s');
    assert.equal(leadOf(way('bus', 20), [way('metro', 40, false, true)], 'metro'), 'metro', 'the one leading not answered yet');
});

test('once it leads it stays, till another costs a tie or more less, the half hour\'s own too', () => {
    assert.equal(leadOf(way('bus', 29), [way('metro', 31)], 'metro'), 'metro', '2\' isn\'t a tie');
    assert.equal(leadOf(way('bus', 28), [way('metro', 31)], 'metro'), null, 'the half hour\'s own back');
    assert.equal(leadOf(way('bus', 40), [way('metro', 31), way('tram', 27)], 'metro'), 'tram');
});

test('a way that led and isn\'t shown any more: the half hour\'s own, unless another is a tie cheaper', () => {
    assert.equal(leadOf(way('bus', 40), [way('metro', 39)], 'gone'), null);
    assert.equal(leadOf(way('bus', 40), [way('metro', 30)], 'gone'), 'metro');
});
