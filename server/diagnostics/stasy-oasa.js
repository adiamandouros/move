// What the app reads from OASA's and STASY's websites, as it last fetched
// them: the announcements and STASY's lift page.

import { check } from './probe.js';

// The announcement sources, as the running app last fetched them
// (server/info/announcements.js status())
const ANNOUNCEMENT_SOURCES = {
    oasaEl: 'OASA (Greek)',
    oasaEn: 'OASA (English)',
    stasy: 'STASY (metro and tram)',
};
const UPDATE_RELAY = 'Update the home relay on the Pi: sudo git -C /opt/move pull && sudo systemctl restart move-relay';

export function announcementChecks(sources, now = Date.now) {
    if (!sources) return [];
    const ago = t => `${Math.max(0, Math.round((now() - Date.parse(t)) / 60_000))} min ago`;
    return Object.entries(sources).map(([name, s]) => {
        const title = ANNOUNCEMENT_SOURCES[name] ?? name;
        if (s.ok) {
            const via = s.route && s.route !== 'direct' ? `, through the ${s.route}` : '';
            const leftOut = s.leftOut ? `; ${s.leftOut} new post${s.leftOut === 1 ? '' : 's'} left out for now (${s.leftOut === 1 ? 'its page' : 'their pages'} didn't load)` : '';
            return check('Announcements', title, 'ok', `${s.items} current${via}${leftOut}`);
        }
        if (s.ok === undefined) return check('Announcements', title, 'info', 'Not fetched since the app started');
        let hint;
        if (name === 'stasy' && /relay: HTTP 400/.test(s.error)) hint = `The relay doesn't know STASY pages yet. ${UPDATE_RELAY}`;
        else if (name === 'stasy' && /direct: HTTP 403/.test(s.error) && !/relay/.test(s.error)) hint = 'STASY refuses this server\'s address. Its pages can come through the home relay: see proxy/README.md.';
        const shown = s.updated ? `Showing the copy from ${ago(s.updated)}.` : 'Nothing to show.';
        return check('Announcements', title, s.updated ? 'warn' : 'fail', `${s.error}. ${shown}`, hint);
    });
}

// STASY's lift page, as the running app last fetched it (server/info/lifts.js status())
export function liftChecks(lifts, now = Date.now) {
    if (!lifts) return [];
    const ago = t => `${Math.max(0, Math.round((now() - Date.parse(t)) / 60_000))} min ago`;
    const title = 'STASY lift status';
    const out = [];
    if (lifts.ok) {
        const via = lifts.route && lifts.route !== 'direct' ? `, through the ${lifts.route}` : '';
        out.push(check('Lifts', title, 'ok', `${lifts.stations} stations${via}`));
    } else if (lifts.ok === undefined) {
        out.push(check('Lifts', title, 'info', lifts.updated ? `Not fetched since the app started; the copy is from ${ago(lifts.updated)}` : 'Not fetched since the app started'));
    } else {
        const hint = /direct: HTTP 403/.test(lifts.error) && !/relay/.test(lifts.error) ? 'STASY refuses this server\'s address. Its pages can come through the home relay: see proxy/README.md.' : undefined;
        const shown = lifts.updated ? `The copy is from ${ago(lifts.updated)} (shown for 2 hours).` : 'Nothing to show.';
        out.push(check('Lifts', title, lifts.updated ? 'warn' : 'fail', `${lifts.error}. ${shown}`, hint));
    }
    if (lifts.unknown?.length) {
        out.push(check('Lifts', 'Stations not known', 'warn', `STASY's lift page lists ${lifts.unknown.map(n => `"${n}"`).join(', ')}, which Wayhop doesn't know, so their lifts aren't shown`,
            'A new station, or a name written another way: add it to "stasy" in data/curated/stations.json.'));
    }
    return out;
}
