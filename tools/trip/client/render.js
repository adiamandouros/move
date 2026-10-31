import { externalLink, format, html, localName, notice, walkingUrl } from '/js/core/html.js';
import { language, localHref, t } from '/js/core/i18n.js';
import { linePill } from '/js/core/lines.js';
import { clockTime, lineEnd } from '/js/core/metro.js';

const stationName = (rail, id) => localName(rail.stations[id].name, language);

// What a place found is called, with its house number
export const placeTitle = found => found.n ? `${found.name} ${found.n}` : found.name;

// How exact a place found is, in words, or null when there's nothing to say.
// warn: only the street is known. The answer is only as good as the map.
export function howExact(found) {
    if (found.type === 'place') {
        const kind = { metro: 'trip.kind-metro', tram: 'trip.kind-tram', airport: 'trip.kind-airport' }[found.placeKind];
        return kind ? { words: t(kind) } : null;
    }
    if (found.n === null) return null;
    if (found.kind === 'between') return { words: format(t('trip.exact-between'), { lo: found.lo, hi: found.hi }) };
    if (found.kind === 'beyond') return { words: format(t('trip.exact-beyond'), { near: found.near }) };
    if (found.kind === 'nearest') return { words: format(t('trip.exact-nearest'), { near: found.near }) };
    if (found.kind === 'street') return { words: t('trip.exact-street'), warn: true };
    return null;
}

function exactLine(found) {
    const exact = howExact(found);
    return exact && html`<span class="trip-exact${exact.warn ? ' trip-exact-warn' : ''}">${exact.words}</span>`;
}

// One place found, as a row of the list
export function placeOption(found, index, rail, listId) {
    const lines = found.placeKind === 'metro' ? found.lineNames : [];
    return html`<li id="${listId}-${index}" role="option" aria-selected="false" class="suggestion-item" tabindex="-1" data-index="${index}">
        <span class="suggestion-names">
            <span class="suggestion-name-gr">${placeTitle(found)}</span>
            ${found.town && html`<span class="suggestion-name-en">${found.town}</span>`}
            ${exactLine(found)}
        </span>
        ${lines.length > 0 && html`<span class="suggestion-lines" aria-hidden="true">${lines.map(line => linePill(line, rail.lines[line]?.name ?? line, 's'))}</span>`}
    </li>`;
}

function distance(meters) {
    const rounded = Math.round(meters / 50) * 50;
    return rounded < 1000 ? format(t('trip.walk-meters'), { meters: rounded }) : format(t('trip.walk-km'), { km: (rounded / 1000).toFixed(1) });
}

const step = (when, content) => html`<li class="trip-step"><span class="trip-step-when">${when}</span><div class="trip-step-what">${content}</div></li>`;

function walkStep(walk, words, place) {
    return step(`${walk.minutes}′`, html`${externalLink({ href: walkingUrl(place.lat, place.lng) }, words, t('shell.new-tab'))}
        <div class="trip-step-note">${distance(walk.meters)}</div>`);
}

function legStep(rail, leg) {
    const stops = leg.toIndex - leg.fromIndex;
    const place = stationName(rail, leg.to);
    const end = stationName(rail, lineEnd(rail, leg.line, leg.dir));
    return step(clockTime(leg.departures[0].departs), html`
        <div>${linePill(leg.line, rail.lines[leg.line].name, 's')} ${format(t('trip.towards'), { end })}</div>
        <div class="trip-step-note">${stops === 1 ? format(t('trip.stop'), { place }) : format(t('trip.stops'), { count: stops, place })}</div>`);
}

const stationPlace = (rail, id) => ({ lat: rail.stations[id].coords[0], lng: rail.stations[id].coords[1] });

const standHref = (start, end) => `${localHref('/subway')}?${new URLSearchParams({ from: start.station, to: end.station })}`;

function when(o) {
    const time = clockTime(o.arrives);
    if (!o.morning) return format(t('trip.arrive'), { time });
    const leave = clockTime(o.plan.legs[0].departures[0].departs - (o.start.walk?.minutes ?? 0) * 60);
    return format(t('trip.morning'), { leave, time });
}

