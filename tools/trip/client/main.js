import { announce, format, html, localName, setHtml } from '/js/core/html.js';
import { language, t } from '/js/core/i18n.js';
import { onLocation, onLocationProblem, startLocation, lastPosition } from '/js/core/location.js';
import { athensNow, closestStation, isTimetableExpired, withTram } from '/tools/subway/network.js';
import { tramHidden } from '/tools/subway/tram-switch.js';
import { doorToDoor, isLongWalk } from './plan.js';
import { placePicker } from './picker.js';
import { halfWays, howExact, placeTitle, rangeText, renderChosen, renderHalf, renderTrip, routeSummary } from './render.js';

const $ = id => document.getElementById(id);
const result = $('trip-result');
const form = $('trip-form');
const fromInput = /** @type {HTMLInputElement} */ ($('trip-from'));
const toInput = /** @type {HTMLInputElement} */ ($('trip-to'));
const locate = $('trip-locate');

// Keeps the times current while the page is open
const REFRESH_MS = 60_000;
// The next half hour is worked out again once it's this old, while the page
// is open (decision 33)
const HALF_REWORK_SECONDS = 600;
// Buses only on /trip?buses for now, and on /trip?timing, which also says how
// long they take on this device (roadmap Plan 7): their August timetable is
// too quick in traffic until enough rides are measured (decision 31). Not
// remembered, so nothing more is kept on the device.
const asked = new URLSearchParams(location.search);
const TIMING = asked.has('timing');
const BUSES = TIMING || asked.has('buses');

async function loadJson(url) {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
}

async function loadRail() {
    try {
        return await loadJson('/data/rail.json');
    } catch {
        setHtml(result, html`<p>${t('trip.data-error')}</p>`);
        return null;
    }
}

// The searches with a bus run in the background (worker.js, decision 32),
// started with the version the page's import map gives it. `rail` is what
// the city is planned on. Null where a browser can't start it: then, as when
// the buses' times can't be loaded, the trip is by metro and tram, and says so
function startSearches(rail) {
    try {
        const worker = new Worker(import.meta.resolve('./worker.js'), { type: 'module' });
        worker.postMessage({ rail });
        return worker;
    } catch {
        return null;
    }
}

// The half hour's kind of answer (answer.js), in words
const KINDS = { clear: 'trip.half-clear', decision: 'trip.half-decision', depends: 'trip.half-depends', none: 'trip.half-none' };
const halfWords = half => half ? format(t('trip.timing-half'), { ms: half.ms, kind: t(KINDS[half.kind]) }) : t('trip.timing-half-working');

// The timing, under the answer
function timingBox(timing) {
    return html`<div class="trip-card" id="trip-timing">
        <h2 class="route-option-label">${t('trip.timing-title')}</h2>
        <p class="trip-other">${timing.city !== null && html`${format(t('trip.timing-city'), { ms: timing.city })} · `}${format(t('trip.timing-answer'), { ms: timing.answer })}</p>
        <p class="trip-other" id="trip-half" role="status">${halfWords(timing.half)}</p>
    </div>`;
}

// What a place found means for a trip: a metro station is that station, and
// so is a tram stop when the tram is planned on, so there's no walk to it, and
// it goes by the page's language
function chosenPlace(rail, found) {
    const place = { lat: found.lat, lng: found.lng, title: placeTitle(found), exact: howExact(found)?.words ?? null };
    const tram = { metro: false, tram: true }[found.placeKind];
    if (tram === undefined || (tram && !Object.values(rail.stations).some(station => station.tram))) return place;
    const station = closestStation(rail, found.lat, found.lng, tram);
    return { ...place, station, title: localName(rail.stations[station].name, language) };
}

