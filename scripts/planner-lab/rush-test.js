// One test of OASA's live times, outside the app: does what it predicts in the
// rush hour match when buses really pass? It asks wayhop.gr for a few stops,
// the way a visitor would, once a minute, and appends each answer to a file.
//
//   node scripts/planner-lab/rush-test.js --until 2026-11-02T09:30:00+02:00 --out results.jsonl
//   node scripts/planner-lab/rush-test.js --rounds 1 --out check.jsonl
//
// The numbers were agreed on 1 November 2026: these 12 stops, once a minute,
// 08:00 to 09:30, so at most 12 requests a minute, about 1,090 in all, a tenth
// of the budget while it runs (decision 21). It runs on one computer and
// doesn't touch the app. Only Node's own modules, so a copy runs anywhere.

import { appendFileSync } from 'fs';
import { resolve } from 'path';
import { fileURLToPath } from 'url';
import { parseArgs } from 'util';

export const STOPS = [
    '60002', '10341', // Syntagma, the A2's and the 040's
    '10308', '60806', '12364', // around Syggrou-Fix
    '240003', // Efesou, where the buses from there get off
    '11530', // Korydallos station, for the 750 to Aigaleo
    '70040', '70021', // Aigaleo: 703, 891, 845 and 750; the 420
    '420116', '420126', // the 703's and 891's stop, and the 750's and 845's
    '60930', // Kolokynthous, where the 420 gets off
];
const SITE = 'https://wayhop.gr';
const ROUND_MS = 60_000;
const TIMEOUT_MS = 20_000;

// A stop's answer, without the names: which buses, and in how many minutes
const brief = ({ arrivals, stale, unavailable }) => ({
    arrivals: (arrivals ?? []).map(({ line, route, vehicle, minutes }) => ({ line, route, vehicle, minutes })),
    ...(stale && { stale }),
    ...(unavailable && { unavailable }),
});

// One round as a line for the file. A failure is written too: a gap in the
// times has to be told from no buses coming.
export async function askOnce(stops, at, fetch = globalThis.fetch) {
    try {
        const res = await fetch(`${SITE}/api/arrivals?stops=${stops.join(',')}`, {
            headers: { 'User-Agent': 'Wayhop rush-hour test' }, signal: AbortSignal.timeout(TIMEOUT_MS),
        });
        if (!res.ok) return { at, status: res.status };
        const answer = await res.json();
        return { at, stops: Object.fromEntries(Object.entries(answer.stops).map(([code, stop]) => [code, brief(stop)])) };
    } catch (err) {
        return { at, error: err.message };
    }
}

// Asks on each whole minute until `until` (ms) or for `rounds` rounds
/**
 * @param {{ stops: string[], until?: number, rounds?: number, write: (line: object) => void,
 *   fetch?: typeof globalThis.fetch, now?: () => number, wait?: (ms: number) => Promise<void> }} options
 * @returns {Promise<number>} the rounds asked
 */
export async function rushTest({ stops, until = Infinity, rounds = Infinity, write, fetch = globalThis.fetch, now = Date.now, wait = ms => new Promise(done => setTimeout(done, ms)) }) {
    let asked = 0;
    while (asked < rounds && now() < until) {
        write(await askOnce(stops, now(), fetch));
        asked++;
        if (asked < rounds) await wait(ROUND_MS - now() % ROUND_MS);
    }
    return asked;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const { values } = parseArgs({ options: { until: { type: 'string' }, rounds: { type: 'string' }, out: { type: 'string' } } });
    if (!values.out || !(values.until || values.rounds)) {
        console.error('Usage: rush-test.js --out <file> (--until <date and time> | --rounds <n>)');
        process.exit(2);
    }
    const asked = await rushTest({
        stops: STOPS,
        until: values.until ? Date.parse(values.until) : undefined,
        rounds: values.rounds ? Number(values.rounds) : undefined,
        write: line => appendFileSync(values.out, `${JSON.stringify(line)}\n`),
    });
    console.log(`${new Date().toISOString()} ${asked} rounds written to ${values.out}`);
}