// The fastest way, step by step
function tripCard(rail, o, to) {
    return html`<div class="trip-card result-card">
        <div class="trip-card-head">
            ${!o.morning && html`<h2 class="trip-total">${format(t('trip.minutes'), { minutes: o.minutes })}</h2>`}
            <span class="trip-arrives">${when(o)}</span>
        </div>
        <ol class="trip-steps">
            ${o.start.walk && walkStep(o.start.walk, format(t('trip.walk-to'), { place: stationName(rail, o.start.station) }), stationPlace(rail, o.start.station))}
            ${o.plan.legs.map(leg => legStep(rail, leg))}
            ${o.end.walk && walkStep(o.end.walk, format(t('trip.walk-to'), { place: to.title }), to)}
        </ol>
        <a class="btn btn-sm locate-btn trip-stand" href="${standHref(o.start, o.end)}">${t('trip.where-to-stand')}</a>
    </div>`;
}

// A slower way, on one line
function otherCard(rail, o) {
    const pills = o.plan.legs.map(leg => linePill(leg.line, rail.lines[leg.line].name, 's'));
    return html`<div class="trip-card">
        <div class="trip-card-head">
            ${!o.morning && html`<h3 class="trip-total trip-total-small">${format(t('trip.minutes'), { minutes: o.minutes })}</h3>`}
            <span class="trip-arrives">${when(o)}</span>
        </div>
        <p class="trip-other">${o.start.walk && html`${format(t('trip.walk-short'), { minutes: o.start.walk.minutes })} · `}${pills} ${format(t('trip.from-station'), { station: stationName(rail, o.start.station) })}</p>
    </div>`;
}

function walkCard(walk, to) {
    return html`<div class="trip-card">
        <div class="trip-card-head"><h2 class="trip-total">${format(t('trip.on-foot'), { minutes: walk.minutes })}</h2></div>
        <p class="trip-other">${t('trip.walk-quicker')}</p>
        ${externalLink({ href: walkingUrl(to.lat, to.lng) }, t('trip.walking-directions'), t('shell.new-tab'))}
    </div>`;
}

// For a screen reader, and for naming a card
export const routeSummary = o => format(t('trip.summary'), { minutes: o.minutes, time: clockTime(o.arrives) });

// The answer: what `doorToDoor` found, drawn
export function renderTrip(rail, { options, walk, walkFirst, longWalk }, to, { expired = false } = {}) {
    const [best, ...others] = options;
    const trainsStopped = best?.morning;
    return html`
        ${expired && notice('warn', 'warning', t('trip.timetable-ended'))}
        ${trainsStopped && notice('info', 'night', t('trip.no-trains'))}
        ${walkFirst && !trainsStopped && walkCard(walk, to)}
        ${best && (walkFirst && !trainsStopped ? html`<h2 class="route-option-label">${t('trip.other-ways')}</h2>${otherCard(rail, best)}` : tripCard(rail, best, to))}
        ${longWalk && !walkFirst && notice('info', 'bus', html`${t('trip.long-walk')} <a href="${localHref('/buses')}">${t('trip.look-for-buses')}</a>`)}
        ${others.length > 0 && !(walkFirst && !trainsStopped) && html`<h2 class="route-option-label">${t('trip.other-ways')}</h2>`}
        ${others.map(o => otherCard(rail, o))}
        <p class="trip-estimates">${t('trip.estimates')}</p>`;
}

// What's been chosen, above the answer
export function renderChosen(from, to) {
    const place = (label, chosen) => html`<div>
        <div class="route-option-label">${label}</div>
        <div class="trip-place-name">${chosen.title}</div>
        ${chosen.exact && html`<div class="trip-step-note">${chosen.exact}</div>`}
    </div>`;
    return html`<div class="trip-places">
        ${place(t('trip.from'), from)}
        ${place(t('trip.to'), to)}
        <button id="trip-change" type="button" class="btn btn-sm locate-btn">${t('trip.change')}</button>
    </div>`;
}
