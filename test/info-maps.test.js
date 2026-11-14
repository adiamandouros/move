import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import { browserModule } from './support/browser-modules.js';
import { bareLineProblems } from './support/markup.js';
import * as metroLayout from '../tools/info/client/map-layout.js';
import * as tramLayout from '../tools/info/client/tram-layout.js';
import * as suburbanLayout from '../tools/info/client/suburban-layout.js';

// What the Info page's maps draw (tools/info/client/map.js), from the browser
// tests' copies of rail.json and trains.json (real data): the metro's links,
// the tram's loop arrows, metro stubs and line badges, the railway's lines
// side by side and where they go on, and the lists of stops beside them

const rail = JSON.parse(readFileSync(new URL('./browser/data/rail.json', import.meta.url), 'utf8'));
const trains = JSON.parse(readFileSync(new URL('./browser/data/trains.json', import.meta.url), 'utf8'));
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
    assert.match(metro, /<li><a href="\/subway\?to=syntagma">Syntagma<\/a> <span class="station-change">· change to <span class="line-pill pill-s line-m3">M3<\/span><span class="sr-only">,<\/span> <span class="line-pill pill-s line-t6">T6<\/span><\/span><\/li>/);
    assert.match(metro, /<li><a href="\/subway\?to=faliro">Faliro<\/a> <span class="station-change">· change to <span class="line-pill pill-s line-t7">T7<\/span><\/span><\/li>/);

    const tram = `${stationList(rail.tram, { changes: metroChanges(rail) })}`;
    assert.equal(count(tram, /<a /g), 0);
    assert.match(tram, /<li>Syntagma <span class="station-change">· change to <span class="line-pill pill-s line-m2">M2<\/span><span class="sr-only">,<\/span> <span class="line-pill pill-s line-m3">M3<\/span><\/span><\/li>/);
    assert.match(tram, /<li>Edem <span class="station-change">· change to <span class="line-pill pill-s line-t7">T7<\/span><\/span><\/li>/);
    assert.match(tram, /pill-m line-t7">T7<\/span> Akti Posidonos – Asklipiio Voulas<\/h5>/);
    assert.match(tram, /<p class="station-way">Toward Akti Posidonos, trams go back another way: Neo Faliro – Gipedo Karaiskaki – Mikras Asias – Lambraki – Evangelistria – Platia Deligianni – Dimarchio – Akti Posidonos\.<\/p>/);
    // Only T7 goes another way
    assert.equal(count(tram, /station-way/g), 1);
    // Every line in them is its pill
    assert.deepEqual([...bareLineProblems(metro), ...bareLineProblems(tram)], []);
});

// A path's points, as [x, y]
const pointsOf = d => [...d.matchAll(/[ML]([-\d.e]+) ([-\d.e]+)/g)].map(m => [Math.round(+m[1] * 10) / 10, Math.round(+m[2] * 10) / 10]);
const lineOf = (svg, color) => pointsOf(`${svg}`.match(new RegExp(`<path class="map-line" d="([^"]+)" stroke="${color}"`))[1]);

