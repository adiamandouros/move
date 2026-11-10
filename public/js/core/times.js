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

/** @param {TimeTier} tier @param {unknown} content @param {string} [title] @returns {import('./html.js').Html} */
export function timeBadge(tier, content, title = '') {
    return html`<span class="time-badge time-${tier}"${title && html` title="${title}"`}>${content}</span>`;
}

// Minutes, as Wayhop writes them on every page (DESIGN.md, "Type"): "7'" on
// screen, never ′ or "min", and "7 minutes" for screen readers, which don't
// hear the mark. A range: "16–19'", "16 to 19 minutes". about: a guess (a
// walk, a trip's total), "~7'" and "about 7 minutes". then: more words for
// screen readers after the minutes (", arriving soon"). t: the page's strings
// (/js/core/i18n.js in the browser, a view's on the server)
/** @typedef {number | [number, number]} Minutes */
/** @param {Minutes} minutes @param {(key: string) => string} t @param {boolean} [about] @returns {string} */
export function minutesWords(minutes, t, about = false) {
    const words = Array.isArray(minutes)
        ? format(t('shell.minutes-range'), { low: minutes[0], high: minutes[1] })
        : format(t(minutes === 1 ? 'shell.minute' : 'shell.minutes'), { minutes });
    return about ? format(t('shell.about'), { what: words }) : words;
}

/** @param {Minutes} minutes @param {(key: string) => string} t @param {{ about?: boolean, then?: string }} [options] @returns {import('./html.js').Html} */
export function minutesMark(minutes, t, { about = false, then = '' } = {}) {
    const shown = Array.isArray(minutes) ? `${minutes[0]}–${minutes[1]}` : minutes;
    return html`<span aria-hidden="true">${about ? '~' : ''}${shown}'</span><span class="sr-only">${minutesWords(minutes, t, about)}${then}</span>`;
}

// A clock time that's a guess, from a timetable (decision 11): "~12:06" on
// screen, "about 12:06" for screen readers, the "~" being its warning
/** @param {string} time @param {(key: string) => string} t @returns {import('./html.js').Html} */
export const aboutTime = (time, t) => html`<span aria-hidden="true">~${time}</span><span class="sr-only">${format(t('shell.about'), { what: time })}</span>`;

// A bus coming in `minutes`, as its badge: "7'" in the colour of how soon,
// and ", arriving soon" for screen readers when it's due
/** @param {number} minutes @param {(key: string) => string} t */
export function minutesBadge(minutes, t) {
    const tier = soonTier(minutes);
    return timeBadge(tier, minutesMark(minutes, t, { then: tier === 'due' ? `, ${t('shell.arriving-soon')}` : '' }));
}
