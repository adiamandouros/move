// What the running app reports: each route to OASA, the request budget and
// the visitor limit, and what it asked of OASA over the past hour and today.

import { REQUESTS_PER_SECOND } from '../oasa/client.js';
import { NEW_STOPS_PER_MINUTE } from '../oasa/limits.js';
import { answerTime, answerTimeText, BUSY_WAITS_MS, secondsText, STOPS_KEPT_FRESH, total, visitorsDropped } from '../oasa/usage.js';
import { check } from './probe.js';

export function appChecks(appStatus, now) {
    if (!appStatus) {
        return [check('Running app', 'Live status', 'warn', 'No status from the running app', 'The app writes data/cache/oasa-status.json every minute. If it\'s missing, the app may not be running. Check cPanel → Setup Node.js App.')];
    }
    const age = Math.round((now() - appStatus.at) / 1000);
    const out = [];
    if (age > 180) out.push(check('Running app', 'Live status', 'warn', `Last reported ${Math.round(age / 60)} min ago`, 'The app may have stopped. Restart it in cPanel → Setup Node.js App.'));
    const ago = t => t ? `${Math.round((now() - t) / 60_000)} min ago` : 'never';
    for (const r of appStatus.routes) {
        const parts = [`last success ${ago(r.lastOk)}`];
        if (r.lastError) parts.push(`last error ${ago(r.lastError.at)}: ${r.lastError.message}`);
        if (r.testing) {
            out.push(check('Running app', `Route: ${r.name}`, 'ok', `Being tested in the background (visitors use the next route meanwhile); ${parts.join('; ')}`));
            continue;
        }
        out.push(r.resting
            ? check('Running app', `Route: ${r.name}`, 'warn', `Resting until ${new Date(r.restUntil).toISOString().slice(0, 16).replace('T', ' ')} UTC after repeated failures; ${parts.join('; ')}`)
            : check('Running app', `Route: ${r.name}`, r.lastError && (!r.lastOk || r.lastError.at > r.lastOk) ? 'warn' : 'ok', parts.join('; ')));
    }
    // Load: requests that didn't fit the budget to OASA, and visitors over their share of it
    const hour = appStatus.usage?.hour;
    if (hour) {
        const dropped = visitorsDropped(hour.dropped);
        out.push(dropped
            ? check('Running app', 'Request budget', 'warn', `${dropped} requests to OASA in the past hour didn't fit the ${REQUESTS_PER_SECOND}/s budget, so people saw older arrivals`,
                'If this keeps happening, raise REQUESTS_PER_SECOND (server/oasa/client.js) or ARRIVALS_TTL_MS (server/oasa/arrivals.js). OASA states no limit, so go up gradually.')
            : check('Running app', 'Request budget', 'ok', `Every request in the past hour fit the ${REQUESTS_PER_SECOND}/s budget`));
    }
    if (hour?.limited) {
        out.push(check('Running app', 'Visitor limit', 'warn', `${hour.limited} requests in the past hour were refused for asking for more than ${NEW_STOPS_PER_MINUTE} new stops a minute`,
            'A few now and then is a script or a very busy shared address. Many, from normal use, means NEW_STOPS_PER_MINUTE (server/oasa/limits.js) is too low.'));
    }
    return out;
}

// What the running app asked of OASA and how OASA answered (server/oasa/usage.js),
// over the past hour and today so far
export function usageChecks(usage) {
    if (!usage) return [];
    return [['Past hour', usage.hour], ['Today so far', usage.today]].flatMap(([when, u]) => [
        check('Use of OASA', when, 'info', usageText(u)),
        ...Object.entries(u.routes).map(([name, r]) => check('Use of OASA', `${when}, ${name}`, 'info', routeText(r))),
    ]);
}

function usageText(u) {
    const r = u.requests;
    const answers = total(u.answers);
    const parts = [
        `${total(r)} requests (${r['arrivals-new']} first looks at a stop, ${r['arrivals-refresh']} refreshes, ${r['route-names']} route names, ${r['route-test']} route tests${r.collector ? `, ${r.collector} for the collector` : ''})`,
        answers ? `${Math.round(100 * u.answers.cache / answers)}% of ${answers} stop answers from the cache` : 'no stop answers',
        `${u.stops} different stops, at most ${u.peaks.stops} in one minute (about ${STOPS_KEPT_FRESH} can be kept fresh)`,
        `longest wait for a slot ${secondsText(u.peaks.waitMs)}`,
    ];
    const busy = BUSY_WAITS_MS.filter(ms => u.busyMinutes[ms]);
    if (busy.length) parts.push(`waited over ${busy.map(ms => `${secondsText(ms)} in ${u.busyMinutes[ms]} minutes`).join(', over ')}`);
    const dropped = visitorsDropped(u.dropped);
    if (dropped) parts.push(`${dropped} dropped, in ${u.dropMinutes} minutes`);
    if (u.answers.old || u.answers.none) parts.push(`OASA failed for ${u.answers.old + u.answers.none} stop answers (${u.answers.old} served older arrivals)`);
    if (u.dropped.collector) parts.push(`the collector skipped ${u.dropped.collector} turns while others waited`);
    if (u.passes) parts.push(`${u.passes} buses seen passing a stop`);
    if (u.paused) parts.push(`${u.paused} refused while every route rested`);
    if (u.limited) parts.push(`${u.limited} refused to visitors over their share`);
    if (u.network !== null) parts.push(`the nightly bus network took ${u.network} requests`);
    return parts.join('; ');
}

function routeText(r) {
    const half = answerTime(r.ms, 0.5);
    const most = answerTime(r.ms, 0.95);
    return [
        `${r.ok} answers, ${r.failed} failed${r.downMinutes ? `, none answered in ${r.downMinutes} minutes` : ''}`,
        ...(half === null ? [] : [`half ${answerTimeText(half)}, 95% ${answerTimeText(most)}`]),
    ].join('; ');
}
