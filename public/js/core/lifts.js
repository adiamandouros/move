import { externalLink, format, formatHtml, html, notice, setHtml } from './html.js';
import { language, t } from './i18n.js';

// Which metro lifts are out of service, as STASY says (/api/lifts,
// server/info/lifts.js): the warning for the stations of a trip on the subway
// page and for a station's own page, and the words in the station search.
// Lifts: { fetched, stations: { <id>: { status: 'partial' | 'closed', out } } },
// with only the stations whose lifts aren't all working. Offline, or when
// STASY's page can't be read, there's nothing to say, so nothing is shown.

// The server asks STASY at most this often, so asking it more is no fresher
const REFRESH_MS = 10 * 60_000;
// An outage that long ago may be fixed (the server's limit too). Counted from
// when the page got it, so a phone's clock that's wrong doesn't matter.
const MAX_AGE_MS = 2 * 3_600_000;

// STASY's lift page, in the page's language
const STASY_PAGE = {
    el: 'https://www.stasy.gr/elevators/',
    en: 'https://www.stasy.gr/en/%ce%bb%ce%b5%ce%b9%cf%84%ce%bf%cf%85%cf%81%ce%b3%ce%b9%ce%ba%cf%8c%cf%84%ce%b7%cf%84%ce%b1-%ce%b1%ce%bd%ce%b5%ce%bb%ce%ba%cf%85%cf%83%cf%84%ce%ae%cf%81%cf%89%ce%bd-%ce%b5%ce%bd/',
};

// → lifts(): the lifts as last fetched (or null), fetching them again when
// that was over 10 minutes ago; `onChange` runs once each fetch is done, to
// draw the page again
/** @param {() => void} onChange @param {{ fetch?: typeof globalThis.fetch, now?: () => number }} [options] */
export function watchLifts(onChange, { fetch = globalThis.fetch, now = Date.now } = {}) {
    let lifts = null;
    let got = -Infinity;
    let asked = -Infinity;
    let loading = false;
    async function load() {
        loading = true;
        asked = now();
        try {
            const res = await fetch('/api/lifts');
            // 503: the server has no copy recent enough
            lifts = res.ok ? await res.json() : null;
            got = now();
        } catch {
            // Offline: the last copy, while it's recent enough
        }
        loading = false;
        onChange();
    }
    return () => {
        // Offline, not asked: asked again once the page is drawn online
        if (!loading && now() - asked >= REFRESH_MS && globalThis.navigator?.onLine !== false) load();
        return lifts && now() - got < MAX_AGE_MS ? lifts : null;
    };
}

// The time STASY's page was read, in Athens: "14:20"
const athensTime = iso => new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Athens', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(iso));

// STASY's names for the lifts, in Greek whatever the page's language
const liftNames = out => html`${out.map((name, i) => html`${i > 0 && ', '}<span lang="el">«${name}»</span>`)}`;

// The stations among `ids` (each once, in order) whose lifts aren't all working
const affected = (lifts, ids) => [...new Set(ids)].filter(id => lifts?.stations && Object.hasOwn(lifts.stations, id));

// One notice for the stations among `ids` with lifts out: a warning when one
// can't be reached step-free, else for information. '' when there's none.
// nameOf(id): the station's name in the page's language.
/** @param {any} lifts @param {string[]} ids @param {(id: string) => string} nameOf */
export function liftNotice(lifts, ids, nameOf) {
    const stations = affected(lifts, ids);
    if (!stations.length) return '';
    const closed = stations.some(id => lifts.stations[id].status === 'closed');
    const lines = stations.map(id => {
        const { status, out } = lifts.stations[id];
        const what = formatHtml(t(`lifts.${status}`), { station: html`<strong>${nameOf(id)}</strong>` });
        return html`<p class="mb-1">${what}${out.length > 0 && html` ${formatHtml(t('lifts.out'), { lifts: liftNames(out) })}`}</p>`;
    });
    const source = externalLink({ href: STASY_PAGE[language] }, format(t('lifts.source'), { time: athensTime(lifts.fetched) }), t('shell.new-tab'));
    return notice(closed ? 'warn' : 'info', 'step-free', html`${lines}<p class="lift-source mb-0">${source}</p>`, 'lift-notice mb-3');
}

// The same in a sentence, for screen readers (plain text): '' when there's none
/** @param {any} lifts @param {string[]} ids @param {(id: string) => string} nameOf */
export function liftSummary(lifts, ids, nameOf) {
    return affected(lifts, ids).map(id => format(t(`lifts.${lifts.stations[id].status}`), { station: nameOf(id) })).join(' ');
}

// A few words for a station in the search suggestions, and whether it can't
// be reached step-free; null when its lifts work
/** @param {any} lifts @param {string} id @returns {{ text: string, closed: boolean } | null} */
export function liftWords(lifts, id) {
    const [station] = affected(lifts, [id]);
    if (!station) return null;
    const { status } = lifts.stations[station];
    return { text: t(`lifts.${status}-short`), closed: status === 'closed' };
}

// A station page's warning (server/views/stations/station.hbs): its
// #lift-status, filled once the lifts are known. Run once per page (shell.js).
export function startStationLifts() {
    const slot = document.getElementById('lift-status');
    if (!slot) return;
    const { station, name } = slot.dataset;
    const lifts = watchLifts(() => setHtml(slot, liftNotice(lifts(), [station], () => name)));
    lifts();
    // Opened offline: asked once the connection is back
    addEventListener('online', () => lifts());
}
