import { lastPosition, locationPermission, onLocation, onLocationProblem, startLocation } from '/js/core/location.js';
import { announce, localName, setHtml } from '/js/core/html.js';
import { watchLifts } from '/js/core/lifts.js';
import { legendOpen } from '/js/core/metro.js';
import { language, t } from '/js/core/i18n.js';
import { remember } from '/js/core/remember.js';
import { athensNow, closestStation, isTimetableExpired, planTrip } from './network.js';
import { stationSearch } from './search.js';
import { renderIntro, renderMessage, renderResult, routeSummary, walkingUrl } from './render.js';

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

function start(rail) {
    const params = new URLSearchParams(location.search);

    // `speak`: also tell screen readers, when the user changed the stations
    // (not on the 30-second refresh)
    // Slower options the user opened or closed themselves (routeKey → open),
    // kept through the refresh, forgotten when the stations change
    let opened = {};
    // Legs whose stations the user opened (legKey → true), the same way
    let stationsOpen = {};
    // Which one had the keyboard focus (an option, a leg's stops or the
    // legend), to give it back after a refresh
    const focused = () => {
        const toggle = document.activeElement?.closest('#subway-result .leg-stops-toggle');
        if (toggle) return `.leg-stops-toggle[data-leg="${CSS.escape(toggle.getAttribute('data-leg'))}"]`;
        const details = document.activeElement?.closest('#subway-result details');
        if (!details) return null;
        return `${details.hasAttribute('data-route') ? `details[data-route="${CSS.escape(details.getAttribute('data-route'))}"]` : 'details.diagram-legend'} > summary`;
    };
    const refocus = selector => { if (selector) /** @type {HTMLElement | null} */ (result.querySelector(selector))?.focus(); };

    const render = ({ speak = false } = {}) => {
        const origin = from.get();
        const destination = to.get();
        const known = lifts();
        // Until there are two stations: what the page does, and what the trains show
        if (!origin || !destination) {
            const focus = focused();
            setHtml(result, renderIntro(rail, legendOpen(), known, [origin, destination].filter(Boolean)));
            refocus(focus);
            return;
        }
        if (origin === destination) {
            setHtml(result, renderMessage('subway.same-station'));
            if (speak) announce(t('subway.same-station'));
            return;
        }
        const today = athensNow();
        // After the last train, tomorrow's first ones
        const { plans, now, tomorrow } = planTrip(rail, origin, destination, today);
        const focus = focused();
        setHtml(result, renderResult(rail, plans, now, { expired: isTimetableExpired(rail, today), tomorrow, open: opened, stations: stationsOpen, legend: legendOpen(), lifts: known }));
        refocus(focus);
        if (speak) announce(routeSummary(rail, plans, now, tomorrow, known));
    };
    // Lifts out of service (STASY), drawn again when they come; also in the suggestions
    const lifts = watchLifts(() => render());

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

    // The walking figure beside the boarding station: walking directions to it
    const walk = /** @type {HTMLAnchorElement} */ (document.getElementById('walk-btn'));
    const syncWalk = () => {
        walk.hidden = !from.get();
        if (walk.hidden) return;
        walk.href = walkingUrl(rail, from.get());
        document.getElementById('walk-station').textContent = localName(rail.stations[from.get()].name, language);
    };

    const changed = () => { opened = {}; stationsOpen = {}; syncUrl(); syncWalk(); render({ speak: true }); };

    // A click on a summary (also Enter or Space) comes before the toggle
    result.addEventListener('click', e => {
        const details = /** @type {Element} */ (e.target).closest?.('details[data-route]');
        if (details && /** @type {Element} */ (e.target).closest('summary')) opened[details.getAttribute('data-route')] = !details.hasAttribute('open');
    });

    // A leg's stops: open or close its stations
    result.addEventListener('click', e => {
        const toggle = /** @type {Element} */ (e.target).closest?.('.leg-stops-toggle');
        if (!toggle) return;
        const open = toggle.getAttribute('aria-expanded') !== 'true';
        toggle.setAttribute('aria-expanded', String(open));
        /** @type {HTMLElement} */ (document.getElementById(toggle.getAttribute('aria-controls'))).hidden = !open;
        stationsOpen[toggle.getAttribute('data-leg')] = open;
    });

    // Without a station in the address, the boarding station follows the
    // user's location until they pick one themselves. The "Nearest" button
    // shows it: pressed (blue, its icon filled) while it does.
    let followLocation = false;
    const locate = document.getElementById('locate-btn');
    const follow = on => {
        followLocation = on;
        locate.setAttribute('aria-pressed', String(on));
        const use = locate.querySelector('use');
        use?.setAttribute('href', use.getAttribute('href').replace(/#.*$/, `#nearest${on ? '-filled' : ''}`));
    };
    follow(!params.has('from'));

    const fromInput = /** @type {HTMLInputElement} */ (document.getElementById('stop-search-from'));
    const toInput = /** @type {HTMLInputElement} */ (document.getElementById('stop-search-to'));
    const from = stationSearch({
        input: fromInput,
        list: document.getElementById('stop-suggestions-from'),
        rail,
        onChange: () => { follow(false); changed(); },
        announce,
        lifts,
    });
    fromInput.addEventListener('input', () => follow(false));
    const to = stationSearch({
        input: toInput,
        list: document.getElementById('stop-suggestions-to'),
        rail,
        onChange: changed,
        announce,
        lifts,
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
        follow(false);
        const origin = from.get();
        from.set(to.get(), { notify: false });
        to.set(origin, { notify: false });
        changed();
    });

    setInterval(render, REFRESH_MS);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) render(); });

    // ── The nearest station ──
    // Set at once from a recent position (even offline, underground), then
    // from new ones while followLocation lasts. The "Nearest" button turns
    // that back on and asks for it (the browser asks the first time). Pressed
    // again while on, it looks again: picking a station is what turns it off.
    const status = document.getElementById('locate-status');
    let requested = false;

    const setNearest = ({ lat, lng }, { always = false } = {}) => {
        status.textContent = '';
        const id = closestStation(rail, lat, lng);
        if (id !== from.get()) from.set(id);
        else if (!always) return;
        // (from.set counts as choosing it, so it's kept until here)
        follow(true);
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

    // Only said when someone pressed the button and is waiting for it.
    // Blocked, the button goes off: it can't follow anything.
    onLocationProblem(problem => {
        if (problem === 'denied') follow(false);
        if (!requested) return;
        if (problem !== 'slow') requested = false;
        status.textContent = problem === 'denied' ? deniedText() : t(`location.${problem}`);
    });

    locate.addEventListener('click', async () => {
        follow(true);
        const last = lastPosition();
        if (last) {
            setNearest(last, { always: true });
        } else if (await locationPermission() === 'denied') {
            // The browser won't ask, and browsers report this differently when asked anyway
            follow(false);
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
        locationPermission().then(permission => {
            if (permission === 'granted') startLocation();
            else if (permission === 'denied' && !last) follow(false);
        });
    }
}

const rail = await loadRail();
if (rail) start(rail);
