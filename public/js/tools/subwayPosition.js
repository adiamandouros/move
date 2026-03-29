import { lines, allStops } from '../data/subway.js';

// ── Position config ─────────────────────────────────────────────────────────

const POSITIONS = [
    { id: 'back',         label: 'Back',       labelGr: 'Πίσω' },
    { id: 'center-back',  label: 'Near Back',  labelGr: 'Κέντρο-Πίσω' },
    { id: 'center',       label: 'Center',     labelGr: 'Κέντρο' },
    { id: 'center-front', label: 'Near Front', labelGr: 'Κέντρο-Μπροστά' },
    { id: 'front',        label: 'Front',      labelGr: 'Μπροστά' },
];

// Interchange station names (Greek) — the only transfer points in Athens metro
const INTERCHANGES = ['Μοναστηράκι', 'Ομόνοια', 'Αττική', 'Σύνταγμα'];

// ── Helpers ─────────────────────────────────────────────────────────────────

function normalise(name) {
    return name.toLowerCase().trim();
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
        legs: [{ ...leg, isTransfer: false }],
    }));
    if (direct.length) return direct;

    // 2. One transfer via each interchange
    const transfer = [];
    for (const interchange of INTERCHANGES) {
        const firstLegs  = findLegs(originName, interchange);
        const secondLegs = findLegs(interchange, destName);

        for (const leg1 of firstLegs) {
            for (const leg2 of secondLegs) {
                // Must change lines at the interchange
                if (leg1.line.id === leg2.line.id) continue;
                transfer.push({
                    type: 'transfer',
                    interchange,
                    legs: [
                        { ...leg1, isTransfer: true },
                        { ...leg2, isTransfer: false },
                    ],
                });
            }
        }
    }
    return transfer;
}

// ── Rendering ───────────────────────────────────────────────────────────────

function renderTrainDiagram(positions) {
    const ariaLabel = positions.map(p => POSITIONS.find(x => x.id === p)?.label).join(' and ');
    return `
        <div class="train-diagram" role="img" aria-label="Train diagram showing where to stand: ${ariaLabel}">
            <div class="train-label" aria-hidden="true">BACK</div>
            <div class="train-cars-wrap" aria-hidden="true">
                <div class="train-cars">
                    ${POSITIONS.map(p => `
                        <div class="train-car ${positions.includes(p.id) ? 'highlighted' : ''}">
                            ${positions.includes(p.id) ? '<i class="bi bi-person-standing"></i>' : ''}
                        </div>`).join('')}
                </div>
                <div class="position-labels">
                    ${POSITIONS.map(p => `
                        <div class="position-label ${positions.includes(p.id) ? 'highlighted' : ''}">
                            ${p.labelGr}
                        </div>`).join('')}
                </div>
            </div>
            <div class="train-label" aria-hidden="true">FRONT</div>
        </div>`;
}

function renderLeg(leg) {
    const { line, direction, stop, isTransfer } = leg;
    const noData   = stop.positions.length === 0;
    const noteText = Array.isArray(stop.note) ? stop.note.join(' ') : stop.note;
    const icon     = isTransfer ? 'arrow-left-right' : 'door-open';
    const action   = isTransfer
        ? `Transfer at <strong>${stop.name}</strong>`
        : `Exit at <strong>${stop.name}</strong>`;

    return `
        <div class="result-card">
            <div class="result-header d-flex align-items-center gap-2 mb-2">
                <span class="line-badge" style="background-color: ${line.color}">${line.name}</span>
                <span class="direction-text">→ ${direction.toward}</span>
            </div>
            <div class="leg-action mb-3">
                <i class="bi bi-${icon} me-2" aria-hidden="true"></i>${action}
            </div>
            ${noData
                ? `<p class="text-muted fst-italic small">No position data for this stop yet.</p>`
                : `${renderTrainDiagram(stop.positions)}
                   ${noteText ? `<div class="stop-note mt-3"><i class="bi bi-info-circle me-1" aria-hidden="true"></i>${noteText}</div>` : ''}`
            }
        </div>`;
}

function renderRoute(route, index, total) {
    const header = total > 1
        ? `<p class="route-option-label">Option ${index + 1}${route.type === 'transfer' ? ` · Transfer at ${route.interchange}` : ''}</p>`
        : '';

    if (route.type === 'direct') {
        return header + renderLeg(route.legs[0]);
    }

    return header + `
        ${renderLeg(route.legs[0])}
        <div class="transfer-connector" aria-hidden="true">
            <i class="bi bi-arrow-down-circle-fill"></i>
            <span>Change to ${route.legs[1].line.name}</span>
        </div>
        ${renderLeg(route.legs[1])}`;
}

function renderResult(routes) {
    if (!routes.length) {
        return `<p class="text-muted small mt-3">No route found. Check that both stops are on the Athens metro, or try swapping origin and destination.</p>`;
    }
    return `<div class="routes-wrap">${routes.map((r, i) => renderRoute(r, i, routes.length)).join('<hr class="route-divider">')}</div>`;
}

// ── Search input factory ────────────────────────────────────────────────────

function filterStops(query) {
    if (!query || query.length < 1) return [];
    const q = normalise(query);
    return allStops
        .filter(s => normalise(s.name).includes(q) || (s.engName && normalise(s.engName).includes(q)))
        .slice(0, 8);
}

function createSearchInput({ inputId, suggestionsId, label, placeholder, onSelect }) {
    const wrap = document.createElement('div');
    wrap.className = 'subway-search-wrap';
    wrap.innerHTML = `
        <label for="${inputId}" class="form-label fw-semibold">${label}</label>
        <div class="position-relative">
            <input id="${inputId}"
                   type="search"
                   class="form-control subway-search-input"
                   placeholder="${placeholder}"
                   autocomplete="off"
                   aria-label="${label}"
                   aria-autocomplete="list"
                   aria-controls="${suggestionsId}"
                   aria-expanded="false">
            <ul id="${suggestionsId}"
                class="stop-suggestions list-unstyled mb-0"
                role="listbox"
                aria-label="Station suggestions"
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
            <li role="option" class="suggestion-item" tabindex="0" data-name="${s.name}">
                <span class="suggestion-name-gr">${s.name}</span>
                ${s.engName ? `<span class="suggestion-name-en">${s.engName}</span>` : ''}
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

    suggestions.addEventListener('mousedown', e => {
        const item = e.target.closest('[role="option"]');
        if (item) select(item.dataset.name);
    });

    wrap.addEventListener('focusout', e => {
        if (!wrap.contains(e.relatedTarget)) hideSuggestions();
    });

    return { element: wrap, getSelected: () => input.value || null };
}

// ── Main view ───────────────────────────────────────────────────────────────

export function loadSubwayPosition(container) {
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
        } else {
            result.innerHTML = '';
        }
    }

    const from = createSearchInput({
        inputId:       'stop-search-from',
        suggestionsId: 'stop-suggestions-from',
        label:         'Boarding at',
        placeholder:   'Type your boarding station…',
        onSelect: name => { originName = name; tryRender(); },
    });

    const to = createSearchInput({
        inputId:       'stop-search-to',
        suggestionsId: 'stop-suggestions-to',
        label:         'Getting off at',
        placeholder:   'Type your destination…',
        onSelect: name => { destName = name; tryRender(); },
    });

    inputsWrap.appendChild(from.element);
    inputsWrap.appendChild(to.element);
}
