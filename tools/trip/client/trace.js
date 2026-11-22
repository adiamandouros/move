import { announce, format, html, setHtml } from '/js/core/html.js';
import { t } from '/js/core/i18n.js';
import { ROUGH_METRES } from './follow.js';

// The trace of a ride, to learn what positions a phone gets underground
// (roadmap Signal, decision 69). /trip?trace turns it on, and it stays on,
// the app opened again included, until "Stop and delete". Every position
// the page gets is written down with how exact the phone said it was, and
// so are the stations the rider marks as the doors open (what really
// happened, to score a rule against), the page hidden and shown, location
// problems, and the way followed with where follow.js placed the rider on
// it after each position. It's kept on the phone only, until saved as a
// file by the rider; nothing is sent anywhere. Off, nothing is kept.

// The trace, and that it's on
const TRACE_KEY = 'trip-trace';
const TRACE_ON_KEY = 'trip-trace-on';
// About three hours of positions every second: the oldest go first
export const MAX_ENTRIES = 10_000;
// Kept on the phone at most this often while positions come in, and at once
// on a station marked, the page hidden or the trace saved
const KEEP_MS = 5_000;

/**
 * One thing written down, `at` when it happened (ms): a position (`got`:
 * when it reached the page, as a phone can hand over an older one), a
 * station marked (the `count`th), the page hidden or shown, a location
 * problem, the way followed (follow.js's steps, each time it's another
 * way), or where the rider was placed on it after a position
 * @typedef {{ kind: 'fix', at: number, got: number, lat: number, lng: number, accuracy: number | null, speed: number | null }
 *   | { kind: 'station', at: number, count: number }
 *   | { kind: 'hidden' | 'visible', at: number }
 *   | { kind: 'problem', at: number, problem: string }
 *   | { kind: 'way', at: number, steps: import('./follow.js').Step[] }
 *   | { kind: 'placed', at: number, left: boolean, step: number, stop: number, any: number | null, off: boolean }} Entry
 */

/**
 * `entries` with `entry` after them, the oldest dropped past MAX_ENTRIES
 * @param {Entry[]} entries @param {Entry} entry @returns {Entry[]}
 */
export const added = (entries, entry) => [...entries.length >= MAX_ENTRIES ? entries.slice(entries.length - MAX_ENTRIES + 1) : entries, entry];

/**
 * What the trace holds, for its panel: positions, how many of them rougher
 * than follow.js uses (ROUGH_METRES), the last one's accuracy (null before
 * any, or when the phone didn't say) and the stations marked
 * @param {Entry[]} entries
 */
export function summary(entries) {
    const fixes = entries.flatMap(e => e.kind === 'fix' ? [e] : []);
    return {
        fixes: fixes.length,
        rough: fixes.filter(f => f.accuracy !== null && f.accuracy > ROUGH_METRES).length,
        accuracy: fixes.length ? fixes[fixes.length - 1].accuracy : null,
        stations: entries.filter(e => e.kind === 'station').length,
    };
}

/**
 * The file a trace is saved as: what it is, when it was saved (`savedMs`),
 * on what browser, follow.js's limit then, and everything written down
 * @param {Entry[]} entries @param {number} savedMs @param {string} browser
 */
export const traceFile = (entries, savedMs, browser) => ({ wayhop: 'trace', version: 1, saved: new Date(savedMs).toISOString(), browser, roughMetres: ROUGH_METRES, entries });

/**
 * The file's name, by when it was saved (UTC): wayhop-trace-20261122-1330Z.json
 * @param {number} savedMs
 */
export const fileName = savedMs => `wayhop-trace-${new Date(savedMs).toISOString().slice(0, 16).replace(/[-:]/g, '').replace('T', '-')}Z.json`;

// localStorage can be missing or blocked: the trace is then this page's only
const storage = {
    /** @param {string} key */
    get: key => { try { return localStorage.getItem(key); } catch { return null; } },
    /** @param {string} key @param {string} value */
    set: (key, value) => { try { localStorage.setItem(key, value); } catch { /* full or blocked: kept in the page */ } },
    /** @param {string} key */
    remove: key => { try { localStorage.removeItem(key); } catch { /* nothing kept */ } },
};

/** @returns {Entry[]} */
function keptEntries() {
    try {
        const kept = JSON.parse(storage.get(TRACE_KEY) ?? '[]');
        return Array.isArray(kept) ? kept : [];
    } catch {
        return [];
    }
}

/**
 * The trace, when it's on: turned on by ?trace in the page's address (taken
 * out of it, so the address can be shared as it was), kept on until stopped.
 * Its panel goes after `after`. `followed` says what's followed now (the
 * controller's). Null when it's off
 * @param {HTMLElement} after
 * @param {() => { steps: import('./follow.js').Step[], state: import('./follow.js').State, left: boolean } | null} followed
 */
