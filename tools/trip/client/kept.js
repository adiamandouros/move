// The trip set on the Trip page is kept on the device for KEEP_MS since it
// was last changed (decision 52), so the page shows it again when the rider
// comes back, after Android has closed the app too. What's kept of each end is the place as
// search found it, so it's chosen again in the page's language and on the
// network it plans on now; My location isn't kept, as the page starts from
// where the rider is by itself. No DOM, so it's tested in Node; main.js
// follows.

export const KEEP_MS = 3 * 3_600_000;
const KEY = 'trip';

// localStorage can be missing or blocked (private windows, some settings)
const storage = {
    get: () => { try { return localStorage.getItem(KEY); } catch { return null; } },
    set: value => { try { localStorage.setItem(KEY, value); } catch { /* not kept: the page starts over */ } },
    remove: () => { try { localStorage.removeItem(KEY); } catch { /* nothing kept */ } },
};

function read() {
    try {
        const kept = JSON.parse(storage.get());
        return kept && typeof kept.at === 'number' ? kept : null;
    } catch {
        return null;
    }
}

/**
 * Keep the trip's ends, each the place found or null; neither forgets it.
 * The same ends keep the time they were first kept
 * @param {{ from: object | null, to: object | null }} trip
 * @param {number} nowMs
 */
export function keepTrip({ from, to }, nowMs) {
    if (!from && !to) { storage.remove(); return; }
    const ends = JSON.stringify({ from, to });
    const kept = read();
    const same = kept && JSON.stringify({ from: kept.from, to: kept.to }) === ends;
    storage.set(JSON.stringify({ at: same ? kept.at : nowMs, from, to }));
}

/**
 * The trip kept, { from, to }, or null when there's none or it's too old
 * @param {number} nowMs
 */
export function keptTrip(nowMs) {
    const kept = read();
    if (kept && nowMs - kept.at < KEEP_MS && (kept.from || kept.to)) return { from: kept.from ?? null, to: kept.to ?? null };
    storage.remove();
    return null;
}

export const forgetTrip = () => storage.remove();
