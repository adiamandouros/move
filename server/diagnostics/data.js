// The data the site is built from: the last build, the timetable's end, the
// bus network from OASA, STASY's first and last trains and airport
// timetable, the nightly checks of the timetable against STASY's, and the
// suburban railway's boards from railway.gov.gr.

import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { lastFetchFile } from '../data/oasa-network.js';
import { AIRPORT_CHECK_MAX_AGE_MS, airportCheckFile } from '../data/airport-check.js';
import { STASY_MAX_AGE_MS, stasyFetchFile } from '../data/stasy.js';
import { AIRPORT_STALE_DAYS, BUILD_MAX_AGE_MS, dataStatus, STASY_STALE_DAYS, TIMETABLE_WARN_DAYS } from '../data/status.js';
import { readJson } from '../files.js';
import { RELAY_VERSION } from '../../proxy/worker.js';
import { check } from './probe.js';

// Whether each is fine is server/data/status.js's call, the same as /api/health's
export function dataChecks(dataDir, now) {
    const out = [];
    const meta = readJson(join(dataDir, 'build', 'meta.json'));
    const status = dataStatus({ buildDir: join(dataDir, 'build'), rawDir: join(dataDir, 'raw'), now });
    if (!meta) {
        out.push(check('Data', 'Timetable data', 'fail', 'Never built (data/build/meta.json is missing)', 'It builds automatically on app start. Check the app log for "[data]" errors, or run "npm run build:data".'));
    } else {
        const hours = Math.round((now() - Date.parse(meta.generated)) / 3_600_000);
        out.push(check('Data', 'Last data build', status.build.tooOld ? 'warn' : 'ok', `${meta.generated.slice(0, 16).replace('T', ' ')} UTC (${hours} h ago)`,
            status.build.tooOld ? `Over ${BUILD_MAX_AGE_MS / 3_600_000} h: builds run daily at 04:30 and on app start. Is the app running? Check the log for "[data]" lines.` : undefined));
        const { timetableEnds: ends, timetableDaysLeft: left } = status.build;
        if (ends) {
            out.push(left < TIMETABLE_WARN_DAYS
                ? check('Data', 'Metro timetable', 'warn', `${left < 0 ? `Ended on ${ends}` : `Ends on ${ends} (in ${left} days)`}, and no newer one has been published yet`,
                    'A new feed is picked up by the nightly build as soon as OASA publishes it. After the last day, the planner uses the feed\'s last full week.')
                : check('Data', 'Metro timetable', 'ok', `Runs until ${ends} (in ${left} days)`));
        }
        for (const [name, o] of Object.entries(meta.outputs ?? {})) {
            if (!o.ok) out.push(check('Data', name, 'fail', `Last build failed: ${o.error}${o.keptPrevious ? ' (the previous version is still served)' : ''}`));
            for (const w of (o.warnings ?? []).filter(w => /expired/i.test(w))) out.push(check('Data', name, 'info', w));
        }
    }
    out.push(...networkCheck(dataDir));
    out.push(stasyCheck(dataDir, meta, status.stasy));
    out.push(...airportCheck(dataDir, meta, status.airport));
    out.push(...railChecks(meta));
    out.push(...railwayCheck(status.railway));
    const lock = join(dataDir, '.build.lock');
    if (existsSync(lock)) out.push(check('Data', 'Build lock', 'info', `A build is running or was interrupted (process ${readFileSync(lock, 'utf8').trim()})`));
    return out;
}

