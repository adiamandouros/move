import { lastPosition, locationPermission, onLocation, onLocationProblem, startLocation } from '/js/core/location.js';
import { localName, setHtml } from '/js/core/html.js';
import { language, t } from '/js/core/i18n.js';
import { remember } from '/js/core/remember.js';
import { athensNow, closestStation, isTimetableExpired, planTrip } from './network.js';
import { stationSearch } from './search.js';
import { renderMessage, renderResult, routeSummary, walkingUrl } from './render.js';

// Keeps the "in N minutes" chips current while the page is open
const REFRESH_MS = 30_000;

const result = document.getElementById('subway-result');

// rail.json is precached by the service worker, so this works offline
async function loadRail() {
    try {
        const res = await fetch('/data/rail.json');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return await res.json();
    } catch {
        setHtml(result, renderMessage('subway.data-error'));
        return null;
    }
}

function announce(message) {
    const el = document.getElementById('sr-announcer');
    if (!el) return;
    el.textContent = '';
    requestAnimationFrame(() => { el.textContent = message; });
}

function start(rail) {
    const params = new URLSearchParams(location.search);

    // `speak`: also tell screen readers, when the user changed the stations
    // (not on the 30-second refresh)
    // Slower options the user opened or closed themselves (routeKey → open),
    // kept through the refresh, forgotten when the stations change
    let opened = {};
    // Which one had the keyboard focus, to give it back after a refresh
    const focused = () => document.activeElement?.closest('#subway-result details')?.getAttribute('data-route');

    const render = ({ speak = false } = {}) => {
        const origin = from.get();
        const destination = to.get();
        if (!origin || !destination) { setHtml(result, ''); return; }
        if (origin === destination) {
            setHtml(result, renderMessage('subway.same-station'));
            if (speak) announce(t('subway.same-station'));
            return;
        }
        const today = athensNow();
        // After the last train, tomorrow's first ones
        const { plans, now, tomorrow } = planTrip(rail, origin, destination, today);
        const focus = focused();
        setHtml(result, renderResult(rail, plans, now, { expired: isTimetableExpired(rail, today), tomorrow, open: opened }));
        if (focus) /** @type {HTMLElement | null} */ (result.querySelector(`details[data-route="${CSS.escape(focus)}"] > summary`))?.focus();
        if (speak) announce(routeSummary(rail, plans, now, tomorrow));
    };

    // The selection lives in the URL (?from=syntagma&to=airport) so routes can be bookmarked and shared.
    // It's also kept for coming back to the page, but a boarding station that
    // follows the location isn't: by then it may be another one.
    const syncUrl = () => {
        const query = new URLSearchParams();
        if (from.get()) query.set('from', from.get());
        if (to.get()) query.set('to', to.get());
        const search = query.toString();
        history.replaceState(null, '', search ? `${location.pathname}?${search}` : location.pathname);
        if (followLocation) query.delete('from');
        remember('subway', query.toString());
    };

    // The signpost beside the boarding station: walking directions to it
    const walk = /** @type {HTMLAnchorElement} */ (document.getElementById('walk-btn'));
    const syncWalk = () => {
        walk.hidden = !from.get();
        if (walk.hidden) return;
        walk.href = walkingUrl(rail, from.get());
        document.getElementById('walk-station').textContent = localName(rail.stations[from.get()].name, language);
    };

    const changed = () => { opened = {}; syncUrl(); syncWalk(); render({ speak: true }); };

    // A click on a summary (also Enter or Space) comes before the toggle
    result.addEventListener('click', e => {
        const details = /** @type {Element} */ (e.target).closest?.('details[data-route]');
        if (details && /** @type {Element} */ (e.target).closest('summary')) opened[details.getAttribute('data-route')] = !details.hasAttribute('open');
    });

    // Without a station in the address, the boarding station follows the
    // user's location until they pick one themselves
    let followLocation = !params.has('from');

    const fromInput = /** @type {HTMLInputElement} */ (document.getElementById('stop-search-from'));
    const toInput = /** @type {HTMLInputElement} */ (document.getElementById('stop-search-to'));
    const from = stationSearch({
        input: fromInput,
        list: document.getElementById('stop-suggestions-from'),
        rail,
        onChange: () => { followLocation = false; changed(); },
    });
    fromInput.addEventListener('input', () => { followLocation = false; });
    const to = stationSearch({
        input: toInput,
        list: document.getElementById('stop-suggestions-to'),
        rail,
        onChange: changed,
    });

    // What was typed before this script had loaded stays, unless the address
    // names a station: it is replayed as typing, so the suggestions show
    const typed = [fromInput, toInput].map(input => input.value);
    from.set(params.get('from'), { notify: false });
    to.set(params.get('to'), { notify: false });
    [fromInput, toInput].forEach((input, i) => {
        if (!typed[i] || input.value) return;
        input.value = typed[i];
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
    });
    changed();

    document.getElementById('subway-form').addEventListener('submit', e => e.preventDefault());

    document.getElementById('swap-stations').addEventListener('click', () => {
        followLocation = false;
        const origin = from.get();
        from.set(to.get(), { notify: false });
        to.set(origin, { notify: false });
        changed();
    });

    setInterval(render, REFRESH_MS);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) render(); });

    // ── The nearest station ──
    // Set at once from a recent position (even offline, underground), then
    // from new ones while followLocation lasts. The "Nearest station" button
    // asks for it (the browser asks for the location the first time).
    const status = document.getElementById('locate-status');
    let requested = false;

    const setNearest = ({ lat, lng }, { always = false } = {}) => {
        status.textContent = '';
        const id = closestStation(rail, lat, lng);
        if (id !== from.get()) from.set(id);
        else if (!always) return;
        // (from.set counts as choosing it, so it's kept until here)
        followLocation = true;
        syncUrl();
        announce(`${t('subway.location-prefix')} ${localName(rail.stations[id].name, language)} ${t('subway.location-suffix')}`);
    };

    onLocation(position => {
        if (requested) {
            requested = false;
            setNearest(position, { always: true });
        } else if (followLocation) {
            setNearest(position);
        }
    });

    const deniedText = () => `${t('location.denied')}. ${t('location.denied-hint')}`;

    // Only said when someone pressed the button and is waiting for it
    onLocationProblem(problem => {
        if (!requested) return;
        if (problem !== 'slow') requested = false;
        status.textContent = problem === 'denied' ? deniedText() : t(`location.${problem}`);
    });

    document.getElementById('locate-btn').addEventListener('click', async () => {
        followLocation = true;
        const last = lastPosition();
        if (last) {
            setNearest(last, { always: true });
        } else if (await locationPermission() === 'denied') {
            // The browser won't ask, and browsers report this differently when asked anyway
            status.textContent = deniedText();
            return;
        } else {
            requested = true;
            status.textContent = t('subway.locating');
        }
        startLocation();
    });

    if (followLocation) {
        const last = lastPosition();
        if (last) setNearest(last);
        // Only if the browser won't ask: here it asks when the button is pressed
        locationPermission().then(permission => { if (permission === 'granted') startLocation(); });
    }
}

const rail = await loadRail();
if (rail) start(rail);
