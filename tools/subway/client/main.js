import { getCoords } from '/js/core/location.js';
import { onLanguageChange, getLanguage } from '/js/core/settings.js';
import { t } from '/js/core/i18n.js';
import { athensNow, closestStation, isTimetableExpired, planJourney } from './network.js';
import { stationSearch } from './search.js';
import { renderMessage, renderResult } from './render.js';

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
        result.innerHTML = renderMessage('subway.data-error');
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

    const render = () => {
        const origin = from.get();
        const destination = to.get();
        if (!origin || !destination) { result.innerHTML = ''; return; }
        if (origin === destination) { result.innerHTML = renderMessage('subway.same-station'); return; }
        const now = athensNow();
        result.innerHTML = renderResult(rail, planJourney(rail, origin, destination, now), now, { expired: isTimetableExpired(rail, now) });
    };

    // The selection lives in the URL (?from=syntagma&to=airport) so routes can be bookmarked and shared
    const syncUrl = () => {
        const query = new URLSearchParams();
        if (from.get()) query.set('from', from.get());
        if (to.get()) query.set('to', to.get());
        const search = query.toString();
        history.replaceState(null, '', search ? `${location.pathname}?${search}` : location.pathname);
    };

    const changed = () => { syncUrl(); render(); };

    const from = stationSearch({
        input: document.getElementById('stop-search-from'),
        list: document.getElementById('stop-suggestions-from'),
        rail,
        onChange: changed,
    });
    const to = stationSearch({
        input: document.getElementById('stop-search-to'),
        list: document.getElementById('stop-suggestions-to'),
        rail,
        onChange: changed,
    });

    from.set(params.get('from'), { notify: false });
    to.set(params.get('to'), { notify: false });
    changed();

    document.getElementById('subway-form').addEventListener('submit', e => e.preventDefault());

    document.getElementById('swap-stations').addEventListener('click', () => {
        const origin = from.get();
        from.set(to.get(), { notify: false });
        to.set(origin, { notify: false });
        changed();
    });

    onLanguageChange(() => {
        from.refresh();
        to.refresh();
        render();
    });

    setInterval(render, REFRESH_MS);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) render(); });

    // Without a station in the URL, start from the one nearest to the user
    if (!params.has('from')) {
        getCoords()
            .then(({ lat, lng }) => {
                if (from.get()) return;
                const id = closestStation(rail, lat, lng);
                from.set(id);
                const name = rail.stations[id].name[getLanguage()] ?? rail.stations[id].name.en;
                announce(`${t('subway.location-prefix')} ${name} ${t('subway.location-suffix')}`);
            })
            .catch(() => {}); // location unavailable or denied
    }
}

const rail = await loadRail();
if (rail) start(rail);
