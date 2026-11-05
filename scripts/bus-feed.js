// OASA's open-data bus timetable, converted once for the trip search: its
// week in data/oasa/bus-timetable.json (server/data/bus-timetable.js, decision
// 30). The feed stopped in August 2026, and the data build can't read it as it
// comes now (its trips and stop times are RAR archives), so it's kept in the
// repository. Run it again only if OASA publishes a new one:
//
//   download the feed from https://catalog.growthfund.gr/ into data/raw/bus/,
//   the archives unpacked (routes.txt, trips.txt, stop_times.txt, calendar.txt)
//   node scripts/bus-feed.js [data/raw/bus]

import { readFileSync, writeFileSync } from 'fs';
import { join, resolve } from 'path';
import { fileURLToPath } from 'url';
import { weekFromFeed } from '../server/data/bus-timetable.js';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
export const OUT = join(ROOT, 'data/oasa/bus-timetable.json');

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const dir = process.argv[2] ?? join(ROOT, 'data/raw/bus');
    // When it was published: the newest of its files on the portal (sources.js keeps a manifest)
    const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'));
    const modified = Object.values(manifest).map(file => file.version).sort().at(-1).slice(0, 10);
    const week = await weekFromFeed(dir, modified);
    writeFileSync(OUT, `${JSON.stringify(week)}\n`);
    const trips = week.routes.reduce((sum, route) => sum + route.patterns.flat().length, 0);
    console.log(`${OUT}: ${week.routes.length} routes, ${trips} trips in their patterns, from ${week.feed.validFrom} to ${week.feed.validTo}`);
}
