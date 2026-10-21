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

test('the metro map: stations that open the directions to them, no arrows or stubs', async () => {
    const { drawMap, subwayLink } = await browserModule('tools/info/client/map.js', 'el');
    const svg = `${drawMap(rail, metroLayout, { id: 'metro-map', colors: rail.lines, link: subwayLink })}`;
    assert.equal(count(svg, /class="map-station[^"]*map-link"/g), Object.keys(rail.stations).length);
    assert.equal(count(svg, /class="map-arrow"/g), 0);
    assert.equal(count(svg, /class="map-stub"/g), 0);
    assert.equal(subwayLink('omonia'), '/el/subway?to=omonia');
    assert.match(svg, /<title>Σύνταγμα<\/title>/);
});

test('the tram map: one-way arrows round the loop, stubs in the metro\'s colours, badges, nothing to open', async () => {
    const { drawMap } = await browserModule('tools/info/client/map.js', 'en');
    const svg = `${drawMap(rail.tram, tramLayout, { id: 'tram-map', colors: { ...rail.lines, ...rail.tram.lines }, link: () => null })}`;
    // 7 hops out along the loop's upper side, 7 back along the lower
    assert.equal(count(svg, /class="map-arrow"/g), 14);
    // Syntagma M2 + M3, Fix, Neos Kosmos, Neo Faliro, Akti Posidonos M1 + M3, Dimarchio
    assert.equal(count(svg, /class="map-stub"/g), 8);
    assert.match(svg, /id="tram-map-stub-akti-poseidonos-M1"[^>]*>\s*<stop offset="0.5" stop-color="#3a833c"/);
    assert.match(svg, /id="tram-map-stub-neos-kosmos-M2"[^>]*>\s*<stop offset="0.5" stop-color="#d43333"/);
    assert.equal(count(svg, /class="map-badge"/g), 4);
    assert.equal(count(svg, /map-link/g), 0);
    // Stops that change to another line are drawn as interchanges: the metro changes, Edem and Pikrodafni
    assert.equal(count(svg, /class="map-station map-interchange"/g), 8);
    // The loop's other side is a path of its own
    assert.equal(count(svg, /class="map-line"/g), 3);
});

test('lists of stops: metro stations are links; tram stops aren\'t, with their changes and the loop\'s other way', async () => {
    const { stationList, subwayLink } = await browserModule('tools/info/client/map.js', 'en');
    const metro = `${stationList(rail, { link: subwayLink })}`;
    assert.match(metro, /<li><a href="\/subway\?to=syntagma">Syntagma<\/a> <span class="station-change">· change to M3<\/span><\/li>/);

    const tram = `${stationList(rail.tram)}`;
    assert.equal(count(tram, /<a /g), 0);
    assert.match(tram, /<li>Syntagma <span class="station-change">· change to M2, M3<\/span><\/li>/);
    assert.match(tram, /<li>Edem <span class="station-change">· change to T7<\/span><\/li>/);
    assert.match(tram, /line-t7">T7<\/span> Akti Posidonos – Asklipiio Voulas<\/h5>/);
    assert.match(tram, /<p class="station-way">Toward Akti Posidonos, trams go back another way: Neo Faliro – Gipedo Karaiskaki – Mikras Asias – Lambraki – Evangelistria – Platia Deligianni – Dimarchio – Akti Posidonos\.<\/p>/);
    // Only T7 goes another way
    assert.equal(count(tram, /station-way/g), 1);
});
