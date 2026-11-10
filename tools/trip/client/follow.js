import { distanceMeters } from '/js/core/geo.js';

// My location follows the rider (DESIGN.md, "Start from here"): the trip is
// planned again from where they are once they're MOVED_METRES from where it
// was last planned, and no sooner than REPLAN_MS after it. How often is
// agreed for OASA's sake (11 Nov 2026, decision 45). No DOM, so it's tested
// in Node; main.js follows.

export const MOVED_METRES = 200;
export const REPLAN_MS = 2 * 60_000;

/**
 * Whether to plan the trip again from `position`, `planned` being where it
 * was last planned from and when (ms)
 * @param {{ lat: number, lng: number, at: number }} planned
 * @param {{ lat: number, lng: number }} position
 * @param {number} nowMs
 */
export const replanDue = (planned, position, nowMs) => nowMs - planned.at >= REPLAN_MS
    && distanceMeters(planned.lat, planned.lng, position.lat, position.lng) >= MOVED_METRES;