test('the suburban railway map: the city\'s stations and the Airport, side by side on shared track, arrows where lines go on (decision 54)', async () => {
    const { drawMap, suburbanNetwork, suburbanLink, metroChangesOfRailway, suburbanWalks, allColors } = await browserModule('tools/info/client/map.js', 'el');
    const network = suburbanNetwork(trains);
    // Each line's longest ways, both ways round, A1's from the Airport first (the way LANES follow)
    assert.deepEqual(Object.keys(network.lines.A1.directions), ['piraeus-0', 'airport-1']);
    assert.deepEqual(Object.keys(network.lines.A3.directions), ['chalkida-0', 'athens-1']);
    assert.equal(network.lines.A2.color, '#753bbd');
    const svg = `${drawMap(network, suburbanLayout, { id: 'suburban-map', colors: allColors(rail, trains), link: suburbanLink(rail), changes: metroChangesOfRailway(rail, trains), walks: suburbanWalks(trains) })}`;

    // 25 stations, each opening the subway page with it as the destination, by the id the planner gives it
    assert.equal(count(svg, /class="map-station[^"]*map-link"/g), 25);
    assert.doesNotMatch(svg, /data-station="megara"/);
    assert.equal(suburbanLink(rail)('piraeus'), '/el/subway?to=piraeus-suburban');
    assert.equal(suburbanLink(rail)('ska'), '/el/subway?to=ska');

    // Into Athens from Agioi Anargyroi (44 px a unit): A3 to the east of A1, A4 to the west, 11 px apart
    assert.ok(lineOf(svg, '#ffcd00').some(([x, y]) => x === 0 && y === 0));
    assert.deepEqual(lineOf(svg, '#78be20').slice(0, 2), [[11, 0], [11, -88]]);
    assert.ok(lineOf(svg, '#00a3e0').some(([x, y]) => x === -11 && y === 0));
    // From Athens to Piraeus, A1 and A4 only: each 5.5 px off the middle, across the line (south-east and north-west)
    const off = 5.5 * Math.SQRT1_2;
    const near = (points, [x, y]) => points.some(([px, py]) => Math.abs(px - x) < 0.2 && Math.abs(py - y) < 0.2);
    assert.ok(near(lineOf(svg, '#ffcd00'), [-176 + off, 176 + off]), 'A1 south-east of Lefka');
    assert.ok(near(lineOf(svg, '#00a3e0'), [-176 - off, 176 - off]), 'A4 north-west of Lefka');
    // A station on lines side by side is a bar across them; one on a line of its own a dot in its colour
    assert.match(svg, /data-station="lefka">\s*<title>Λεύκα<\/title>\s*<path class="map-capsule-edge"/);
    assert.match(svg, /data-station="zefyri">\s*<title>[^<]+<\/title>\s*<circle [^>]*r="6" stroke="#00a3e0"\/>/);

    // A3 goes on to Chalkida past SKA, A4 to Kiato past Magoula
    assert.deepEqual([...svg.matchAll(/class="map-beyond-name"><text [^>]*>([^<]+)/g)].map(m => m[1]), ['προς Χαλκίδα', 'προς Κιάτο']);
    assert.match(svg, /id="suburban-map-beyond-magoula-A4"/);
    // SKA's two stations a footbridge apart, the A3 one without a name of its own
    assert.equal(count(svg, /class="map-walk"/g), 1);
    const skaA3 = svg.match(/<g [^>]*data-station="ska-a3">.*?<\/g>/s)[0];
    assert.match(skaA3, /<circle /);
    assert.doesNotMatch(skaA3, /<text/);
    // Stubs to the metro at its 8 walks: Piraeus M1 and M3, Athens to Larissa Station's M2, M3 at the A1/A2 stations
    assert.deepEqual([...svg.matchAll(/id="suburban-map-stub-([^"]+)"/g)].map(m => m[1]),
        ['piraeus-M1', 'piraeus-M3', 'athens-M2', 'nerantziotissa-M1', 'doukissis-plakentias-M3', 'pallini-M3', 'paiania-kantza-M3', 'koropi-M3', 'airport-M3']);
    assert.deepEqual(terminalsOf(svg), ['airport', 'ano-liosia', 'athens', 'piraeus']);
    // A badge beside each line
    for (const line of ['a1', 'a2', 'a3', 'a4']) assert.equal(count(svg, new RegExp(`class="map-badge line-${line}"`, 'g')), 1, line);
});

test('the metro map with the railway: its stubs at the walks to it, after the tram\'s; without trains.json, the tram\'s only', async () => {
    const { drawMap, subwayLink, metroStationChanges, allColors } = await browserModule('tools/info/client/map.js', 'en');
    const svg = `${drawMap(rail, metroLayout, { id: 'metro-map', colors: allColors(rail, trains), link: subwayLink, changes: metroStationChanges(rail, trains) })}`;
    const stubs = [...svg.matchAll(/id="metro-map-stub-([^"]+)"/g)].map(m => m[1]);
    assert.deepEqual(stubs.filter(id => id.startsWith('piraeus-')), ['piraeus-T7', 'piraeus-A1', 'piraeus-A4']);
    assert.deepEqual(stubs.filter(id => id.startsWith('larissa-station-')), ['larissa-station-A1', 'larissa-station-A3', 'larissa-station-A4']);
    assert.deepEqual(stubs.filter(id => id.startsWith('airport-')), ['airport-A1', 'airport-A2']);
    assert.equal(stubs.length, 23);
    assert.match(svg, /<g class="map-badge line-a2"><rect [^>]*fill="#753bbd"\/>/);
    // Larissa Station, on the stubs' side, is named past their badges
    assert.match(svg, /class="map-station map-interchange map-link" data-station="larissa-station">\s*<title>[^<]+<\/title>\s*<circle cx="-132" cy="-176"[^>]*\/>\s*<text x="(-[\d.]+)"/);
    const labelX = +svg.match(/data-station="larissa-station">[^]*?<text x="(-[\d.]+)"/)[1];
    assert.ok(labelX < -132 - 1.1 * 44, `${labelX}`);

    const without = `${drawMap(rail, metroLayout, { id: 'metro-map', colors: allColors(rail, null), link: subwayLink, changes: metroStationChanges(rail, null) })}`;
    assert.equal(count(without, /class="map-stub"/g), 6);
});

test('the railway\'s list: only the stations on its map, as links, with their changes, then where the trains go on', async () => {
    const { stationList, suburbanNetwork, suburbanLink, metroChangesOfRailway } = await browserModule('tools/info/client/map.js', 'en');
    const list = `${stationList(suburbanNetwork(trains), { link: suburbanLink(rail), changes: metroChangesOfRailway(rail, trains), shown: id => !!suburbanLayout.STATIONS[id] })}`;
    // A1 19, A2 12, A3 3, A4 13
    assert.equal(count(list, /<li>/g), 47);
    assert.equal(count(list, /<a href=/g), 47);
    assert.match(list, /pill-m line-a4">A4<\/span> Kiato – Piraeus<\/h5>/);
    assert.match(list, /<li><a href="\/subway\?to=athens">Athens<\/a> <span class="station-change">· change to <span class="line-pill pill-s line-a1">A1<\/span><span class="sr-only">,<\/span> <span class="line-pill pill-s line-a3">A3<\/span><span class="sr-only">,<\/span> <span class="line-pill pill-s line-m2">M2<\/span><\/span><\/li>/);
    assert.doesNotMatch(list, /Megara/);
    assert.deepEqual([...list.matchAll(/<p class="station-way">([^<]+)<\/p>/g)].map(m => m[1]), ['Trains go on to Chalkida, outside the city.', 'Trains go on to Kiato, outside the city.']);
    assert.deepEqual(bareLineProblems(list), []);
});
