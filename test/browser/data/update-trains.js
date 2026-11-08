// Refreshes the browser tests' trains.json, the suburban railway's trains by
// date (decision 40), from the real build's (data/build/, made by
// `npm run build:data`). Run it when trains.json's format changes, then check
// the tests still pass and commit the result:
//   node test/browser/data/update-trains.js
//
// A build has the days around the day it ran, not the tests' week, so each
// day of the tests' week, Tuesday 20 to Sunday 25 October 2026 (fixtures.js's
// Wednesday the 21st, from the day before to 4 days after, as a build that
// day has them), gets the trains of a day the build has of the same kind:
// the same weekday, or else another weekday, or the other day of the weekend.
// Their times are from midnight, so they need no other change. Apart from
// update.js, as refreshing the other files brings in more than they need.
import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const BUILD = join(HERE, '..', '..', '..', 'data', 'build');
const WEEK = ['2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23', '2026-10-24', '2026-10-25'];

const weekday = date => new Date(`${date}T00:00:00Z`).getUTCDay();
const weekend = day => day === 0 || day === 6;

const trains = JSON.parse(readFileSync(join(BUILD, 'trains.json'), 'utf8'));
const days = Object.keys(trains.dates);
const like = date => {
    const day = weekday(date);
    return days.find(d => weekday(d) === day) ?? days.find(d => weekend(weekday(d)) === weekend(day));
};
const picked = WEEK.map(date => [date, like(date)]);
const missing = picked.filter(([, from]) => !from).map(([date]) => date);
if (missing.length) throw new Error(`data/build/trains.json has no day like ${missing.join(', ')}`);
trains.dates = Object.fromEntries(picked.map(([date, from]) => [date, trains.dates[from]]));
writeFileSync(join(HERE, 'trains.json'), JSON.stringify(trains));
console.log(`trains.json: ${picked.map(([date, from]) => `${date} from ${from}`).join(', ')}`);
