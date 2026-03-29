// ── Shared location module ──────────────────────────────────────────────────
//
// Manages a single watchPosition for the whole app.
// Tools subscribe to receive coordinate updates instead of managing their own
// geolocation calls. Tracking is automatically paused after the app has been
// in the background for BACKGROUND_TIMEOUT_MS, and restarted on return.

const BACKGROUND_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes

let watchId = null;
let currentCoords = null;
let backgroundTimer = null;

const subscribers = new Set();

// ── Internal ────────────────────────────────────────────────────────────────

function onPosition(pos) {
    currentCoords = { lat: pos.coords.latitude, lng: pos.coords.longitude };
    subscribers.forEach(fn => fn(currentCoords));
}

function onError(err) {
    console.warn('Location watch error:', err.message);
}

function startWatch() {
    if (watchId !== null) return;
    if (!navigator.geolocation) return;
    watchId = navigator.geolocation.watchPosition(onPosition, onError, {
        enableHighAccuracy: true,
    });
}

function stopWatch() {
    if (watchId === null) return;
    navigator.geolocation.clearWatch(watchId);
    watchId = null;
}

// ── Visibility handling ──────────────────────────────────────────────────────

document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
        // App went to background — start the timeout
        backgroundTimer = setTimeout(() => {
            stopWatch();
            backgroundTimer = null;
        }, BACKGROUND_TIMEOUT_MS);
    } else {
        // App came back to foreground
        if (backgroundTimer !== null) {
            // Returned before timeout — cancel it, tracking was never stopped
            clearTimeout(backgroundTimer);
            backgroundTimer = null;
        } else if (watchId === null) {
            // Returned after timeout — tracking was stopped, restart it and
            // notify all subscribers to refresh with the new position
            startWatch();
        }
    }
});

// ── Public API ───────────────────────────────────────────────────────────────

/** Start tracking. Call once from app.js on startup. */
export function initLocation() {
    startWatch();
}

/**
 * Get the current coords immediately if available, or wait for the first fix.
 * Returns a Promise<{lat, lng}>.
 */
export function getCoords() {
    if (currentCoords) return Promise.resolve(currentCoords);

    // No fix yet — wait for the first watchPosition callback
    return new Promise((resolve, reject) => {
        if (!navigator.geolocation) {
            reject(new Error('Geolocation is not supported by your browser.'));
            return;
        }

        // One-shot listener
        const onFirst = coords => {
            subscribers.delete(onFirst);
            resolve(coords);
        };

        // Also handle the case where watchPosition itself errors before firing
        const errorId = navigator.geolocation.getCurrentPosition(
            () => {}, // success handled by watchPosition
            err => {
                subscribers.delete(onFirst);
                reject(err);
            }
        );

        subscribers.add(onFirst);
        // Ensure tracking is running (may have been stopped in background)
        startWatch();
    });
}

/**
 * Subscribe to coordinate updates. The callback fires every time the device
 * detects a position change. Returns an unsubscribe function.
 */
export function subscribeToLocation(fn) {
    subscribers.add(fn);
    return () => subscribers.delete(fn);
}
