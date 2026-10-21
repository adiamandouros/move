import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import { browserModule } from './support/browser-modules.js';
import * as metroLayout from '../tools/info/client/map-layout.js';
import * as tramLayout from '../tools/info/client/tram-layout.js';

// What the Info page's maps draw (tools/info/client/map.js), from the browser
// tests' copy of rail.json (real data): the metro's links, the tram's loop
// arrows, metro stubs and line badges, and the lists of stops beside them

const rail = JSON.parse(readFileSync(new URL('./browser/data/rail.json', import.meta.url), 'utf8'));
const count = (html, pattern) => (`${html}`.match(pattern) ?? []).length;

const colors = { ...rail.lines, ...rail.tram.lines };

test('the metro map: stations that open the directions to them, stubs to the tram, no arrows', async () => {
    const { drawMap, subwayLink, tramChanges } = await browserModule('tools/info/client/map.js', 'el');
    const svg = `${drawMap(rail, metroLayout, { id: 'metro-map', colors, link: subwayLink, changes: tramChanges(rail) })}`;
    assert.equal(count(svg, /class="map-station[^"]*map-link"/g), Object.keys(rail.stations).length);
    assert.equal(count(svg, /class="map-arrow"/g), 0);
    // Syntagma, Syggrou Fix and Neos Kosmos to T6; Faliro, Piraeus and Dimotiko Theatro to T7
    assert.equal(count(svg, /class="map-stub"/g), 6);
    assert.equal(count(svg, /class="map-badge line-t6"/g), 3);
    assert.equal(count(svg, /class="map-badge line-t7"/g), 3);
    assert.match(svg, /id="metro-map-stub-faliro-T7"[^>]*>\s*<stop offset="0.5" stop-color="#b6d433"/);
    // Stations that change to the tram are drawn as interchanges too
    assert.match(svg, /class="map-station map-interchange map-link" data-station="neos-kosmos"/);
    assert.match(svg, /class="map-station map-link" data-station="dafni"/);
    assert.equal(subwayLink('omonia'), '/el/subway?to=omonia');
    assert.match(svg, /<title>Σύνταγμα<\/title>/);
    // The ends of the lines are bold, as interchanges are: what directions are called by
    assert.deepEqual(terminalsOf(svg), ['airport', 'anthoupoli', 'dimotiko-theatro', 'doukissis-plakentias', 'elliniko', 'kifisia', 'piraeus']);
});

const terminalsOf = svg => [...`${svg}`.matchAll(/class="map-station[^"]* map-terminal[^"]*" data-station="([^"]+)"/g)].map(m => m[1]).sort();

test('the tram map: one-way arrows round the loop, stubs in the metro\'s colours, badges, nothing to open', async () => {
    const { drawMap } = await browserModule('tools/info/client/map.js', 'en');
    const { metroChanges } = await browserModule('tools/info/client/map.js', 'en');
    const svg = `${drawMap(rail.tram, tramLayout, { id: 'tram-map', colors, link: () => null, changes: metroChanges(rail) })}`;
    // 7 hops out along the loop's upper side, 7 back along the lower
    assert.equal(count(svg, /class="map-arrow"/g), 14);
    // Syntagma M2 + M3, Fix, Neos Kosmos, Neo Faliro, Akti Posidonos M1 + M3, Dimarchio
    assert.equal(count(svg, /class="map-stub"/g), 8);
    assert.match(svg, /id="tram-map-stub-akti-poseidonos-M1"[^>]*>\s*<stop offset="0.5" stop-color="#3a833c"/);
    assert.match(svg, /id="tram-map-stub-neos-kosmos-M2"[^>]*>\s*<stop offset="0.5" stop-color="#d43333"/);
    // The lines' badges at their ends, and one at the end of each stub, in the line's colours
    assert.equal(count(svg, /class="map-badge line-t[67]"/g), 4);
    assert.equal(count(svg, /class="map-badge line-m1"/g), 2);
    assert.equal(count(svg, /class="map-badge line-m2"/g), 3);
    assert.equal(count(svg, /class="map-badge line-m3"/g), 3);
    assert.match(svg, /<g class="map-badge line-m2"><rect [^>]*fill="#d43333"\/><text [^>]*>M2<\/text><\/g>/);
    assert.deepEqual(terminalsOf(svg), ['akti-poseidonos', 'asklipieio-voulas', 'pikrodafni', 'syntagma']);
    assert.equal(count(svg, /map-link/g), 0);
    // Stops that change to another line are drawn as interchanges: the metro changes, Edem and Pikrodafni
    assert.equal(count(svg, /class="map-station map-interchange[ "]/g), 8);
    // The loop's other side is a path of its own
    assert.equal(count(svg, /class="map-line"/g), 3);
});

