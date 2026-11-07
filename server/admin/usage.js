import { answerTime, answerTimeText, BUSY_WAITS_MS, KEEP_DAYS, secondsText, STOPS_KEPT_FRESH, total, visitorsDropped } from '../oasa/usage.js';

// How far ahead OASA predicts is shown over this many of the newest days
const HORIZON_DAYS = 7;

// The days of OASA's usage (server/oasa/usage.js) as /admin/usage shows them
// (admin/usage.hbs), newest first: what Wayhop asked for each day, how each
// route to OASA answered (and how much of it was the Trip page's), how far
// ahead OASA predicts, per line, and the
// pages opened by browser language.

// Searches of one kind (usage.js SEARCHES) in a day: how many, the stops they
// asked of OASA, and that per search; days from before they were counted have none
const searched = s => [s?.searches ?? '–', s ? s.answers.oasa : '–', s?.searches ? (s.answers.oasa / s.searches).toFixed(1) : '–'];
/** @param {Record<string, any>} days */
export function usageView(days) {
    const dates = Object.keys(days).sort().reverse();
    const share = (part, whole) => whole ? `${Math.round(100 * part / whole)}%` : '–';
    const week = dates.slice(0, HORIZON_DAYS);
    const lines = [...new Set(week.flatMap(date => Object.keys(days[date].horizon ?? {})))]
        .sort((a, b) => a.localeCompare(b, 'el', { numeric: true }));
    return {
        keepDays: KEEP_DAYS,
        stopsKeptFresh: STOPS_KEPT_FRESH,
        busyWaits: BUSY_WAITS_MS.map(secondsText).join(' / '),
        asked: dates.map(date => {
            const d = days[date];
            // Visitors' requests dropped; the collector's skipped turns apart
            const dropped = visitorsDropped(d.dropped);
            const [planSearches, planAsked, planPerSearch] = searched(d.plans);
            return {
                date,
                requests: total(d.requests),
                firstLooks: d.requests['arrivals-new'],
                refreshes: d.requests['arrivals-refresh'],
                routeNames: d.requests['route-names'],
                routeTests: d.requests['route-test'],
                network: d.network ?? '–',
                fromCache: share(d.answers.cache, total(d.answers)),
                stops: d.stops,
                mostAtOnce: d.peaks.stops,
                longestWait: secondsText(d.peaks.waitMs),
                busyMinutes: BUSY_WAITS_MS.map(ms => d.busyMinutes[ms] ?? 0).join(' / '),
                dropped: dropped ? `${dropped} (in ${d.dropMinutes} min)` : 0,
                paused: d.paused,
                limited: d.limited,
                planSearches, planAsked, planPerSearch,
                // (nor the collector)
                collector: d.requests.collector ?? '–',
                collectorSkipped: d.dropped.collector ?? '–',
                passes: d.passes ?? '–',
            };
        }),
        answered: dates.flatMap(date => Object.entries(days[date].routes).map(([route, r]) => ({
            date,
            route,
            ok: r.ok,
            failed: r.failed,
            half: answerTimeText(answerTime(r.ms, 0.5)),
            most: answerTimeText(answerTime(r.ms, 0.95)),
            downMinutes: r.downMinutes,
        }))),
        horizonDays: HORIZON_DAYS,
        // Per line: the most minutes ahead in those days, and on the median day
        horizon: lines.map(line => {
            const daily = week.map(date => days[date].horizon?.[line]).filter(n => n !== undefined).sort((a, b) => a - b);
            return { line, most: daily.at(-1), typical: daily[Math.floor((daily.length - 1) / 2)], days: daily.length };
        }),
        // (days kept before the pages were counted have none)
        pages: dates.filter(date => days[date].pages).map(date => {
            const { asked, served } = days[date].pages;
            return {
                date,
                opened: total(served),
                en: served.en ?? 0,
                el: served.el ?? 0,
                // Most asked first: "el 120, en 40, de 3, none 12"
                asked: Object.entries(asked).sort(([a, x], [b, y]) => y - x || a.localeCompare(b)).map(([lang, n]) => `${lang} ${n}`).join(', ') || '–',
            };
        }),
    };
}