// `metro`: rail.json, which the page plans on with its tram or without it
function start(metro) {
    const hidden = tramHidden();
    const rail = hidden ? metro : withTram(metro);
    let from = null;
    let to = null;
    // The fields are back, with the answer still under them
    let changing = false;
    let searches = BUSES ? startSearches(hidden ? { ...metro, tram: undefined } : metro) : null;
    let noBuses = BUSES && !searches;
    // What's been asked of the searches: the latest trip, and the latest half
    // hour (only the latest of each is answered); the latest answer, the ways
    // with a bus for leaving at its `now`; and the latest half hour's answer.
    // Each for the trip it says
    let asked = null;
    let askedHalf = null;
    let found = null;
    let half = null;
    const timing = { city: null, answer: 0, half: null };
    const forTrip = what => what?.from === from && what?.to === to;

    // The answer for leaving at `now`, the ways with a bus being `buses`, or
    // in its place the next half hour's (decision 33), unless walking is
    // quicker, the trains have stopped for the night, or it has nothing to
    // show. Returns the half hour's ways when they're drawn
    const draw = (now, buses, speak) => {
        const trip = doorToDoor(rail, from, to, now, { buses });
        const expired = isTimetableExpired(rail, now);
        const ways = forTrip(half) && !trip.walkFirst && !trip.options[0]?.morning ? halfWays(half.view, now.seconds) : [];
        const shown = ways.length
            ? renderHalf(rail, half.view.kind, ways, to, { expired, longWalk: isLongWalk(ways[0].o) })
            : renderTrip(rail, trip, to, { expired, noBuses, checking: Boolean(searches) && !forTrip(half) });
        const answer = html`${shown}${TIMING && timingBox(timing)}`;
        setHtml(result, changing ? answer : html`${renderChosen(from, to)}${answer}`);
        $('trip-change')?.addEventListener('click', () => {
            changing = true;
            render();
            fromInput.focus();
            fromInput.select();
        });
        if (speak) announce(ways.length ? halfReady(ways) : trip.options[0] ? routeSummary(trip.options[0]) : t('trip.walk-quicker'));
        return ways;
    };
    const halfReady = ways => format(t('trip.half-ready'), { range: rangeText(ways[0].row) });

    // `refresh`: the same trip, for a later time
    const render = ({ speak = false, refresh = false } = {}) => {
        const ready = from && to;
        form.hidden = Boolean(ready) && !changing;
        if (!ready) { setHtml(result, html`<p class="trip-intro">${t('trip.intro')}</p>`); return; }
        const now = athensNow();
        if (!searches) { draw(now, [], speak); return; }
        const same = forTrip(found);
        if (same && !refresh) { draw(found.now, found.options, speak); return; }
        const id = (asked?.id ?? 0) + 1;
        asked = { id, from, to, now, speak };
        // A new trip's half hour, and one old enough to be worked out again
        // (or from before midnight); the old one stays until the new one comes
        const age = forTrip(half) ? now.seconds - half.view.departures[0] : 0;
        const halfToo = !same || age < 0 || age >= HALF_REWORK_SECONDS;
        if (halfToo) askedHalf = { id, from, to };
        if (!same) {
            // A new trip: said while it's worked out, the first of the day
            // taking longest, as the day's city is made for it
            setHtml(result, html`<p class="trip-intro" role="status">${t('trip.working')}</p>`);
            timing.half = null;
        }
        searches.postMessage({ id, from, to, now, half: halfToo });
    };

    // The searches can't be had: by metro and tram from now on
    const fail = () => {
        if (!searches) return;
        searches.terminate();
        searches = null;
        noBuses = true;
        found = null;
        render({ speak: asked?.speak });
    };
    searches?.addEventListener('error', fail);
    searches?.addEventListener('message', ({ data }) => {
        if ('error' in data) { fail(); return; }
        if ('half' in data) {
            if (data.id !== askedHalf?.id) return;
            half = { from: askedHalf.from, to: askedHalf.to, view: data.half };
            timing.half = data.half;
            const box = $('trip-half');
            if (box) box.textContent = halfWords(timing.half);
            // Drawn at once, unless someone is in the answer: then with the
            // next refresh, which waits for that too
            if (!forTrip(found) || result.contains(document.activeElement)) return;
            const ways = draw(found.now, found.options, false);
            if (ways.length) announce(halfReady(ways));
            return;
        }
        if (data.id !== asked.id) return;
        found = { from: asked.from, to: asked.to, now: asked.now, options: data.options };
        timing.city = data.timing.city ?? timing.city;
        timing.answer = data.timing.answer;
        draw(asked.now, data.options, asked.speak);
    });

    const chooser = (input, set) => found => {
        if (found) input.value = placeTitle(found);
        set(found && chosenPlace(rail, found));
        changing = false;
        render({ speak: Boolean(found) });
    };
    const fromPicker = placePicker({ input: fromInput, list: $('trip-from-list'), status: $('trip-from-status'), rail, onChange: chooser(fromInput, place => { from = place; locate.setAttribute('aria-pressed', 'false'); }) });
    placePicker({ input: toInput, list: $('trip-to-list'), status: $('trip-to-status'), rail, onChange: chooser(toInput, place => { to = place; }) });

    // What was typed before the train times had loaded is replayed as
    // typing, so it's searched
    [fromInput, toInput].forEach(input => {
        if (input.value) input.dispatchEvent(new Event('input', { bubbles: true }));
    });

    $('trip-swap').addEventListener('click', () => {
        [from, to] = [to, from];
        [fromInput.value, toInput.value] = [toInput.value, fromInput.value];
        render();
    });

    // One position is enough for a trip: it isn't followed, and stays on this device
    const useLocation = position => {
        from = { lat: position.lat, lng: position.lng, title: t('trip.my-location'), exact: null };
        fromInput.value = t('trip.my-location');
        locate.setAttribute('aria-pressed', 'true');
        fromPicker.say('');
        render({ speak: true });
    };
    let waiting = false;
    locate.addEventListener('click', () => {
        const known = lastPosition();
        if (known) { useLocation(known); return; }
        waiting = true;
        fromPicker.say(t('trip.finding-location'));
        startLocation();
    });
    onLocation(position => {
        if (!waiting) return;
        waiting = false;
        useLocation(position);
    });
    onLocationProblem(problem => {
        if (!waiting || problem === 'slow') return;
        waiting = false;
        fromPicker.say(t(problem === 'denied' ? 'trip.location-denied' : 'trip.location-unavailable'));
    });

    setInterval(() => {
        if (from && to && !result.contains(document.activeElement)) render({ refresh: true });
    }, REFRESH_MS);
    render();
}

// The metro and the tram, or the metro alone when the tram is hidden on the
// Subway page (decision 29)
const metro = await loadRail();
if (metro) start(metro);
