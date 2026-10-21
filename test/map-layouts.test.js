import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import * as metro from '../tools/info/client/map-layout.js';
import * as tram from '../tools/info/client/tram-layout.js';

// The schematic maps' layouts (map-layout.js, tram-layout.js): every stop
// has a place, lines run straight or at 45°, and lines only meet at stops.
// Each line is checked through every stop each of its directions calls at.

const json = path => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));
// The metro's stations in order, from the curated positions; the tram's from
// the browser tests' copy of rail.json (real data), both ways round T7's loop
const positions = json('../data/curated/positions.json');
const rail = json('./browser/data/rail.json');
const MAPS = {
    metro: { layout: metro, lines: Object.fromEntries(Object.entries(positions).map(([line, dirs]) => [line, Object.values(dirs).map(d => Object.keys(d))])) },
    tram: { layout: tram, lines: Object.fromEntries(Object.entries(rail.tram.lines).map(([line, l]) => [line, Object.values(l.directions).map(d => d.stops.map(s => s.station))])) },
};

// A run of stops as a list of segments [from point, to point], corners included
function segments({ STATIONS, BENDS = {} }, ids) {
    const points = ids.flatMap((id, i) => {
        const here = STATIONS[id].slice(0, 2);
        if (i === 0) return [here];
        const bends = BENDS[`${ids[i - 1]}>${id}`] ?? [...(BENDS[`${id}>${ids[i - 1]}`] ?? [])].reverse();
        return [...bends, here];
    });
    return points.slice(1).map((p, i) => [points[i], p]);
}

for (const [name, { layout, lines }] of Object.entries(MAPS)) {
    const { STATIONS, DASHED = {}, STUBS = {}, BADGES = {} } = layout;
    const runs = Object.entries(lines).flatMap(([line, dirs]) => dirs.map(ids => ({ line, ids })));

    test(`${name} map: every stop on every line has a place, and nothing else does`, () => {
        const onLines = new Set(runs.flatMap(r => r.ids));
        assert.deepEqual([...onLines].filter(id => !STATIONS[id]), []);
        assert.deepEqual(Object.keys(STATIONS).filter(id => !onLines.has(id)), []);
        for (const [id, [x, y, side]] of Object.entries(STATIONS)) {
            assert.ok(Number.isFinite(x) && Number.isFinite(y), id);
            assert.ok(['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'].includes(side), `${id}: label side "${side}"`);
        }
        for (const [line, [a, b]] of Object.entries(DASHED)) {
            assert.ok(lines[line].flat().includes(a) && lines[line].flat().includes(b), `dashed part of ${line}`);
        }
        for (const line of Object.keys(BADGES)) assert.ok(lines[line], `badge for ${line}, which isn't on the map`);
    });

    test(`${name} map: lines run horizontally, vertically or at 45°`, () => {
        for (const { line, ids } of runs) {
            for (const [[x1, y1], [x2, y2]] of segments(layout, ids)) {
                const dx = Math.abs(x2 - x1), dy = Math.abs(y2 - y1);
                assert.ok(dx + dy > 0, `${line}: two points at ${x1},${y1}`);
                assert.ok(dx === 0 || dy === 0 || dx === dy, `${line}: ${x1},${y1} → ${x2},${y2} isn't straight or 45°`);
            }
        }
    });

    test(`${name} map: lines only meet at stops they share`, () => {
        const all = runs.flatMap(({ line, ids }) => segments(layout, ids).map(s => ({ line, s })));
        const stationAt = new Set(Object.values(STATIONS).map(([x, y]) => `${x},${y}`));
        const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
        const onSegment = (p, [a, b]) => cross(a, b, p) === 0
            && Math.min(a[0], b[0]) <= p[0] && p[0] <= Math.max(a[0], b[0])
            && Math.min(a[1], b[1]) <= p[1] && p[1] <= Math.max(a[1], b[1]);
        const same = ([a, b], [c, d]) => (`${a}` === `${c}` && `${b}` === `${d}`) || (`${a}` === `${d}` && `${b}` === `${c}`);

        for (let i = 0; i < all.length; i++) {
            for (let j = i + 1; j < all.length; j++) {
                const [{ line: l1, s: s1 }, { line: l2, s: s2 }] = [all[i], all[j]];
                // A line's own directions, and two lines on the same track between two stops (T6 and T7 to Pikrodafni)
                if (l1 === l2 || same(s1, s2)) continue;
                const [a, b] = s1, [c, d] = s2;
                const d1 = cross(c, d, a), d2 = cross(c, d, b), d3 = cross(a, b, c), d4 = cross(a, b, d);
                const proper = d1 * d2 < 0 && d3 * d4 < 0;
                // Touching points: endpoints lying on the other segment
                const touches = [a, b].filter(p => onSegment(p, s2)).concat([c, d].filter(p => onSegment(p, s1)));
                assert.ok(!proper, `${l1} and ${l2} cross between stops near ${a} → ${b}`);
                for (const p of touches) assert.ok(stationAt.has(`${p[0]},${p[1]}`), `${l1} and ${l2} touch at ${p}, which isn't a stop`);
            }
        }
    });

    test(`${name} map: stubs to the other network at every stop that changes to it, and nowhere else`, () => {
        // tram.json's tram stops with a metro station, and those metro stations
        const pairs = Object.entries(json('../data/curated/tram.json').stops).filter(([, s]) => s.metro);
        const changes = name === 'metro' ? pairs.map(([, s]) => s.metro) : pairs.map(([id]) => id);
        assert.deepEqual(Object.keys(STUBS).sort(), [...new Set(changes)].sort());
        for (const side of Object.values(STUBS)) assert.ok(['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'].includes(side), side);
    });
}
