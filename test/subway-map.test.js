import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import { BENDS, DASHED, STATIONS } from '../tools/info/client/map-layout.js';

// Station order per line, from the curated positions (first direction)
const positions = JSON.parse(readFileSync(new URL('../data/curated/positions.json', import.meta.url), 'utf8'));
const lines = Object.fromEntries(Object.entries(positions).map(([line, dirs]) => [line, Object.keys(Object.values(dirs)[0])]));

// Each line as a list of segments [from point, to point], corners included
function segments(ids) {
    const points = ids.flatMap((id, i) => {
        const here = STATIONS[id].slice(0, 2);
        if (i === 0) return [here];
        const bends = BENDS[`${ids[i - 1]}>${id}`] ?? [...(BENDS[`${id}>${ids[i - 1]}`] ?? [])].reverse();
        return [...bends, here];
    });
    return points.slice(1).map((p, i) => [points[i], p]);
}

test('every station on every line has a place on the map, and nothing else does', () => {
    const onLines = new Set(Object.values(lines).flat());
    assert.deepEqual([...onLines].filter(id => !STATIONS[id]), []);
    assert.deepEqual(Object.keys(STATIONS).filter(id => !onLines.has(id)), []);
    for (const [id, [x, y, side]] of Object.entries(STATIONS)) {
        assert.ok(Number.isFinite(x) && Number.isFinite(y), id);
        assert.ok(['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'].includes(side), `${id}: label side "${side}"`);
    }
    for (const [line, [a, b]] of Object.entries(DASHED)) {
        assert.ok(lines[line].includes(a) && lines[line].includes(b), `dashed part of ${line}`);
    }
});

test('lines run horizontally, vertically or at 45°', () => {
    for (const [line, ids] of Object.entries(lines)) {
        for (const [[x1, y1], [x2, y2]] of segments(ids)) {
            const dx = Math.abs(x2 - x1), dy = Math.abs(y2 - y1);
            assert.ok(dx + dy > 0, `${line}: two points at ${x1},${y1}`);
            assert.ok(dx === 0 || dy === 0 || dx === dy, `${line}: ${x1},${y1} → ${x2},${y2} isn't straight or 45°`);
        }
    }
});

test('lines only meet at interchange stations', () => {
    const all = Object.entries(lines).flatMap(([line, ids]) => segments(ids).map(s => ({ line, s })));
    const stationAt = new Set(Object.values(STATIONS).map(([x, y]) => `${x},${y}`));
    const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
    const onSegment = (p, [a, b]) => cross(a, b, p) === 0
        && Math.min(a[0], b[0]) <= p[0] && p[0] <= Math.max(a[0], b[0])
        && Math.min(a[1], b[1]) <= p[1] && p[1] <= Math.max(a[1], b[1]);

    for (let i = 0; i < all.length; i++) {
        for (let j = i + 1; j < all.length; j++) {
            const [{ line: l1, s: s1 }, { line: l2, s: s2 }] = [all[i], all[j]];
            if (l1 === l2) continue;
            const [a, b] = s1, [c, d] = s2;
            const d1 = cross(c, d, a), d2 = cross(c, d, b), d3 = cross(a, b, c), d4 = cross(a, b, d);
            const proper = d1 * d2 < 0 && d3 * d4 < 0;
            // Touching points: endpoints lying on the other segment
            const touches = [a, b].filter(p => onSegment(p, s2)).concat([c, d].filter(p => onSegment(p, s1)));
            assert.ok(!proper, `${l1} and ${l2} cross between stations near ${a} → ${b}`);
            for (const p of touches) assert.ok(stationAt.has(`${p[0]},${p[1]}`), `${l1} and ${l2} touch at ${p}, which isn't a station`);
        }
    }
});
