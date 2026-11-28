// Times measured by riders (decision 84): the totals the server keeps, and
// nothing else. Per week, per line, direction, day type and hour: how many
// rides were reported, and per stretch, stop stood at and stop waited at
// (each by GPS or by network fixes apart), how many and how many in each
// 15-second band of time taken. Weeks older than KEEP_WEEKS go. Pure, so
// it's tested on its own; index.js keeps them in a file.

export const BAND_SECONDS = 15;
export const KEEP_WEEKS = 8;
const DAY_MS = 86_400_000;
const ATHENS_DATE = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Athens' });

/** @typedef {import('../../tools/trip/client/measure.js').Report} Report */
/** @typedef {{ n: number, bands: Record<string, number> }} Counted how many, and how many in each band (its number: seconds / BAND_SECONDS, rounded down) */
/**
 * A week's totals, each by its key: `rides` by line|dir|day|hour; `stretches`
 * by line|dir|day|hour|by|from|to; `stops` and `waits` by line|dir|day|hour|by|stop
 * @typedef {{ rides: Record<string, number>, stretches: Record<string, Counted>, stops: Record<string, Counted>, waits: Record<string, Counted> }} Week
 */
/** @typedef {{ weeks: Record<string, Week> }} Totals */

/**
 * The week `ms` is in, by the date of its Monday in Athens (YYYY-MM-DD)
 * @param {number} ms
 */
export function weekOf(ms) {
    const date = ATHENS_DATE.format(new Date(ms));
    const day = new Date(`${date}T00:00:00Z`);
    const back = (day.getUTCDay() + 6) % 7;
    return new Date(day.getTime() - back * DAY_MS).toISOString().slice(0, 10);
}

/** @returns {Week} */
const emptyWeek = () => ({ rides: {}, stretches: {}, stops: {}, waits: {} });

/** @param {Record<string, Counted>} table @param {string} key @param {number} s */
function count(table, key, s) {
    const c = table[key] ??= { n: 0, bands: {} };
    c.n++;
    const band = String(Math.floor(s / BAND_SECONDS));
    c.bands[band] = (c.bands[band] ?? 0) + 1;
}

/**
 * `report` (checked: check.js) added to the totals of the week `ms` is in
 * @param {Totals} totals @param {Report} report @param {number} ms
 */
export function addReport(totals, report, ms) {
    const week = totals.weeks[weekOf(ms)] ??= emptyWeek();
    const ride = `${report.line}|${report.dir}|${report.day}|${report.hour}`;
    week.rides[ride] = (week.rides[ride] ?? 0) + 1;
    for (const s of report.stretches) count(week.stretches, `${ride}|${s.by}|${s.from}|${s.to}`, s.s);
    for (const s of report.stops) count(week.stops, `${ride}|${s.by}|${s.stop}`, s.s);
    if (report.wait) count(week.waits, `${ride}|${report.wait.by}|${report.wait.stop}`, report.wait.s);
}

/**
 * The totals without the weeks before the last KEEP_WEEKS, by the week `ms` is in
 * @param {Totals} totals @param {number} ms @returns {Totals}
 */
export function recent(totals, ms) {
    const oldest = weekOf(ms - (KEEP_WEEKS - 1) * 7 * DAY_MS);
    return { weeks: Object.fromEntries(Object.entries(totals.weeks).filter(([week]) => week >= oldest)) };
}

/**
 * The time a band stands for, its middle, from the median of `c`'s
 * (phase 2's typical time: a few wrong reports hardly move it)
 * @param {Counted} c @returns {number}
 */
export function medianSeconds(c) {
    const bands = Object.entries(c.bands).map(([band, n]) => [Number(band), n]).sort((a, b) => a[0] - b[0]);
    let seen = 0;
    for (const [band, n] of bands) {
        seen += n;
        if (seen * 2 >= c.n) return band * BAND_SECONDS + BAND_SECONDS / 2;
    }
    return NaN;
}

/**
 * What /admin/diagnostics says of the reports, for phase 2 and phase 3's
 * tests: per line, the rides reported over the past 2 weeks (this one and
 * the one before) and how many in each 10 minutes from 07:00 to 22:00 on
 * average, phase 3 needing one (decision 84)
 * @param {Totals} totals @param {number} ms
 */
export function linesSummary(totals, ms) {
    const thisWeek = weekOf(ms);
    const lastWeek = weekOf(ms - 7 * DAY_MS);
    // Days counted: the week before, whole, and this one so far
    const days = 7 + Math.floor((ms - Date.parse(`${thisWeek}T00:00:00Z`)) / DAY_MS) + 1;
    /** @type {Record<string, { rides: number, daytime: number }>} */
    const lines = {};
    for (const week of [thisWeek, lastWeek]) {
        for (const [key, n] of Object.entries(totals.weeks[week]?.rides ?? {})) {
            const [line, , , hour] = key.split('|');
            const l = lines[line] ??= { rides: 0, daytime: 0 };
            l.rides += n;
            if (+hour >= 7 && +hour < 22) l.daytime += n;
        }
    }
    return Object.entries(lines).sort(([a], [b]) => a.localeCompare(b)).map(([line, l]) => ({
        line, rides: l.rides, perDay: l.rides / days, perTenMinutes: l.daytime / (days * 15 * 6),
    }));
}
