import { appendFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { athensDate } from '../../tools/subway/client/network.js';

// When buses really passed a stop, from the answers OASA already gives
// (roadmap Plan 3, decision 26). OASA's countdown is right to about a minute
// for a bus a few minutes away (the rush-hour test of 2 November 2026), so a
// bus that was CLOSE_MINUTES or less away and is gone from the stop's next
// answer passed at about the time it was given. The same bus passing two
// stops of its route times the ride between them; that's worked out later,
// from the files, not here.
//
// Each pass is one line of the day's file (Athens date), in `dir`:
//   2026-11-03.jsonl: {"at":1793680000,"stop":"60002","route":"5567","line":"Α2","vehicle":"44581"}
// `at` in seconds. About buses only: nothing about who looked at the stop.

export const CLOSE_MINUTES = 3;
// Answers further apart than this can't say when a bus passed
export const MAX_GAP_MS = 6 * 60_000;
// The same bus at the same stop within this long is one pass
const SAME_PASS_MS = 10 * 60_000;

/**
 * @param {{ dir?: string | null, log?: (message: string) => void, counted?: (passes: number) => void }} [options]
 *   dir: where the day files go (none: passes are only returned, as in tests);
 *   counted: told how many passes each answer found (usage.passes)
 */
export function createPasses({ dir = null, log = console.warn, counted = () => {} } = {}) {
    const last = new Map();     // stop → { at, close: arrivals CLOSE_MINUTES or less away }
    const recent = new Map();   // `${stop} ${vehicle}` → when it passed (ms)
    let failed = false;

    function write(passes) {
        if (!dir || !passes.length) return;
        try {
            mkdirSync(dir, { recursive: true });
            // (no Map.groupBy: the host runs Node 20)
            const days = {};
            for (const p of passes) (days[athensDate(new Date(p.at))] ??= []).push(`${JSON.stringify({ ...p, at: Math.round(p.at / 1000) })}\n`);
            for (const [date, lines] of Object.entries(days)) appendFileSync(join(dir, `${date}.jsonl`), lines.join(''));
            failed = false;
        } catch (err) {
            // Said once until writing works again
            if (!failed) log(`[passes] Couldn't write the buses that passed: ${err.message}`);
            failed = true;
        }
    }

    // A fresh answer from OASA for `stop`, asked at `at` (ms) → the passes it shows
    function seen(stop, arrivals, at) {
        const before = last.get(stop);
        last.set(stop, { at, close: arrivals.filter(a => a.vehicle && Number.isFinite(a.minutes) && a.minutes <= CLOSE_MINUTES) });
        if (!before || at <= before.at || at - before.at > MAX_GAP_MS) return [];

        for (const [key, when] of recent) if (at - when > SAME_PASS_MS) recent.delete(key);
        const still = new Set(arrivals.map(a => a.vehicle));
        const passes = [];
        for (const a of before.close) {
            const key = `${stop} ${a.vehicle}`;
            if (still.has(a.vehicle) || recent.has(key)) continue;
            const passed = Math.min(before.at + a.minutes * 60_000, at);
            recent.set(key, passed);
            passes.push({ at: passed, stop, route: a.route, line: a.line, vehicle: a.vehicle });
        }
        write(passes);
        if (passes.length) counted(passes.length);
        return passes;
    }

    return { seen };
}
