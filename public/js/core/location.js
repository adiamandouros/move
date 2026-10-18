// The device's location, shared by the pages that use it (Buses, Subway).
//
// - Only pages that need it start it, so the browser asks for permission
//   once, where it's clear why: when the bus page opens (after a "Use my
//   location" tap the very first time), or on the subway page's "Nearest
//   station". Pages that don't need it never ask.
// - The last position is kept on this device for KEEP_MS, so the next page
//   has it at once, even without a signal (underground, offline), and
//   refines it as new positions come in.
// - Nothing waits for it: pages show what they can without it and update
//   when it comes. A position that's slow to come is reported, not waited on.

// { lat, lng, at } of the last position (rounded to about 10 m)
const KEY = 'location';
// Set once a position has come, so pages can start without asking again
// (some browsers keep reporting "prompt" after someone allowed it)
const ALLOWED_KEY = 'location-allowed';
const KEEP_MS = 10 * 60_000;
// No position after this long: tell the pages (they keep waiting, though)
const SLOW_MS = 20_000;
// Stop following the location after the page has been hidden this long
const BACKGROUND_TIMEOUT_MS = 10 * 60_000;
// A precise GPS fix can take 5–15 s indoors, so also ask for a quick one: a
// recent or approximate position the phone already has
const QUICK_FIX = { enableHighAccuracy: false, maximumAge: 5 * 60_000, timeout: 10_000 };

let watchId = null;
let wanted = false;
let current = null;
let slowTimer = null;
let backgroundTimer = null;
const positionListeners = new Set();
const problemListeners = new Set();

// localStorage can be missing or blocked (private windows, some settings)
const storage = {
    get: key => { try { return localStorage.getItem(key); } catch { return null; } },
    set: (key, value) => { try { localStorage.setItem(key, value); } catch { /* only this page has it */ } },
    remove: key => { try { localStorage.removeItem(key); } catch { /* nothing kept */ } },
};

const round = n => Math.round(n * 1e4) / 1e4;

// ── For the pages ───────────────────────────────────────────────────────────

// The last position, if it's recent enough to use: { lat, lng, at } or null
export function lastPosition() {
    const fresh = position => position && Date.now() - position.at < KEEP_MS;
    if (fresh(current)) return current;
    let saved = null;
    try { saved = JSON.parse(storage.get(KEY)); } catch { /* not a position */ }
    if (fresh(saved)) return saved;
    if (saved) storage.remove(KEY);
    return null;
}

// Whether the page can start following the location without the browser
// asking: 'granted', 'prompt' (it would ask), or 'denied'
export async function locationPermission() {
    if (!navigator.geolocation) return 'denied';
    let state = null;
    try { state = (await navigator.permissions.query({ name: 'geolocation' })).state; } catch { /* no Permissions API */ }
    if (state === 'denied') return 'denied';
    return state === 'granted' || storage.get(ALLOWED_KEY) ? 'granted' : 'prompt';
}

// Follow the location: the browser asks the first time. Positions go to
// onLocation listeners, problems to onLocationProblem listeners.
export function startLocation() {
    wanted = true;
    if (watchId !== null) return;
    if (!navigator.geolocation) {
        notifyProblem('unsupported');
        return;
    }
    clearTimeout(slowTimer);
    slowTimer = setTimeout(() => { if (!lastPosition()) notifyProblem('slow'); }, SLOW_MS);
    navigator.geolocation.getCurrentPosition(onPosition, () => {}, QUICK_FIX);
    watchId = navigator.geolocation.watchPosition(onPosition, onError, { enableHighAccuracy: true });
}

// Start again, e.g. from a "Try again" button
export function restartLocation() {
    stopWatch();
    startLocation();
}

// fn({ lat, lng, at }) for every new position. Returns a function that stops it.
export function onLocation(fn) {
    positionListeners.add(fn);
    return () => positionListeners.delete(fn);
}

// fn(problem): 'denied' (the person or browser said no), 'unavailable' (the
// device can't tell), 'slow' (no position after SLOW_MS) or 'unsupported'
export function onLocationProblem(fn) {
    problemListeners.add(fn);
    return () => problemListeners.delete(fn);
}

// ── Internal ────────────────────────────────────────────────────────────────

function onPosition(pos) {
    const at = pos.timestamp || Date.now();
    // The quick fix can be older than what the watch already gave
    if (current && at <= current.at) return;
    current = { lat: pos.coords.latitude, lng: pos.coords.longitude, at };
    clearTimeout(slowTimer);
    storage.set(KEY, JSON.stringify({ lat: round(current.lat), lng: round(current.lng), at }));
    storage.set(ALLOWED_KEY, '1');
    positionListeners.forEach(fn => fn(current));
}

function onError(err) {
    // 1: PERMISSION_DENIED, 2: POSITION_UNAVAILABLE (3, TIMEOUT, needs a timeout option)
    if (err.code === 1) {
        stopWatch();
        wanted = false;
        current = null;
        storage.remove(KEY);
        storage.remove(ALLOWED_KEY);
        notifyProblem('denied');
    } else if (err.code === 2) {
        // The watch keeps trying
        notifyProblem('unavailable');
    }
}

function notifyProblem(problem) {
    problemListeners.forEach(fn => fn(problem));
}

function stopWatch() {
    clearTimeout(slowTimer);
    if (watchId === null) return;
    navigator.geolocation.clearWatch(watchId);
    watchId = null;
}

// In the background for a while: stop the GPS, and start it again on return
document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
        backgroundTimer = setTimeout(stopWatch, BACKGROUND_TIMEOUT_MS);
    } else {
        clearTimeout(backgroundTimer);
        if (wanted && watchId === null) startLocation();
    }
});
