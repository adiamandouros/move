import { lines, allStops, stopCoordinates, stopIndex } from '../data/subway.js';
import { getCoords } from '../location.js';
import { t } from '../i18n.js';
import { getLanguage, onLanguageChange } from '../settings.js';

// ── Position config ─────────────────────────────────────────────────────────

const POSITIONS = [
    { id: 'back',         label: 'Back',       labelGr: 'Πίσω' },
    { id: 'center-back',  label: 'Near Back',  labelGr: 'Κέντρο-Πίσω' },
    { id: 'center',       label: 'Center',     labelGr: 'Κέντρο' },
    { id: 'center-front', label: 'Near Front', labelGr: 'Κέντρο-Μπροστά' },
    { id: 'front',        label: 'Front',      labelGr: 'Μπροστά' },
];

// Interchange station names (Greek) — the only transfer points in Athens metro
const INTERCHANGES = ['Μοναστηράκι', 'Ομόνοια', 'Αττική', 'Σύνταγμα', 'Πειραιάς'];

// ── Module-level state ───────────────────────────────────────────────────────

let currentOrigin = null;
let currentDest   = null;
let unsubscribeSubwayLang = null;

// ── Helpers ─────────────────────────────────────────────────────────────────

function haversineMeters(lat1, lng1, lat2, lng2) {
    const R = 6371000;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLng = (lng2 - lng1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) ** 2
            + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180)
            * Math.sin(dLng / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function findClosestStop(lat, lng) {
    let best = null, bestDist = Infinity;
    for (const stop of allStops) {
        const coords = stopCoordinates[stop.name];
        if (!coords) continue;
        const d = haversineMeters(lat, lng, coords.lat, coords.lng);
        if (d < bestDist) { bestDist = d; best = stop; }
    }
    return best;
}

function normalise(name) {
    return name.toLowerCase().trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function matchesStop(stop, query) {
    const q = normalise(query);
    return normalise(stop.name) === q || (stop.engName && normalise(stop.engName) === q);
}

// ── Routing ─────────────────────────────────────────────────────────────────
//
// A route is an array of legs: [{ line, direction, stop, isTransfer }]
// stop = the stop where you get off that leg (transfer or final destination)

function findLegs(fromName, toName) {
    // Returns all { line, direction, fromStop, toStop } where fromName comes
    // before toName in direction.stops
    const legs = [];
    for (const line of lines) {
        for (const direction of line.directions) {
            const fromIdx = direction.stops.findIndex(s => matchesStop(s, fromName));
            const toIdx   = direction.stops.findIndex(s => matchesStop(s, toName));
            if (fromIdx !== -1 && toIdx !== -1 && fromIdx < toIdx) {
                legs.push({ line, direction, stop: direction.stops[toIdx] });
            }
        }
    }
    return legs;
}

function findRoutes(originName, destName) {
    // 1. Direct
    const direct = findLegs(originName, destName).map(leg => ({
        type: 'direct',
        legs: [{ ...leg, boardingName: originName, isTransfer: false }],
    }));
    if (direct.length) return direct;

    // 2. One transfer via each interchange
    const transfer = [];
    for (const interchange of INTERCHANGES) {
        const firstLegs  = findLegs(originName, interchange);
        const secondLegs = findLegs(interchange, destName);

        for (const leg1 of firstLegs) {
            for (const leg2 of secondLegs) {
                if (leg1.line.id === leg2.line.id) continue;
                transfer.push({
                    type: 'transfer',
                    interchange,
                    legs: [
                        { ...leg1, boardingName: originName,  isTransfer: true,  transferTo: leg2 },
                        { ...leg2, boardingName: interchange, isTransfer: false, transferTo: null },
                    ],
                });
            }
        }
    }
    return transfer;
}

// ── Rendering ───────────────────────────────────────────────────────────────

function positionLabel(p) {
    return getLanguage() === 'el' ? p.labelGr : p.label;
}

function directionLabel(direction) {
    if (getLanguage() === 'el') return direction.toward;
    const terminus = direction.stops.find(s => s.name === direction.toward);
    return terminus?.engName ?? direction.toward;
}

function stopLabel(stop) {
    return getLanguage() === 'el' ? stop.name : (stop.engName ?? stop.name);
}

function nameLabel(greekName) {
    if (getLanguage() === 'el') return greekName;
    return allStops.find(s => s.name === greekName)?.engName ?? greekName;
}

function renderTrainDiagram(positions, elevators = []) {
    const ariaLabel = positions.map(p => POSITIONS.find(x => x.id === p)?.label).join(' and ');
    return `
        <div class="train-diagram" role="img" aria-label="${t('subway.diagram-label')} ${ariaLabel}">
            <div class="train-label" aria-hidden="true">${t('subway.train-back')}</div>
            <div class="train-cars-wrap" aria-hidden="true">
                <div class="train-cars">
                    ${POSITIONS.map(p => `
                        <div class="train-car ${positions.includes(p.id) ? 'highlighted' : ''} ${elevators.includes(p.id) ? 'has-elevator' : ''}">
                            ${positions.includes(p.id) ? '<i class="bi bi-person-walking"></i>' : ''}
                            ${elevators.includes(p.id) ? '<i class="bi bi-arrow-up-square"></i>' : ''}
                        </div>`).join('')}
                </div>
                <div class="position-labels">
                    ${POSITIONS.map(p => `
                        <div class="position-label ${positions.includes(p.id) ? 'highlighted' : ''} ${elevators.includes(p.id) ? 'has-elevator' : ''}">
                            ${positionLabel(p)}
                        </div>`).join('')}
                </div>
            </div>
            <div class="train-label" aria-hidden="true">${t('subway.train-front')}</div>
        </div>`;
}

function renderLeg(leg) {
    const { line, direction, stop, isTransfer, transferTo, boardingName } = leg;
    const icon   = isTransfer ? 'arrow-left-right' : 'door-open';
    const action = isTransfer
        ? `${t('subway.transfer-at')} <strong>${stopLabel(stop)}</strong>`
        : `${t('subway.exit-at')} <strong>${stopLabel(stop)}</strong>`;

    // For transfer legs: use specific transfer positions if available,
    // otherwise fall back to the stop's exit positions
    let positions, elevators, noData, noteText;
    if (isTransfer && stop.transfers?.length) {
        const match = stop.transfers.find(
            t => t.lineId === transferTo.line.id && t.toward === transferTo.direction.toward
        );
        positions = match ? match.exits : stop.exits;
        elevators = stop.elevators ?? [];
        noData    = positions.length === 0;
        noteText  = null; // transfer-specific note could be added to the data later
    } else {
        positions = stop.exits;
        elevators = stop.elevators ?? [];
        noData    = positions.length === 0;
        noteText  = Array.isArray(stop.note) ? stop.note.join(' ') : stop.note;
    }

    return `
        <div class="result-card"
             data-schedule-route="${line.id}"
             data-schedule-boarding="${boardingName}"
             data-schedule-toward="${direction.toward}"
             data-schedule-origin="${direction.stops[0]?.name ?? ''}"
             data-schedule-destination="${stop.name}">
            <div class="result-header d-flex align-items-center gap-2 mb-2">
                <span class="line-badge" style="background-color: ${line.color}">${line.name}</span>
                <span class="direction-text" aria-label="${t('subway.toward')} ${directionLabel(direction)}"><span aria-hidden="true">→ </span>${directionLabel(direction)}</span>
                <div class="schedule-section ms-auto" aria-live="polite"></div>
            </div>
            <div class="leg-action mb-3">
                <i class="bi bi-${icon} me-2" aria-hidden="true"></i>${action}
                ${stop.central ? `<span class="central-platform-badge ms-2"><i class="bi bi-symmetry-horizontal me-1" aria-hidden="true"></i>${t('subway.exit-left')}</span>` : ''}
            </div>
            ${noData
                ? `<p class="text-muted fst-italic small">${t('subway.no-position-data')}</p>`
                : `${renderTrainDiagram(positions, elevators)}
                   ${noteText ? `<div class="stop-note mt-3"><i class="bi bi-info-circle me-1" aria-hidden="true"></i>${noteText}</div>` : ''}`
            }
        </div>`;
}

function renderRoute(route, index, total) {
    const header = total > 1
        ? `<p class="route-option-label">${t('subway.option')} ${index + 1}${route.type === 'transfer' ? ` · ${t('subway.transfer-at')} ${nameLabel(route.interchange)}` : ''}</p>`
        : '';

    if (route.type === 'direct') {
        return header + renderLeg(route.legs[0]);
    }

    return header + `
        ${renderLeg(route.legs[0])}
        <div class="transfer-connector" aria-hidden="true">
            <i class="bi bi-arrow-down-circle-fill"></i>
            <span>${t('subway.change-to')} ${route.legs[1].line.name}</span>
        </div>
        ${renderLeg(route.legs[1])}`;
}

function renderResult(routes) {
    if (!routes.length) {
        return `<p class="text-muted small mt-3">${t('subway.no-route')}</p>`;
    }
    return `<div class="routes-wrap">${routes.map((r, i) => renderRoute(r, i, routes.length)).join('<hr class="route-divider">')}</div>
        <p class="schedule-disclaimer"><i class="bi bi-info-circle me-1" aria-hidden="true"></i>${t('subway.schedule-disclaimer')}</p>`;
}

// ── Search input factory ────────────────────────────────────────────────────

// Pre-built map: stop name (Greek) → unique Line objects for that station
const stopLineMap = new Map(
    allStops.map(s => {
        const entries = stopIndex.get(s.name.toLowerCase()) ?? [];
        const unique = [...new Map(entries.map(e => [e.line.id, e.line])).values()];
        return [s.name, unique];
    })
);

function filterStops(query) {
    if (!query || query.length < 1) return [];
    const q = normalise(query);
    return allStops
        .filter(s => normalise(s.name).includes(q) || (s.engName && normalise(s.engName).includes(q)))
        .slice(0, 8)
        .map(s => ({ ...s, lines: stopLineMap.get(s.name) ?? [] }));
}

function createSearchInput({ inputId, suggestionsId, label, placeholder, onSelect }) {
    const wrap = document.createElement('div');
    wrap.className = 'subway-search-wrap mb-1';
    wrap.innerHTML = `
        <label for="${inputId}" class="form-label fw-semibold m-0">${label}</label>
        <div class="position-relative">
            <input id="${inputId}"
                   role="combobox"
                   type="search"
                   class="form-control subway-search-input"
                   placeholder="${placeholder}"
                   autocomplete="off"
                   aria-label="${label}"
                   aria-autocomplete="list"
                   aria-controls="${suggestionsId}"
                   aria-expanded="false"
                   aria-haspopup="listbox">
            <ul id="${suggestionsId}"
                class="stop-suggestions list-unstyled mb-0"
                role="listbox"
                aria-label="${t('subway.station-suggestions')}"
                hidden></ul>
        </div>`;

    const input       = wrap.querySelector('input');
    const suggestions = wrap.querySelector('ul');

    function showSuggestions(matches) {
        if (!matches.length) {
            suggestions.hidden = true;
            input.setAttribute('aria-expanded', 'false');
            return;
        }
        suggestions.innerHTML = matches.map(s => `
            <li role="option" aria-selected="false" class="suggestion-item" tabindex="0" data-name="${s.name}">
                <span class="suggestion-names">
                    <span class="suggestion-name-gr">${s.name}</span>
                    ${s.engName ? `<span class="suggestion-name-en">${s.engName}</span>` : ''}
                </span>
                <span class="suggestion-lines" aria-hidden="true">
                    ${s.lines.map(l => `<span class="suggestion-line-badge" style="background-color:${l.color}">${l.name}</span>`).join('')}
                </span>
            </li>`).join('');
        suggestions.hidden = false;
        input.setAttribute('aria-expanded', 'true');
    }

    function hideSuggestions() {
        suggestions.hidden = true;
        input.setAttribute('aria-expanded', 'false');
    }

    function select(name) {
        input.value = name;
        hideSuggestions();
        onSelect(name);
    }

    input.addEventListener('input', () => {
        showSuggestions(filterStops(input.value));
        onSelect(null);
    });

    input.addEventListener('keydown', e => {
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            suggestions.querySelector('[role="option"]')?.focus();
        }
    });

    suggestions.addEventListener('keydown', e => {
        const focused = document.activeElement;
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            focused.nextElementSibling?.focus();
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            (focused.previousElementSibling ?? input).focus();
        } else if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            select(focused.dataset.name);
            input.focus();
        } else if (e.key === 'Escape') {
            hideSuggestions();
            input.focus();
        }
    });

    suggestions.addEventListener('focusin', e => {
        const focused = e.target.closest('[role="option"]');
        if (!focused) return;
        suggestions.querySelectorAll('[role="option"]').forEach(el => {
            el.setAttribute('aria-selected', el === focused ? 'true' : 'false');
        });
    });

    suggestions.addEventListener('mousedown', e => {
        const item = e.target.closest('[role="option"]');
        if (item) select(item.dataset.name);
    });

    wrap.addEventListener('focusout', e => {
        if (!wrap.contains(e.relatedTarget)) hideSuggestions();
    });

    function setValue(name) {
        input.value = name;
        hideSuggestions();
        onSelect(name);
    }

    return { element: wrap, getSelected: () => input.value || null, setValue };
}

