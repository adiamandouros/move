import { closableNotice, externalLink, format, formatHtml, html, localName, setHtml } from './html.js';
import { language, t } from './i18n.js';
import { lineEnd, liftCaution, liftsOpen, STASY_LIFTS_PAGE } from './metro.js';

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

// Every platform of a station: [{ line, dir, station }], one per direction
// of each of its lines
/** @param {any} rail @param {string} id */
export const stationPlatforms = (rail, id) => Object.entries(rail.lines).flatMap(([line, { directions }]) => Object.keys(directions)
    .filter(dir => directions[dir].stops.some(stop => stop.station === id))
    .map(dir => ({ line, dir, station: id })));

// The platforms among `platforms` ([{ line, dir, station }]) that can't be
// reached without steps (positions.json's stepFree: 'no'), each once:
// [{ station, toward }], toward: where its trains go, in the page's language
/** @param {any} rail @param {{ line: string, dir: string, station: string }[]} platforms */
export function stepFreeGaps(rail, platforms) {
    const seen = new Set();
    return platforms.filter(({ line, dir, station }) => {
        const key = `${line}/${dir}/${station}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return rail.lines[line]?.directions[dir]?.stops.find(stop => stop.station === station)?.stepFree === 'no';
    }).map(({ line, dir, station }) => ({ station, toward: localName(rail.stations[lineEnd(rail, line, dir)].name, language) }));
}

// One notice for the platforms with no step-free access (`gaps`, from
// stepFreeGaps) and the stations among `ids` with lifts out: a warning when
// one can't be reached step-free, else for information. '' when there's none.
// nameOf(id): the station's name in the page's language. It can be closed to
// its first line, which names the stations ("Step-free access: Kifisia,
// Aigaleo"), and stays closed on every page until opened again
// (rememberClosed in metro.js); open: whether it is (liftsOpen()).
/**
 * @param {any} lifts @param {string[]} ids @param {(id: string) => string} nameOf
 * @param {{ station: string, toward: string }[]} [gaps] @param {boolean} [open]
 */
export function liftNotice(lifts, ids, nameOf, gaps = [], open = true) {
    const stations = affected(lifts, ids);
    if (!stations.length && !gaps.length) return '';
    const closed = gaps.length > 0 || stations.some(id => lifts.stations[id].status === 'closed');
    const steps = gaps.map(({ station, toward }) => html`<p class="mb-1">${formatHtml(t('lifts.no-step-free'), { station: html`<strong>${nameOf(station)}</strong>`, toward })}</p>`);
    const lines = stations.map(id => {
        const { status, out } = lifts.stations[id];
        const what = formatHtml(t(`lifts.${status}`), { station: html`<strong>${nameOf(id)}</strong>` });
        return html`<p class="mb-1">${what}${out.length > 0 && html` ${formatHtml(t('lifts.out'), { lifts: liftNames(out) })}`}</p>`;
    });
    // Where the lifts out of service come from; with only platforms that
    // have steps, that lifts can stop working too, and where to see which have
    const source = html`<p class="lift-source mb-0">${stations.length > 0
        ? externalLink({ href: STASY_LIFTS_PAGE[language] }, format(t('lifts.source'), { time: athensTime(lifts.fetched) }), t('shell.new-tab'))
        : liftCaution(language, t)}</p>`;
    const names = [...new Set([...gaps.map(g => g.station), ...stations])].map(nameOf).join(', ');
    return closableNotice(closed ? 'warn' : 'info', 'step-free', format(t('lifts.summary'), { stations: names }), html`${steps}${lines}${source}`, 'lift-notice mb-3', open);
}

// The same in a sentence, for screen readers (plain text): '' when there's none
/**
 * @param {any} lifts @param {string[]} ids @param {(id: string) => string} nameOf
 * @param {{ station: string, toward: string }[]} [gaps]
 */
export function liftSummary(lifts, ids, nameOf, gaps = []) {
    return [
        ...gaps.map(({ station, toward }) => format(t('lifts.no-step-free'), { station: nameOf(station), toward })),
        ...affected(lifts, ids).map(id => format(t(`lifts.${lifts.stations[id].status}`), { station: nameOf(id) })),
    ].join(' ');
}

// A few words for a station in the search suggestions, and whether it can't
// be reached step-free; null when it can, as far as is known. Its lifts out
// of service come first, then its platforms with steps only (`gaps`).
/**
 * @param {any} lifts @param {string} id @param {{ station: string, toward: string }[]} [gaps]
 * @returns {{ text: string, closed: boolean } | null}
 */
export function liftWords(lifts, id, gaps = []) {
    const [station] = affected(lifts, [id]);
    if (station && lifts.stations[station].status === 'closed') return { text: t('lifts.closed-short'), closed: true };
    if (gaps.length) return { text: format(t('lifts.no-step-free-short'), { toward: gaps.map(g => g.toward).join(', ') }), closed: true };
    return station ? { text: t('lifts.partial-short'), closed: false } : null;
}

// A station page's warning (server/views/stations/station.hbs): its
// #lift-status, filled once the lifts are known. Run once per page (shell.js).
export function startStationLifts() {
    const slot = document.getElementById('lift-status');
    if (!slot) return;
    const { station, name } = slot.dataset;
    const lifts = watchLifts(() => setHtml(slot, liftNotice(lifts(), [station], () => name, [], liftsOpen())));
    lifts();
    // Opened offline: asked once the connection is back
    addEventListener('online', () => lifts());
}
