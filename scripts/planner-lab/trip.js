// A trip through the lab, for trying one you know, on a Wednesday:
//
//   node scripts/planner-lab/build-buses.js data/local/planner-lab/buses.json   (once)
//   node scripts/planner-lab/trip.js "Πατησίων 100" "Σύνταγμα" [08:30]
//
// Addresses are looked up in the local index and go nowhere: nothing is sent
// or written. Keep real addresses out of the repository too, as it's public.

import { readFileSync } from 'fs';
import { gunzipSync } from 'zlib';
import { load, search as lookUp } from '../../server/places/search.js';
import { joinNetwork } from './network.js';
import { answer } from './answer.js';
import { createPlanner } from './raptor.js';
import { acrossWindow, describeWay, findWays, fold, spine } from './ways.js';

const WEDNESDAY = 3;
const END_WALK_SECONDS = 1200;
const WINDOW_SECONDS = 90 * 60;
const SHOWN = 6;

const [from, to, time = '08:30'] = process.argv.slice(2);
if (!from || !to) {
    console.error('Usage: trip.js <from> <to> [HH:MM]');
    process.exit(2);
}
const inRepo = path => new URL(`../../${path}`, import.meta.url);
const json = path => JSON.parse(readFileSync(inRepo(path), 'utf8'));
const places = load(JSON.parse(gunzipSync(readFileSync(inRepo('data/cache/places-index.json.gz'))).toString()));
const place = query => {
    const [first] = lookUp(places, query).results;
    if (!first) throw new Error(`No such place: ${query}`);
    console.log(`${query}: ${first.kind ?? first.type}, ${first.lat}, ${first.lng}`);
    return first;
};

const planner = createPlanner(joinNetwork(json('data/build/rail.json'), json('data/local/planner-lab/buses.json'), WEDNESDAY));
const access = planner.near(place(from), END_WALK_SECONDS);
const egress = planner.near(place(to), END_WALK_SECONDS);
const [h, m] = time.split(':').map(Number);
const now = h * 3600 + m * 60;

for (const way of fold(findWays(planner, access, egress, now)).slice(0, SHOWN)) console.log(describeWay(planner, way, now));

const counts = new Map();
const departures = acrossWindow(planner, access, egress, { from: now, to: now + WINDOW_SECONDS });
for (const { way } of departures) {
    const key = way ? spine(planner, way) : 'nothing';
    counts.set(key, (counts.get(key) ?? 0) + 1);
}
console.log(`\nThe fastest over the next ${WINDOW_SECONDS / 60} minutes of departures:`);
for (const [key, count] of [...counts].sort((a, b) => b[1] - a[1])) console.log(`  ${Math.round(100 * count / departures.length)}% ${key}`);

const { kind, rows, decision } = answer(planner, access, egress, now);
const clock = seconds => `${String(Math.floor(seconds / 3600) % 24).padStart(2, '0')}:${String(Math.floor(seconds / 60) % 60).padStart(2, '0')}`;
console.log(`\nThe answer for the next half hour: ${kind}`);
for (const row of rows.slice(0, SHOWN)) {
    const bus = row.lines.length ? ` (${row.lines.join(', ')}${row.every ? `, one every ${Math.round(row.every / 60)} min` : ''})` : '';
    console.log(`  ${row.range.join('–')} min, first on ${Math.round(100 * row.first)}%: ${row.key}${bus}`);
}
if (decision) {
    const where = planner.stops[decision.stop].name;
    console.log(`On the way: get off for ${decision.lines.join(' or ')} at ${where} if it leaves ${clock(decision.ready)} to ${clock(decision.latest)}, else ${decision.stayOn.key}`);
}
