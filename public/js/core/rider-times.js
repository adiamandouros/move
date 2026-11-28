import { localStore } from './storage.js';

// Times measured by riders (decision 84): the rider's answer, kept on the
// device, and the reports of their rides waiting to be sent. The Trip page
// asks and measures (tools/trip/client/measure.js); the privacy page and the
// Trip page change the answer. Nothing is sent before "Yes", and "No
// thanks" drops what's waiting.

// 'yes' or 'no'; nothing until the rider answers
const ANSWER_KEY = 'rider-times';
const WAITING_KEY = 'rider-times-waiting';
// Sent a random moment up to this long after the ride, so the host's web log
// can't show when it ended
export const DELAY_MS = 15 * 60_000;
// Not sent within this (no signal, the page not opened again): dropped
export const KEEP_MS = 24 * 60 * 60_000;
export const ENDPOINT = '/api/rider-times';

/** @typedef {import('../../../tools/trip/client/measure.js').Report} Report */
/** @typedef {{ report: Report, at: number, until: number }} Waiting a report, sent from `at` (ms) and dropped at `until` */

/** The rider's answer: 'yes', 'no', or null before they've given one */
/** @returns {'yes' | 'no' | null} */
export function riderAnswer() {
    const kept = localStore.get(ANSWER_KEY);
    return kept === 'yes' || kept === 'no' ? kept : null;
}

/** @param {'yes' | 'no'} answer */
export function setRiderAnswer(answer) {
    localStore.set(ANSWER_KEY, answer);
    if (answer === 'no') localStore.remove(WAITING_KEY);
}

/** @returns {Waiting[]} */
export function waitingReports() {
    try {
        const kept = JSON.parse(localStore.get(WAITING_KEY) ?? '[]');
        return Array.isArray(kept) ? kept : [];
    } catch {
        return [];
    }
}

/** @param {Waiting[]} waiting */
export function keepWaiting(waiting) {
    if (waiting.length) localStore.set(WAITING_KEY, JSON.stringify(waiting));
    else localStore.remove(WAITING_KEY);
}

/**
 * `waiting` with `report` after it, to be sent `random` (0 to 1) of
 * DELAY_MS from `nowMs`
 * @param {Waiting[]} waiting @param {Report} report @param {number} nowMs @param {number} random
 * @returns {Waiting[]}
 */
export const withReport = (waiting, report, nowMs, random) => [...waiting, { report, at: nowMs + Math.floor(random * DELAY_MS), until: nowMs + KEEP_MS }];

/**
 * Which of `waiting` are due at `nowMs` and which wait on; those past their
 * day are in neither
 * @param {Waiting[]} waiting @param {number} nowMs
 */
export function dueReports(waiting, nowMs) {
    const live = waiting.filter(w => w.until > nowMs);
    return { due: live.filter(w => w.at <= nowMs), later: live.filter(w => w.at > nowMs) };
}