// ── Schedule lookup ──────────────────────────────────────────────────────────

let scheduleCache = null;

async function loadSchedule() {
    if (scheduleCache) return scheduleCache;
    try {
        const res = await fetch('/data/metro-schedule.json');
        if (!res.ok) return null;
        scheduleCache = await res.json();
        return scheduleCache;
    } catch {
        return null;
    }
}

function currentDayType() {
    const dow = new Date().getDay();
    if (dow === 0) return 'sunday';
    if (dow === 6) return 'saturday';
    if (dow === 5) return 'friday';
    return 'weekday';
}

function timeToMins(hhmm) {
    const [h, m] = hhmm.split(':').map(Number);
    return h * 60 + m;
}

function nowMins() {
    const d = new Date();
    return d.getHours() * 60 + d.getMinutes();
}

function getNextDepartures(schedule, routeId, boardingName, toward, originName, destinationName, count = 2) {
    const routeData = schedule?.routes?.[routeId];
    if (!routeData) return [];

    const normToward   = normalise(toward);
    const normBoarding = normalise(boardingName);
    const normOrigin   = normalise(originName ?? '');
    const termini      = routeData._termini ?? {};

    // Pass 1: match by terminus name (works for M1, M2, and M3 toward Δημοτικό Θέατρο).
    let dirId = Object.entries(termini).find(([, t]) =>
        t && (normToward.includes(t) || t.includes(normToward))
    )?.[0];

    // Pass 2 (only if pass 1 found nothing): some termini use a different colloquial name
    // in subway.js vs the official GTFS stop name (e.g. "Αεροδρόμιο" vs "ελ. βενιζελος").
    // In that case pick the GTFS direction whose terminus is NOT the origin end of the line —
    // i.e. the direction that travels *away* from where the passenger boards.
    if (!dirId && normOrigin) {
        dirId = Object.entries(termini).find(([, t]) =>
            t && !normOrigin.includes(t) && !t.includes(normOrigin)
        )?.[0];
    }

    if (!dirId) return [];

    const dirData = routeData[dirId];

    // Resolve the boarding stop key — handles names that differ between subway.js and GTFS
    // (e.g. "αεροδρομιο" vs GTFS key "ελ. βενιζελος").
    let boardingKey = normBoarding;
    if (!dirData?.[boardingKey]) {
        // Substring match
        boardingKey = Object.keys(dirData).find(k =>
            k.length > 3 && (normBoarding.includes(k) || k.includes(normBoarding))
        ) ?? boardingKey;
    }
    if (!dirData?.[boardingKey]) {
        // The boarding stop is the far terminus of the opposite direction
        // (Airport in dir1: termini["0"] = "ελ. βενιζελος" exists in dir1 data)
        const altTerminus = Object.values(termini).find(t => t !== termini[dirId] && dirData[t]);
        if (altTerminus) boardingKey = altTerminus;
    }

    const stopData = dirData?.[boardingKey];
    if (!stopData) return [];

    const boardingTimes = stopData[currentDayType()] ?? stopData.friday ?? stopData.weekday ?? [];

    // If the destination is on a branch with fewer trains (e.g. the M3 airport branch beyond
    // Doukissis), look up the destination stop's schedule — which only contains the trains
    // that actually reach it — instead of the boarding stop's schedule (which contains all trains).
    let times = boardingTimes;
    if (destinationName) {
        const normDest = normalise(destinationName);
        let destData = dirData[normDest] ?? null;

        // Substring match handles "παιανια-καντζα" → GTFS key "καντζα"
        if (!destData) {
            for (const [key, val] of Object.entries(dirData)) {
                if (key.length > 3 && (normDest.includes(key) || key.includes(normDest))) {
                    destData = val;
                    break;
                }
            }
        }

        // Terminus fallback handles names that differ entirely from GTFS
        // (e.g. "αεροδρομιο" → GTFS terminus "ελ. βενιζελος")
        if (!destData && termini[dirId]) {
            destData = dirData[termini[dirId]] ?? null;
        }

        if (destData) {
            const destTimes = destData[currentDayType()] ?? destData.friday ?? destData.weekday ?? [];
            // Only switch when the branch is significantly thinner (e.g. M3 airport branch).
            if (destTimes.length < boardingTimes.length * 0.5) {
                // Prefer the airport_branch lookup: it stores exact departure times
                // at each boarding stop for airport-bound trains, so the "In X'" shown
                // to the user reflects when the train actually leaves their platform.
                const branchTimes = routeData.airport_branch?.[boardingKey];
                times = branchTimes ?? destTimes;
            }
        }
    }

    // Find the last and second-to-last trains of the day (surviving the 2-min dedup filter).
    let lastTrainTime = null, secondLastTrainTime = null;
    {
        let prevMins = -Infinity;
        for (const time of times) {
            const m = timeToMins(time);
            if (m - prevMins >= 2) { secondLastTrainTime = lastTrainTime; lastTrainTime = time; prevMins = m; }
        }
    }

    const now = nowMins();

    // Strip departures closer than 2 minutes to the previous one — OASA's GTFS sometimes
    // contains two near-identical trip variants that create artificial 1-minute clusters.
    // The real Athens metro minimum headway is ~3 minutes, so this is always an artifact.
    const result = [];
    let lastMins = -Infinity;
    for (const time of times) {
        const m = timeToMins(time);
        if (m <= now) continue;
        if (m - lastMins >= 2) {
            result.push({ time, isLast: time === lastTrainTime, isSecondLast: time === secondLastTrainTime });
            lastMins = m;
        }
        if (result.length === count) break;
    }
    return result;
}

