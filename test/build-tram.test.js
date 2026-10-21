import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildTram } from '../server/data/build-tram.js';
import { tramCurated, tramFeed } from './fixtures/gtfs.js';

// The tram network for its map (build-tram.js), from a small feed with a
// one-way loop, a shared stop and a few odd runs (fixtures/gtfs.js, tramFeed)

const metroStations = { b: { lines: ['M9'] } };
const built = () => buildTram({ dir: tramFeed(), tram: tramCurated(), metroStations });

test('each direction is its most common run of stops, and may go another way', async () => {
    const { data } = await built();
    const stops = (line, dir) => data.lines[line].directions[dir].stops.map(s => s.station);
    assert.deepEqual(stops('T1', 'out'), ['p', 'a', 'n', 'c', 'e']);
    assert.deepEqual(stops('T1', 'back'), ['e', 'c', 'n', 'b', 'p']);
    assert.deepEqual(stops('T2', 'up'), ['q', 'e']);
    assert.deepEqual(stops('T2', 'down'), ['e', 'q']);
    assert.deepEqual(data.lines.T1.directions.out.toward, { el: 'Ε', en: 'E' });
    assert.equal(data.lines.T1.color, '#b6d433');
    // The metro line in the feed is left alone
    assert.deepEqual(Object.keys(data.lines), ['T1', 'T2']);
});

test('stops: their lines, where they are, and the metro they change to', async () => {
    const { data } = await built();
    assert.deepEqual(data.stations.e.lines, ['T1', 'T2']);
    assert.deepEqual(data.stations.b.lines, ['T1']);
    // The average of its platforms
    assert.deepEqual(data.stations.c.coords, [37.4, 23.3]);
    assert.deepEqual(data.stations.n.metro, { station: 'b', lines: ['M9'] });
    assert.equal(data.stations.q.metro, undefined);
    assert.equal(data.stations.lonely, undefined);
});

test('warnings: unknown stops, runs to stops a line isn\'t drawn through, stops no tram serves, unknown metro stations', async () => {
    const { warnings } = await built();
    assert.deepEqual(warnings.sort(), [
        'T2/down: 1 trips call at stops the map doesn\'t show for the line: c',
        'tram.json: lonely is not served by any tram',
        'tram.json: q changes to nowhere, which isn\'t a metro station in rail.json',
        'tram.json: tram stops not on the map (add them to a stop\'s "gtfs" list): X9',
    ]);
    // The T1 trams that turn back at C, or end at A on the way out, aren't worth a word
    assert.ok(!warnings.some(w => w.startsWith('T1')));
});

test('a line with no trips in the feed is left out, with a warning', async () => {
    const tram = tramCurated();
    tram.lines.T3 = { name: 'T3', color: '#b6d433', directions: { x: { gtfsDirection: '0', toward: { el: 'Χ', en: 'X' } } } };
    const { data, warnings } = await buildTram({ dir: tramFeed(), tram, metroStations });
    assert.equal(data.lines.T3, undefined);
    assert.ok(warnings.includes('T3/x: no tram trips in the rail feed'));
});
