import { announce, format, html, localName, setHtml } from '/js/core/html.js';
import { language, t } from '/js/core/i18n.js';
import { onLocation, onLocationProblem, startLocation, lastPosition } from '/js/core/location.js';
import { athensNow, closestStation, isTimetableExpired, withTram } from '/tools/subway/network.js';
import { tramHidden } from '/tools/subway/tram-switch.js';
import { cityPlanner, timeHalfHour } from './buses.js';
import { doorToDoor } from './plan.js';
import { placePicker } from './picker.js';
import { howExact, placeTitle, renderChosen, renderTrip, routeSummary } from './render.js';

const $ = id => document.getElementById(id);
const result = $('trip-result');
const form = $('trip-form');
const fromInput = /** @type {HTMLInputElement} */ ($('trip-from'));
const toInput = /** @type {HTMLInputElement} */ ($('trip-to'));
const locate = $('trip-locate');

// Keeps the times current while the page is open
const REFRESH_MS = 60_000;
// Buses only on /trip?buses for now, and on /trip?timing, which also says how
// long they take on this device (roadmap Plan 7, the phone test): their
// August timetable is too quick in traffic until enough rides are measured
// (decision 31). Not remembered, so nothing more is kept on the device.
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

// Without the buses' times the trip is planned by metro and tram, and says so
const loadBuses = () => BUSES ? loadJson('/data/buses.json').catch(() => null) : Promise.resolve(null);

// The timing, under the answer
function timingBox(timing) {
    return html`<div class="trip-card" id="trip-timing">
        <h2 class="route-option-label">${t('trip.timing-title')}</h2>
        <p class="trip-other">${timing.city !== null && html`${format(t('trip.timing-city'), { ms: timing.city })} · `}${format(t('trip.timing-answer'), { ms: timing.answer })}</p>
        ${timing.city !== null && html`<button id="trip-time-half" type="button" class="btn btn-sm locate-btn">${t('trip.timing-half')}</button>
        <p class="trip-other" id="trip-half-result" role="status"></p>`}
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
function start(metro, buses) {
    const hidden = tramHidden();
    const rail = hidden ? metro : withTram(metro);
    let from = null;
    let to = null;
    // The fields are back, with the answer still under them
    let changing = false;
    // The city's search for the buses, made for each day when it's first needed
    let city = null;
    const timing = { city: null, answer: 0 };

    const render = ({ speak = false } = {}) => {
        const ready = from && to;
        form.hidden = Boolean(ready) && !changing;
        if (!ready) { setHtml(result, html`<p class="trip-intro">${t('trip.intro')}</p>`); return; }
        const now = athensNow();
        if (buses && city?.weekday !== now.weekday) {
            // Its first trip of the day takes a moment: said, and drawn, before it starts
            setHtml(result, html`<p class="trip-intro" role="status">${t('trip.working')}</p>`);
            requestAnimationFrame(() => setTimeout(() => {
                const started = performance.now();
                city = { weekday: now.weekday, planner: cityPlanner(hidden ? { ...metro, tram: undefined } : metro, buses, now.weekday) };
                timing.city = Math.round(performance.now() - started);
                render({ speak });
            }));
            return;
        }
        const started = performance.now();
        const trip = doorToDoor(rail, from, to, now, { city: city?.planner });
        timing.answer = Math.round(performance.now() - started);
        const answer = html`${renderTrip(rail, trip, to, { expired: isTimetableExpired(rail, now), noBuses: BUSES && !buses })}${TIMING && timingBox(timing)}`;
        setHtml(result, changing ? answer : html`${renderChosen(from, to)}${answer}`);
        $('trip-time-half')?.addEventListener('click', () => {
            const ms = step => timeHalfHour(city.planner, from, to, athensNow(), step);
            $('trip-half-result').textContent = format(t('trip.timing-result'), { two: ms(120), one: ms(60) });
        });
        $('trip-change')?.addEventListener('click', () => {
            changing = true;
            render();
            fromInput.focus();
            fromInput.select();
        });
        if (speak) announce(trip.options[0] ? routeSummary(trip.options[0]) : t('trip.walk-quicker'));
    };

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
        if (from && to && !result.contains(document.activeElement)) render();
    }, REFRESH_MS);
    render();
}

// The metro and the tram, or the metro alone when the tram is hidden on the
// Subway page (decision 29), and the buses
const [metro, buses] = await Promise.all([loadRail(), loadBuses()]);
if (metro) start(metro, buses);