const STEPS = { n: [0, -1], s: [0, 1], e: [1, 0], w: [-1, 0], ne: [1, -1], nw: [-1, -1], se: [1, 1], sw: [-1, 1] };

test('two stubs at a stop end in their badges in the same order, without crossing', async () => {
    const { drawMap, metroChanges } = await browserModule('tools/info/client/map.js', 'en');
    // Any side a stub may point to
    for (const side of ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw']) {
        const layout = { ...tramLayout, STUBS: { syntagma: side } };
        const svg = `${drawMap(rail.tram, layout, { id: 'tram-map', colors, link: () => null, changes: metroChanges(rail) })}`;
        const stubs = [...svg.matchAll(/id="tram-map-stub-syntagma-(M\d)"[^>]* x2="([-\d.e]+)" y2="([-\d.e]+)"/g)].map(m => ({ line: m[1], x: +m[2], y: +m[3] }));
        const pills = [...svg.matchAll(/<g class="map-badge line-(m\d)"><rect x="([-\d.e]+)" y="([-\d.e]+)"/g)].map(m => ({ line: m[1].toUpperCase(), x: +m[2], y: +m[3] }));
        assert.deepEqual(stubs.map(s => s.line), ['M2', 'M3']);
        assert.deepEqual(pills.map(p => p.line), ['M2', 'M3']);
        // Across the stubs (perpendicular to them), M2's comes first for both, or second for both
        const [dx, dy] = STEPS[side];
        const across = (a, b) => Math.sign(Math.round(((b.x - a.x) * -dy + (b.y - a.y) * dx) * 100));
        assert.notEqual(across(stubs[0], stubs[1]), 0, side);
        assert.equal(across(pills[0], pills[1]), across(stubs[0], stubs[1]), side);
    }
});

test('lists of stops: metro stations are links; tram stops aren\'t, with their changes and the loop\'s other way', async () => {
    const { stationList, subwayLink, tramChanges, metroChanges } = await browserModule('tools/info/client/map.js', 'en');
    const metro = `${stationList(rail, { link: subwayLink, changes: tramChanges(rail) })}`;
    assert.match(metro, /<li><a href="\/subway\?to=syntagma">Syntagma<\/a> <span class="station-change">· change to M3, T6<\/span><\/li>/);
    assert.match(metro, /<li><a href="\/subway\?to=faliro">Faliro<\/a> <span class="station-change">· change to T7<\/span><\/li>/);

    const tram = `${stationList(rail.tram, { changes: metroChanges(rail) })}`;
    assert.equal(count(tram, /<a /g), 0);
    assert.match(tram, /<li>Syntagma <span class="station-change">· change to M2, M3<\/span><\/li>/);
    assert.match(tram, /<li>Edem <span class="station-change">· change to T7<\/span><\/li>/);
    assert.match(tram, /line-t7">T7<\/span> Akti Posidonos – Asklipiio Voulas<\/h5>/);
    assert.match(tram, /<p class="station-way">Toward Akti Posidonos, trams go back another way: Neo Faliro – Gipedo Karaiskaki – Mikras Asias – Lambraki – Evangelistria – Platia Deligianni – Dimarchio – Akti Posidonos\.<\/p>/);
    // Only T7 goes another way
    assert.equal(count(tram, /station-way/g), 1);
});
