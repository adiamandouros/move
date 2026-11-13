// A trip through the lab, for trying one you know, on a Wednesday:
//
//   node scripts/planner-lab/build-buses.js data/local/planner-lab/buses.json   (once)
//   node scripts/planner-lab/trip.js "Πατησίων 100" "Σύνταγμα" [08:30]
//
// Ways are put in order by the weights (weights.js), with buses' slowest
// tenth from buses-bad-day.json beside it where it's been built (README.md).
//
// Addresses are looked up in the local index and go nowhere: nothing is sent
// or written. Keep real addresses out of the repository too, as it's public.

import { existsSync, readFileSync } from 'fs';
import { gunzipSync } from 'zlib';
import { load, search as lookUp } from '../../server/places/search.js';
import { createPlanner, joinNetwork } from '../../tools/subway/client/city.js';
import { acrossWindow, describeWay, findWays, fold, spine } from '../../tools/subway/client/ways.js';
import { answer, TIE_SECONDS } from '../../tools/subway/client/answer.js';

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

const network = buses => createPlanner(joinNetwork(json('data/build/rail.json'), json(buses), WEDNESDAY));
const planner = network('data/local/planner-lab/buses.json');
const badDayFile = 'data/local/planner-lab/buses-bad-day.json';
const badDay = existsSync(inRepo(badDayFile)) ? network(badDayFile) : planner;
const access = planner.near(place(from), END_WALK_SECONDS, -1, 'in');
const egress = planner.near(place(to), END_WALK_SECONDS, -1, 'out');
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

const { kind, rows, decision } = answer(planner, access, egress, now, { badDay });
const clock = seconds => `${String(Math.floor(seconds / 3600) % 24).padStart(2, '0')}:${String(Math.floor(seconds / 60) % 60).padStart(2, '0')}`;
console.log(`\nThe answer for the next half hour: ${kind}${badDay === planner ? '' : ', buses ranked by a bad day'}`);
for (const row of rows.slice(0, SHOWN)) {
    const bus = row.lines.length ? ` (${row.lines.join(', ')}${row.every ? `, one every ${Math.round(row.every / 60)} min` : ''})` : '';
    console.log(`  ${row.range.join('–')} min, costs ${Math.round(row.cost / 60)}, first on ${Math.round(100 * row.first)}%: ${row.key}${bus}`);
}
if (decision) {
    const where = planner.stops[decision.stop].name;
    console.log(`The directions: ${decision.stayOn.key}. On the way, ${decision.lines.join(' or ')} at ${where} is offered if it leaves ${clock(decision.ready)} to ${clock(decision.latest - TIE_SECONDS)}`);
}
