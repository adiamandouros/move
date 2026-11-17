import { format, html } from './html.js';

// How Wayhop shows when something leaves: one badge, bus and train alike
// (DESIGN.md, "Time badge"). Its colour is how soon:
//   due      3 minutes or less: solid green
//   close    4 to 8: a green tint
//   later    9 or more, and every clock time: neutral
// and, for trains only, the last train is red and the second to last amber,
// whatever the minutes; their words go with them (the badge's own text for
// screen readers, a visible line under the trains). Never colour alone.

const DUE_MINUTES = 3;
const CLOSE_MINUTES = 8;

/** @typedef {'due' | 'close' | 'later' | 'second-last' | 'last'} TimeTier */

/** @param {number} minutes @returns {TimeTier} */
export const soonTier = minutes => minutes <= DUE_MINUTES ? 'due' : minutes <= CLOSE_MINUTES ? 'close' : 'later';

/** @param {TimeTier} tier @param {unknown} content @param {string} [title] @param {unknown} [data] its data- attributes @returns {import('./html.js').Html} */
export function timeBadge(tier, content, title = '', data = '') {
    return html`<span class="time-badge time-${tier}"${title && html` title="${title}"`}${data}>${content}</span>`;
}

// Every time counts down by itself (decision 61): a badge shown keeps
// counting, signal or not, until a fresh answer draws it again, and is
// gone once it would read -1'. A timetable's time is to the second
// (`exact`): 4'30" away reads 4', and it goes as it leaves. OASA's is whole
// minutes: "2'" reads 0' for the minute after its time, as the Buses page
// counts it (timing.js countDown, the same rule in minutes). `at` and `now`
// in seconds, from the same origin. Null once gone
/** @param {number} at @param {number} now @param {boolean} [exact] @returns {number | null} */
export function minutesLeft(at, now, exact = false) {
    const left = (at - now) / 60;
    // || 0: no -0 from ceil
    const minutes = (exact ? Math.floor(left) : Math.ceil(left)) || 0;
    return minutes < 0 ? null : minutes;
}

// `at`, seconds from the midnight `now` counts from, as seconds since 1970,
// for a badge to count on to; null with no `epoch` (the server, tests)
/** @param {number} at @param {{ seconds: number, epoch?: number | null }} now @returns {number | null} */
export const epochAt = (at, { seconds, epoch = null }) => epoch === null ? null : epoch + at - seconds;

// Minutes, as Wayhop writes them on every page (DESIGN.md, "Type"): "7'" on
// screen, never ′ or "min", and "7 minutes" for screen readers, which don't
// hear the mark. A range: "16–19'", "16 to 19 minutes". about: a guess (a
// walk, a trip's total), "~7'" and "about 7 minutes". then: more words for
// screen readers after the minutes (", arriving soon"). said: the sentence
// screen readers hear them in ("next in {minutes}"). t: the page's strings
// (/js/core/i18n.js in the browser, a view's on the server)
/** @typedef {number | [number, number]} Minutes */
/** @param {Minutes} minutes @param {(key: string) => string} t @param {boolean} [about] @returns {string} */
export function minutesWords(minutes, t, about = false) {
    const words = Array.isArray(minutes)
        ? format(t('shell.minutes-range'), { low: minutes[0], high: minutes[1] })
        : format(t(minutes === 1 ? 'shell.minute' : 'shell.minutes'), { minutes });
    return about ? format(t('shell.about'), { what: words }) : words;
}

/** @param {Minutes} minutes @param {(key: string) => string} t @param {{ about?: boolean, then?: string, said?: string }} [options] @returns {import('./html.js').Html} */
export function minutesMark(minutes, t, { about = false, then = '', said = '{minutes}' } = {}) {
    const shown = Array.isArray(minutes) ? `${minutes[0]}–${minutes[1]}` : minutes;
    return html`<span aria-hidden="true">${about ? '~' : ''}${shown}'</span><span class="sr-only">${format(said, { minutes: minutesWords(minutes, t, about) })}${then}</span>`;
}

// A clock time that's a guess, from a timetable (decision 11): "~12:06" on
// screen, "about 12:06" for screen readers, the "~" being its warning
/** @param {string} time @param {(key: string) => string} t @returns {import('./html.js').Html} */
export const aboutTime = (time, t) => html`<span aria-hidden="true">~${time}</span><span class="sr-only">${format(t('shell.about'), { what: time })}</span>`;

// Something coming in `minutes`, as its badge: "7'" in the colour of how
// soon, or `tier` whatever the minutes (the last train), and ", arriving
// soon" for screen readers when a bus is due (`soon`). said and then: as for
// minutesMark ("next in {minutes}"); title: the badge's words. at: when it
// comes, seconds since 1970 (epochAt), for countBadges() to count it on,
// `exact` as minutesLeft; it keeps how it was drawn, to draw it again so
/**
 * @param {number} minutes @param {(key: string) => string} t
 * @param {{ said?: string, then?: string, tier?: TimeTier | null, soon?: boolean, title?: string, at?: number | null, exact?: boolean }} [options]
 */
export function minutesBadge(minutes, t, { said = '{minutes}', then = '', tier = null, soon = true, title = '', at = null, exact = false } = {}) {
    const shown = tier ?? soonTier(minutes);
    const data = at !== null && html` data-at="${at}" data-minutes="${minutes}"${exact && html` data-exact`}${said !== '{minutes}' && html` data-said="${said}"`}${then && html` data-then="${then}"`}${tier && html` data-tier="${tier}"`}${!soon && html` data-quiet`}`;
    return timeBadge(shown, minutesMark(minutes, t, { said, then: `${then}${soon && shown === 'due' ? `, ${t('shell.arriving-soon')}` : ''}` }), title, data);
}

// Counts on every badge under `root` that has its time (minutesBadge's
// `at`) to `now` (seconds since 1970): drawn again as its minute changes,
// removed once gone. Badges only, so the keyboard and the scroll stay where
// they are, and it counts while the page holds its redraws. Whether any
// went: what came after it may need the page's own redraw (the next bus
// moving up)
/** @param {ParentNode} root @param {(key: string) => string} t @param {number} [now] @returns {boolean} */
export function countBadges(root, t, now = Date.now() / 1000) {
    let gone = false;
    for (const badge of /** @type {NodeListOf<HTMLElement>} */ (root.querySelectorAll('.time-badge[data-at]'))) {
        const { at, minutes: was, exact, said, then, tier, quiet } = badge.dataset;
        const minutes = minutesLeft(Number(at), now, exact !== undefined);
        if (minutes === null) {
            badge.remove();
            gone = true;
        } else if (minutes !== Number(was)) {
            badge.outerHTML = String(minutesBadge(minutes, t, { at: Number(at), exact: exact !== undefined, said, then, tier: /** @type {TimeTier | undefined} */ (tier) ?? null, soon: quiet === undefined, title: badge.title }));
        }
    }
    return gone;
}
