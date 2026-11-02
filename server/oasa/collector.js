import { readFileSync } from 'fs';
import { athensNow } from '../../tools/subway/client/network.js';

// Asks OASA for a few stops through the weekday rush hours, so passes.js sees
// buses pass them even when nobody is looking (roadmap Plan 3, decision 26).
// One stop every ASK_EVERY_MS, in turn, so each of a week's stops is asked
// about every 3 minutes, which catches about 97% of buses passing (the
// rush-hour test of 2 November 2026). Never in a burst: a queue makes the
// cache keep visitors' answers longer. Its requests go last in the queue and
// are skipped whenever anyone is waiting (client.js, the 'low' lane).
//
// The stops change each week (collector-stops.json, made by
// scripts/collector-stops.js), counted in weeks from FIRST_WEEK, and start
// again after the last.

export const ASK_EVERY_MS = 6_000;
// Monday to Friday, Athens time: [from, to) in hours
export const HOURS = [[7, 10], [16, 20]];
// The Monday the first week's stops were first asked for
export const FIRST_WEEK = '2026-11-02';
const WEEK_MS = 7 * 86_400_000;

export const loadStopSets = () => JSON.parse(readFileSync(new URL('./collector-stops.json', import.meta.url), 'utf8')).weeks;

// The week's stops at `at` (ms), or none outside the hours
export function stopsAt(weeks, at) {
    const { weekday, seconds, date } = athensNow(new Date(at));
    const hour = seconds / 3600;
    if (weekday === 0 || weekday === 6 || !HOURS.some(([from, to]) => hour >= from && hour < to)) return [];
    const week = Math.floor((Date.parse(date) - Date.parse(FIRST_WEEK)) / WEEK_MS);
    return weeks[((week % weeks.length) + weeks.length) % weeks.length];
}

// The stop to ask for at `at`, or null: each in turn, one per ASK_EVERY_MS
export function stopToAsk(weeks, at) {
    const stops = stopsAt(weeks, at);
    return stops.length ? stops[Math.floor(at / ASK_EVERY_MS) % stops.length] : null;
}

/**
 * @param {{ ask: (stop: string) => Promise<unknown>, weeks?: string[][], now?: () => number,
 *   every?: (fn: () => void, ms: number) => { unref?(): void } }} options
 *   ask: a stop's arrivals as the collector asks for them (arrivals.js, { collect: true })
 */
export function createCollector({ ask, weeks = loadStopSets(), now = Date.now, every = setInterval }) {
    const tick = () => {
        const stop = stopToAsk(weeks, now());
        // A failed or skipped request is just a gap: the next round asks again
        if (stop) ask(stop).catch(() => {});
        return stop;
    };
    return {
        tick,
        // server.js starts it, not the app: tests and the browser tests never collect
        start() { every(tick, ASK_EVERY_MS).unref?.(); },
    };
}
