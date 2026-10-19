// Refreshes the browser tests' data from the real build (data/build/, made by
// `npm run build:data`). Run it when rail.json's, bus-stops.json's or
// bus-lines.json's format changes, then check the tests still pass and commit
// the result:
//   node test/browser/data/update.js
//
// rail.json is copied whole (the real network, so tests can plan real
// routes). bus-stops.json keeps only the stops around Syntagma and Omonia,
// where the tests stand, to stay small, plus every stop of the few lines
// bus-lines.json keeps (LINES), so their whole routes can be looked up.
import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const BUILD = join(HERE, '..', '..', '..', 'data', 'build');
const AROUND = [[37.9755, 23.7348], [37.9842, 23.7281]]; // Syntagma, Omonia
const RADIUS_M = 1200;
// The 040 and the Χ95 both stop at Syntagma; the Χ95 also has a Latin look-alike name ("X95")
const LINES = ['040', 'Χ95'];

const metres = ([lat1, lng1], [lat2, lng2]) => {
    const rad = Math.PI / 180;
    const x = (lng2 - lng1) * rad * Math.cos((lat1 + lat2) / 2 * rad);
    return Math.hypot(x, (lat2 - lat1) * rad) * 6_371_000;
};

const rail = JSON.parse(readFileSync(join(BUILD, 'rail.json'), 'utf8'));
writeFileSync(join(HERE, 'rail.json'), JSON.stringify(rail));

const bus = JSON.parse(readFileSync(join(BUILD, 'bus-stops.json'), 'utf8'));
const lat = bus.fields.indexOf('lat'), lng = bus.fields.indexOf('lng');
const lines = JSON.parse(readFileSync(join(BUILD, 'bus-lines.json'), 'utf8'));
lines.lines = lines.lines.filter(l => LINES.includes(l.line));
const onLines = new Set(lines.lines.flatMap(l => l.directions.flatMap(d => d.stops)));
const code = bus.fields.indexOf('code');
bus.stops = bus.stops.filter(s => onLines.has(s[code]) || AROUND.some(p => metres(p, [s[lat], s[lng]]) <= RADIUS_M));
writeFileSync(join(HERE, 'bus-stops.json'), JSON.stringify(bus));
writeFileSync(join(HERE, 'bus-lines.json'), JSON.stringify(lines));

writeFileSync(join(HERE, 'meta.json'), readFileSync(join(BUILD, 'meta.json')));
console.log(`rail.json: ${Object.keys(rail.stations).length} stations; bus-stops.json: ${bus.stops.length} stops; bus-lines.json: ${lines.lines.length} lines`);