// The suburban railway's boards from railway.gov.gr (server/data/railway.js):
// how the last fetch went, and how many days of trains from today on are kept
function railwayCheck(railway) {
    if (!railway) return [];
    const when = railway.lastFetch ? `${railway.lastFetch.at.slice(0, 16).replace('T', ' ')} UTC` : null;
    const kept = `${railway.days} day${railway.days === 1 ? '' : 's'} of trains from today on`;
    if (!railway.today) {
        return [check('Data', 'Suburban railway', 'fail', `No trains for today, so the Trip page leaves the railway out. ${when ? `Last fetch ${when}${railway.lastFetch.ok ? '' : `, failed: ${railway.lastFetch.error}`}.` : 'Never fetched.'}`,
            'The boards are fetched once a day, by the first build of the day. The app log\'s "[data] railway.gov.gr" lines say which request failed and why.')];
    }
    if (railway.lastFetch && !railway.lastFetch.ok) {
        return [check('Data', 'Suburban railway', 'warn', `The fetch at ${when} failed: ${railway.lastFetch.error}. ${kept} are kept, from earlier fetches.`,
            'The next try is with the first build of tomorrow (Athens time).')];
    }
    return [check('Data', 'Suburban railway', 'ok', `${when ? `Fetched ${when}` : 'Kept'}: ${kept}`)];
}

// The last fetch of the bus network from OASA (server/data/oasa-network.js):
// when it stopped short, how far it got
function networkCheck(dataDir) {
    const last = readJson(lastFetchFile(join(dataDir, 'raw')));
    if (!last) return [];
    const when = `${last.at.slice(0, 16).replace('T', ' ')} UTC`;
    const took = `${Math.max(1, Math.round(last.seconds / 60))} min`;
    if (last.ok) {
        return [check('Data', 'Bus network from OASA', 'ok', `Fetched ${when} in ${took}: ${last.lines.total} lines, ${last.stops.total} routes' stops asked for (the rest were less than a week old)`)];
    }
    const hint = 'Restart the app (cPanel → Setup Node.js App) to try again now, or wait for the 04:30 build. The app log\'s "[data] OASA" lines say which request failed and why.';
    if (last.stops) {
        const { done, total } = last.stops;
        return [check('Data', 'Bus network from OASA', 'warn',
            `The fetch at ${when} stopped after ${took}, with ${done} of ${total} routes' stops: ${last.error}. They're saved: the next build asks only for the other ${total - done}. Meanwhile the last network is used.`,
            hint, { done, total, label: 'Routes\' stops fetched' })];
    }
    if (last.lines) {
        const { done, total } = last.lines;
        return [check('Data', 'Bus network from OASA', 'warn',
            `The fetch at ${when} stopped after ${took}, with the routes of ${done} of ${total} lines, before any route's stops: ${last.error}. The next build starts again. Meanwhile the last network is used.`,
            hint, { done, total, label: 'Lines\' routes fetched' })];
    }
    return [check('Data', 'Bus network from OASA', 'warn', `The fetch at ${when} stopped at the start: ${last.error}. Meanwhile the last network is used.`, hint)];
}

// STASY's first and last trains (server/data/stasy.js): which copy the pages
// use, how the last fetch went, and lines the copy couldn't give times for
function stasyCheck(dataDir, meta, status) {
    const title = 'STASY timetables';
    const last = readJson(stasyFetchFile(join(dataDir, 'raw')));
    const fetched = readJson(join(dataDir, 'build', 'rail.json'))?.hours?.fetched ?? null;
    const lines = (meta?.outputs?.['rail.json']?.warnings ?? []).filter(w => w.startsWith('STASY'));
    const using = fetched
        ? `The station pages use STASY's first and last trains from ${fetched}`
        : 'The station pages use the GTFS\'s first and last trains (approximate: they include depot runs)';
    const when = last && `${last.at.slice(0, 16).replace('T', ' ')} UTC`;
    const retry = 'The next build tries again (daily at 04:30, and on app start). STASY refuses the server, so the pages come through the relays: check the relay rows above.';
    if (last?.unreadable) {
        return check('Data', title, 'fail', `STASY's pages changed: the fetch at ${when} couldn't read them (${last.error}). ${using}.`,
            'Change the reading rules in server/data/stasy.js to match, or add how STASY writes a station to its "stasy" names (data/curated/README.md). Until then, the last copy is used.');
    }
    if (last && !last.ok) return check('Data', title, 'warn', `The fetch at ${when} failed: ${last.error}. ${using}.`, retry);
    if (!last && !fetched) return check('Data', title, 'warn', `Not fetched yet. ${using}.`, retry);
    if (!status.ok) return check('Data', title, 'warn', `${using}, a copy over ${STASY_STALE_DAYS} days old (${status.daysOld} days).`, retry);
    if (lines.length) return check('Data', title, 'warn', `${using}, except: ${lines.join(' · ')}`);
    const next = fetched && new Date(Date.parse(fetched) + STASY_MAX_AGE_MS).toISOString().slice(0, 10);
    return check('Data', title, 'ok', `${using}${last ? `, fetched ${when} (${last.route})` : ''}. Next fetch from ${next}.`);
}

