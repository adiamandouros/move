// The site itself: what its Content-Security-Policy reported, the hosting
// account's threads and apps, and the facts written on its pages by hand.

import { BUILD_MAX_MS, THREAD_LIMIT, THREADS_WARN } from '../processes.js';
import { check } from './probe.js';

// What the Content-Security-Policy blocked, or would block in report-only
// mode, as browsers reported it since the app started (server/csp-reports.js)
export function cspChecks(csp, now = Date.now) {
    if (!csp) return [];
    const GROUP = 'Content Security Policy';
    const ago = t => `${Math.max(0, Math.round((now() - Date.parse(t)) / 60_000))} min ago`;
    const mode = csp.mode === 'enforce'
        ? check(GROUP, 'Mode', 'ok', 'Enforced: browsers block anything the policy doesn\'t allow')
        : check(GROUP, 'Mode', 'info', 'Report-only: browsers report what the policy would block, but block nothing', 'Once a week goes by without reports that matter, set CSP_MODE=enforce in .env and restart.');
    const kinds = csp.kinds ?? [];
    if (!kinds.length) return [mode, check(GROUP, 'Reports', 'ok', 'Nothing reported since the app started')];
    return [
        mode,
        ...kinds.slice(0, 10).map(k => check(GROUP, `${k.directive}: ${k.blocked}`, 'warn',
            `${k.count}× since the app started, last ${ago(k.last)} on ${k.page || 'an unknown page'}${k.source ? ` (from ${k.source})` : ''}`,
            k.blocked.startsWith('chrome-extension') || k.blocked.startsWith('moz-extension') ? 'A browser extension, not the site: nothing to fix.' : undefined)),
        ...(kinds.length > 10 || csp.dropped ? [check(GROUP, 'More', 'info', `${Math.max(0, kinds.length - 10)} more kinds not shown${csp.dropped ? `, ${csp.dropped} reports not kept (over the limit)` : ''}`)] : []),
    ];
}

// The hosting account's threads and the apps LiteSpeed runs for it
// (server/processes.js accountStatus()); nothing off the host
/** @param {ReturnType<typeof import('../processes.js').accountStatus> | null} account */
export function accountChecks(account) {
    if (!account) return [];
    const GROUP = 'Hosting account';
    const { threads, limit } = account;
    const threadsCheck = check(GROUP, 'Threads', threads >= 0.9 * THREAD_LIMIT ? 'fail' : threads >= THREADS_WARN ? 'warn' : 'ok',
        `${threads} of the ${limit} the account may run at once`,
        threads >= THREADS_WARN ? `At ${limit}, nothing new can start: cPanel's Node.js page, deploys, the Terminal. Look for old copies below; each Node app takes about 11.` : undefined);
    const since = t => new Date(t).toISOString().slice(0, 16).replace('T', ' ');
    const list = ps => ps.map(p => `${p.pid} (since ${since(p.started)} UTC)`).join(', ');
    return [threadsCheck, ...account.apps.map(app => {
        const old = app.copies.filter(c => c.stale);
        const stuck = app.builds.filter(b => b.stuck);
        const copies = `${app.copies.length} cop${app.copies.length === 1 ? 'y' : 'ies'}, ${app.threads} threads`;
        const name = app.dir.split('/').pop() || app.dir;
        if (!old.length && !stuck.length) return check(GROUP, name, 'ok', `${copies}, running since ${since(app.copies.at(-1).started)} UTC`);
        return check(GROUP, name, 'warn',
            [copies,
                ...old.length ? [`${old.length} left over from before a restart: ${list(old)}`] : [],
                ...stuck.length ? [`${stuck.length} data build${stuck.length === 1 ? '' : 's'} running for over ${BUILD_MAX_MS / 60_000} minutes: ${list(stuck)}`] : [],
            ].join('; '),
            `Wayhop stops its own within 5 minutes. For another app, in the cPanel Terminal: kill ${[...old, ...stuck].map(p => p.pid).join(' ')}`);
    })];
}

// The facts written on the pages by hand (closing times, prices, night
// buses: checkedFacts in server/pages/registry.js) are worth checking again
// after FACTS_MAX_AGE_DAYS; the nightly live check (test/live/) says so too
export const FACTS_MAX_AGE_DAYS = 90;

/** @param {{ what: string, date: string }[]} facts @param {() => number} now */
export function factsChecks(facts, now = Date.now) {
    const GROUP = 'Facts checked by hand';
    return facts.map(({ what, date }) => {
        const days = Math.floor((now() - Date.parse(date)) / 86_400_000);
        return days > FACTS_MAX_AGE_DAYS
            ? check(GROUP, what, 'warn', `Last checked on ${date}, ${days} days ago`,
                'Check them against the sources the page links to, update the page if anything changed, and set the date in its tools/<id>/data.json.')
            : check(GROUP, what, 'ok', `Checked on ${date} (${days} days ago)`);
    });
}