async function fillSchedules(container) {
    const schedule = await loadSchedule();
    if (!schedule) return;

    const now = nowMins();

    container.querySelectorAll('[data-schedule-route]').forEach(card => {
        const departures = getNextDepartures(
            schedule,
            card.dataset.scheduleRoute,
            card.dataset.scheduleBoarding,
            card.dataset.scheduleToward,
            card.dataset.scheduleOrigin,
            card.dataset.scheduleDestination,
        );

        const section = card.querySelector('.schedule-section');
        if (!section || !departures.length) return;

        const chips = departures.map(({ time, isLast, isSecondLast }) => {
            const mins = timeToMins(time) - now;
            const cls = isLast ? ' schedule-chip--last' : isSecondLast ? ' schedule-chip--second-last' : '';
            return `<span class="schedule-chip${cls}">${mins}'</span>`;
        }).join('');

        section.innerHTML = `<span class="schedule-label">${t('subway.schedule-in')}</span><span class="schedule-chips">${chips}</span>`;
    });
}

// ── Main view ───────────────────────────────────────────────────────────────

export function loadSubwayPosition(container) {
    // Save selections so they survive a language-change re-render
    const savedOrigin = currentOrigin;
    const savedDest   = currentDest;

    // Subscribe to language changes — re-render the whole view
    if (unsubscribeSubwayLang) unsubscribeSubwayLang();
    unsubscribeSubwayLang = onLanguageChange(() => loadSubwayPosition(container));

    container.innerHTML = `
        <div class="subway-view">
            <div id="subway-inputs"></div>
            <div id="subway-result" aria-live="polite" aria-atomic="true"></div>
        </div>`;

    const inputsWrap = container.querySelector('#subway-inputs');
    const result     = container.querySelector('#subway-result');

    let originName = null;
    let destName   = null;

    function tryRender() {
        if (originName && destName) {
            result.innerHTML = renderResult(findRoutes(originName, destName));
            fillSchedules(result).catch(() => {});
        } else {
            result.innerHTML = '';
        }
    }

    const from = createSearchInput({
        inputId:       'stop-search-from',
        suggestionsId: 'stop-suggestions-from',
        label:         t('subway.boarding-label'),
        placeholder:   t('subway.boarding-placeholder'),
        onSelect: name => { originName = name; currentOrigin = name; tryRender(); },
    });

    const to = createSearchInput({
        inputId:       'stop-search-to',
        suggestionsId: 'stop-suggestions-to',
        label:         t('subway.destination-label'),
        placeholder:   t('subway.destination-placeholder'),
        onSelect: name => { destName = name; currentDest = name; tryRender(); },
    });

    inputsWrap.appendChild(from.element);
    inputsWrap.appendChild(to.element);

    // Restore previous selections after a language-change re-render
    if (savedOrigin) from.setValue(savedOrigin);
    if (savedDest)   to.setValue(savedDest);

    // Pre-fill origin from geolocation (only if no saved selection)
    if (!savedOrigin) {
        getCoords()
            .then(({ lat, lng }) => {
                if (!from.getSelected()) {
                    const closest = findClosestStop(lat, lng);
                    if (closest) {
                        from.setValue(closest.name);
                        const announcer = document.getElementById('sr-announcer');
                        if (announcer) {
                            announcer.textContent = '';
                            requestAnimationFrame(() => {
                                announcer.textContent = `${t('subway.location-prefix')} ${closest.engName ?? closest.name} ${t('subway.location-suffix')}`;
                            });
                        }
                    }
                }
            })
            .catch(() => {}); // silently skip if location is unavailable or denied
    }
}

export function unloadSubwayPosition() {
    if (unsubscribeSubwayLang) {
        unsubscribeSubwayLang();
        unsubscribeSubwayLang = null;
    }
    // currentOrigin / currentDest are intentionally preserved so selections
    // are restored when the user navigates back to this tool
}