// STASY's airport timetable (server/data/airport-check.js): the weekly check
// that it's still as data/curated/airport.json has it, and what the build did
// with it (rail.json's warnings: trains added, and ones to check on the platform)
function airportCheck(dataDir, meta, status) {
    const title = 'STASY airport timetable';
    const last = readJson(airportCheckFile(join(dataDir, 'raw')));
    const built = (meta?.outputs?.['rail.json']?.warnings ?? []).filter(w => /airport/i.test(w));
    const when = t => `${t.slice(0, 16).replace('T', ' ')} UTC`;
    const update = 'Compare the PDFs on STASY\'s line 3 page with data/curated/airport.json and update its trains, "pdf" and "sha256" (data/curated/README.md). Until then, its trains are still added.';
    const out = [];
    if (!last) out.push(check('Data', title, 'info', 'Not checked yet: the nightly build checks it once a week'));
    else if (last.changes?.length) out.push(check('Data', title, 'fail', `Changed since airport.json, checked ${when(last.checked)}: ${last.changes.join(' · ')}`, update));
    else if (last.error) {
        out.push(check('Data', title, 'warn', `The check at ${when(last.at)} failed: ${last.error}${last.checked ? `. Last checked ${when(last.checked)}: unchanged` : ''}`,
            `The next build tries again. STASY refuses the server, so the PDFs come through the relays: check the relay rows above (relay version ${RELAY_VERSION} is needed).`));
    } else if (!status.ok) {
        out.push(check('Data', title, 'warn', `Last checked ${when(last.checked)}, over ${AIRPORT_STALE_DAYS} days ago (${status.daysOld} days)`,
            'The nightly build checks it once a week: check the app log for "[data]" lines, and the relay rows above.'));
    } else {
        const next = new Date(Date.parse(last.checked) + AIRPORT_CHECK_MAX_AGE_MS).toISOString().slice(0, 10);
        out.push(check('Data', title, 'ok', `Unchanged, checked ${when(last.checked)} (${last.route}). Next check from ${next}.`));
    }
    if (built.length) out.push(check('Data', 'Airport trains in the timetable', 'info', built.join(' · ')));
    return out;
}

// The nightly checks of the metro timetable against STASY's tables
// (server/data/rail-checks.js): problems fail /api/health; notes are where the
// GTFS and STASY disagree, worth a look (or a trip to the platform)
function railChecks(meta) {
    const checks = meta?.outputs?.['rail.json']?.checks;
    if (!checks) return [];
    const out = [];
    if (checks.problems.length) {
        out.push(check('Data', 'Rail data checks', 'fail', checks.problems.join(' · '),
            'The timetable code relies on these. Check data/curated (stations.json\'s "stasy" names) and STASY\'s pages, or the reading rules in server/data/stasy.js.'));
    } else out.push(check('Data', 'Rail data checks', 'ok', 'Every stop has STASY\'s first and last trains, so depot runs are left out'));
    if (checks.notes.length) out.push(check('Data', 'Where the GTFS and STASY differ', 'info', checks.notes.join(' · ')));
    return out;
}
