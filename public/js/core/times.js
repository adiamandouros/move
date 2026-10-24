import { html } from './html.js';

// How Wayhop shows when something leaves: one badge, bus and train alike
// (DESIGN.md, "Time badge"). Its colour is how soon:
//   due      3 minutes or less: solid green
//   close    4 to 8: a green tint
//   later    9 or more, and every clock time: neutral
// and, for trains only, the last train is red and the second to last amber,
// whatever the minutes; their words go with them (the badge's own text for
// screen readers, a visible line under the trains). Never colour alone.

export const DUE_MINUTES = 3;
export const CLOSE_MINUTES = 8;

/** @typedef {'due' | 'close' | 'later' | 'second-last' | 'last'} TimeTier */

/** @param {number} minutes @returns {TimeTier} */
export const soonTier = minutes => minutes <= DUE_MINUTES ? 'due' : minutes <= CLOSE_MINUTES ? 'close' : 'later';

/** @param {TimeTier} tier @param {unknown} content @param {string} [title] @returns {import('./html.js').Html} */
export function timeBadge(tier, content, title = '') {
    return html`<span class="time-badge time-${tier}"${title && html` title="${title}"`}>${content}</span>`;
}