export function startTrace(after, followed) {
    const address = new URL(location.href);
    if (address.searchParams.has('trace')) {
        storage.set(TRACE_ON_KEY, '1');
        address.searchParams.delete('trace');
        history.replaceState(history.state, '', address);
    }
    if (!storage.get(TRACE_ON_KEY)) return null;

    let entries = keptEntries();
    // Stopped and deleted: nothing more is written down
    let stopped = false;
    /** @type {ReturnType<typeof setTimeout> | undefined} */
    let keepTimer;
    const keep = () => {
        clearTimeout(keepTimer);
        keepTimer = undefined;
        storage.set(TRACE_KEY, JSON.stringify(entries));
    };
    const keepSoon = () => { keepTimer ??= setTimeout(keep, KEEP_MS); };
    // The way followed, written down again only when it's another
    /** @type {import('./follow.js').Step[] | null} */
    let way = null;

    const box = document.createElement('section');
    box.id = 'trip-trace';
    box.className = 'trip-card trip-trace';
    box.setAttribute('aria-labelledby', 'trip-trace-title');
    setHtml(box, html`<h2 class="route-option-label" id="trip-trace-title">${t('trip.trace-title')}</h2>
        <p class="trip-other" id="trip-trace-counts"></p>
        <div class="trip-trace-actions">
            <button type="button" id="trip-trace-station" class="btn btn-primary btn-sm rounded-pill px-4">${t('trip.trace-station')}</button>
            <button type="button" id="trip-trace-save" class="btn btn-sm locate-btn">${t('trip.trace-save')}</button>
            <button type="button" id="trip-trace-stop" class="btn btn-sm locate-btn">${t('trip.trace-stop')}</button>
        </div>
        <p class="trip-other">${t('trip.trace-note')}</p>`);
    after.after(box);
    const counts = /** @type {HTMLElement} */ (box.querySelector('#trip-trace-counts'));
    // Not said as it changes, every second or so: read when wanted
    const show = () => {
        const { fixes, rough, accuracy, stations } = summary(entries);
        counts.textContent = format(t('trip.trace-counts'), { fixes, rough, metres: ROUGH_METRES, accuracy: accuracy === null ? '–' : Math.round(accuracy), stations });
    };
    show();
    /** @param {Entry} entry */
    const write = entry => {
        entries = added(entries, entry);
        show();
    };

    /** @type {HTMLElement} */ (box.querySelector('#trip-trace-station')).addEventListener('click', () => {
        const count = summary(entries).stations + 1;
        write({ kind: 'station', at: Date.now(), count });
        keep();
        announce(format(t('trip.trace-station-said'), { count }));
    });
    /** @type {HTMLElement} */ (box.querySelector('#trip-trace-save')).addEventListener('click', () => {
        keep();
        const now = Date.now();
        const link = document.createElement('a');
        link.href = URL.createObjectURL(new Blob([JSON.stringify(traceFile(entries, now, navigator.userAgent))], { type: 'application/json' }));
        link.download = fileName(now);
        link.click();
        setTimeout(() => URL.revokeObjectURL(link.href), 60_000);
    });
    /** @type {HTMLElement} */ (box.querySelector('#trip-trace-stop')).addEventListener('click', () => {
        if (!confirm(t('trip.trace-stop-confirm'))) return;
        clearTimeout(keepTimer);
        stopped = true;
        storage.remove(TRACE_KEY);
        storage.remove(TRACE_ON_KEY);
        entries = [];
        box.remove();
        announce(t('trip.trace-stopped'));
    });

    document.addEventListener('visibilitychange', () => {
        if (stopped) return;
        write({ kind: document.hidden ? 'hidden' : 'visible', at: Date.now() });
        if (document.hidden) keep();
    });

    return {
        /**
         * A position, once the controller has placed the rider with it
         * @param {import('/js/core/location.js').Position} position
         */
        fix(position) {
            if (stopped) return;
            const got = Date.now();
            write({ kind: 'fix', at: position.at, got, lat: position.lat, lng: position.lng, accuracy: position.accuracy, speed: position.speed });
            const now = followed();
            if (now && now.steps !== way) {
                way = now.steps;
                write({ kind: 'way', at: got, steps: now.steps });
            }
            if (now) write({ kind: 'placed', at: got, left: now.left, step: now.state.step, stop: now.state.stop, any: now.state.any, off: now.state.off });
            keepSoon();
        },
        /** @param {string} problem */
        problem(problem) {
            if (stopped) return;
            write({ kind: 'problem', at: Date.now(), problem });
            keepSoon();
        },
    };
}
