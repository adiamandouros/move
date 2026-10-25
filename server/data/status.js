import { join } from 'path';
import { readJson } from '../files.js';
import { athensDate } from '../../tools/subway/client/network.js';
import { airportCheckFile } from './airport-check.js';
import { stasyFetchFile } from './stasy.js';

// How the data stands, judged once here for both /api/health (server/health.js)
// and /admin/diagnostics (server/diagnostics.js), so they never disagree:
//   - build: the last build is under BUILD_MAX_AGE_MS old and every part of
//     it worked; the metro timetable doesn't end within TIMETABLE_WARN_DAYS;
//     its nightly checks found no problems (rail-checks.js)
//   - stasy: STASY's pages could be read on the last try, and the copy of them
//     in use is at most STASY_STALE_DAYS old (stasy.js)
//   - airport: STASY's airport timetable is still as data/curated/airport.json
//     has it, checked within AIRPORT_STALE_DAYS (airport-check.js); not
//     checked yet counts as fine

// One missed night (builds run every night at 04:30)
export const BUILD_MAX_AGE_MS = 36 * 3_600_000;
export const TIMETABLE_WARN_DAYS = 7;
// Three fetches missed (one every 14 days)
export const STASY_STALE_DAYS = 45;
// Three weekly checks missed
export const AIRPORT_STALE_DAYS = 21;
const DAY_MS = 86_400_000;

/** @param {{ buildDir: string, rawDir: string, now?: () => number }} options */
export function dataStatus({ buildDir, rawDir, now = Date.now }) {
    const meta = readJson(join(buildDir, 'meta.json'));
    const rail = readJson(join(buildDir, 'rail.json'));
    const today = Date.parse(athensDate(new Date(now())));

    const built = meta?.generated ? Date.parse(meta.generated) : null;
    const outputs = Object.fromEntries(Object.entries(meta?.outputs ?? {}).map(([name, o]) => [name, Boolean(o.ok)]));
    const tooOld = built !== null && now() - built >= BUILD_MAX_AGE_MS;
    const validTo = rail?.feed?.validTo ?? null;
    const build = {
        ok: Boolean(built && !tooOld && Object.keys(outputs).length && Object.values(outputs).every(Boolean)),
        built: built ? new Date(built).toISOString() : null,
        tooOld,
        outputs,
        timetableEnds: validTo,
        // Whole days from today (Athens) to the timetable's last day
        timetableDaysLeft: validTo ? Math.round((Date.parse(validTo) - today) / DAY_MS) : null,
        // What the timetable code relies on that no longer holds (rail-checks.js)
        problems: meta?.outputs?.['rail.json']?.checks?.problems?.length ?? 0,
    };

    const unreadable = Boolean(readJson(stasyFetchFile(rawDir))?.unreadable);
    const fetched = rail?.hours?.fetched ?? null;
    const stasyDays = fetched ? Math.round((today - Date.parse(fetched)) / DAY_MS) : null;
    const stasy = { ok: !unreadable && !(stasyDays > STASY_STALE_DAYS), fetched, daysOld: stasyDays, unreadable };

    const last = readJson(airportCheckFile(rawDir));
    const checked = last?.checked ?? null;
    const airportDays = checked ? Math.floor((now() - Date.parse(checked)) / DAY_MS) : null;
    const changed = Boolean(last?.changes?.length);
    const airport = { ok: !changed && !(airportDays > AIRPORT_STALE_DAYS), checked, daysOld: airportDays, changed };

    return { build, stasy, airport };
}
