// The trip set on the Trip page is kept on the device for KEEP_MS since it
// was last changed or followed (decisions 52 and 58), so the page shows it
// again when the rider comes back, after Android has closed the app too.
// What's kept of each end is the place as search found it, so it's chosen
// again in the page's language and on the network it plans on now; My
// location isn't kept as an end, as the page starts from where the rider
// is by itself. Once the rider has left on a ride followed from My
// location, the ride is kept too (decision 58): where and for when it was
// planned, the way's steps and where the rider was on them, so the page
// takes it up again rather than planning anew from where they are. A way
// the rider took from the other ways is kept too (decision 64): before they
// leave by its key, so it's shown first again; on a ride, the way switched
// to itself, with the ride, as it can't be searched again from the start. No DOM, so it's tested in Node; main.js follows.

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

// A ride as keepRide keeps it, or null for anything else (an older or broken copy)
const rideOf = ride => typeof ride?.from?.lat === 'number' && typeof ride.from.lng === 'number' && typeof ride.key === 'string'
    && Array.isArray(ride.steps) && typeof ride.state?.step === 'number' && typeof ride.now?.seconds === 'number' && typeof ride.at === 'number' ? { ...ride, switched: switchedOf(ride.switched) } : null;
// The way switched to on the ride (decision 64): the way found ahead itself
// (buses.js Ahead) and whose it was, the switch's or the rider's pick
const switchedOf = switched => typeof switched?.way?.key === 'string' && typeof switched.way.leg === 'number' && Array.isArray(switched.way.way?.legs)
    && (switched.by === 'quicker' || switched.by === 'picked') ? switched : null;

const endsOf = ({ from, to }) => JSON.stringify({ from: from ?? null, to: to ?? null });

/**
 * Keep the trip's ends, each the place found or null; neither forgets it.
 * The same ends keep the time they were first kept, the ride followed on
 * them and the way picked; other ends drop them
 * @param {{ from: object | null, to: object | null }} trip
 * @param {number} nowMs
 */
export function keepTrip({ from, to }, nowMs) {
    if (!from && !to) { storage.remove(); return; }
    const kept = read();
    const same = kept && endsOf(kept) === endsOf({ from, to });
    storage.set(JSON.stringify({ at: same ? kept.at : nowMs, from, to, ...same && kept.ride && { ride: kept.ride }, ...same && kept.picked && { picked: kept.picked } }));
}

/**
 * Keep the way the rider took from the other ways on the trip kept, by its
 * key (decision 64), or null for the half hour's own again: a change to the
 * trip, so it's kept 3 hours from now. Nothing without a trip kept
 * @param {string | null} key
 * @param {number} nowMs
 */
export function keepPicked(key, nowMs) {
    const kept = read();
    if (!kept) return;
    delete kept.picked;
    storage.set(JSON.stringify(key ? { ...kept, at: nowMs, picked: key } : kept));
}

/**
 * Keep the ride followed on the trip kept, or null for none: kept as long
 * as the trip, which following it keeps from growing old. Nothing without a
 * trip kept
 * @param {object | null} ride
 * @param {number} nowMs
 */
export function keepRide(ride, nowMs) {
    const kept = read();
    if (!kept) return;
    delete kept.ride;
    storage.set(JSON.stringify(ride ? { ...kept, at: nowMs, ride } : kept));
}

/**
 * The trip kept, { from, to, ride, picked }, or null when there's none or
 * it's too old; `ride` is null when none was followed, `picked` when no way
 * was taken from the other ways
 * @param {number} nowMs
 */
export function keptTrip(nowMs) {
    const kept = read();
    if (kept && nowMs - kept.at < KEEP_MS && (kept.from || kept.to)) return { from: kept.from ?? null, to: kept.to ?? null, ride: rideOf(kept.ride), picked: typeof kept.picked === 'string' ? kept.picked : null };
    storage.remove();
    return null;
}

export const forgetTrip = () => storage.remove();
