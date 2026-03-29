import { lines, allStops } from '../data/subway.js';

// ── Position config ─────────────────────────────────────────────────────────

const POSITIONS = [
    { id: 'back',        label: 'Back',      labelGr: 'Πίσω' },
    { id: 'center-back', label: 'Near Back', labelGr: 'Κέντρο-Πίσω' },
    { id: 'center',      label: 'Center',    labelGr: 'Κέντρο' },
    { id: 'center-front',label: 'Near Front',labelGr: 'Κέντρο-Μπροστά' },
    { id: 'front',       label: 'Front',     labelGr: 'Μπροστά' },
];

// ── Direction logic ─────────────────────────────────────────────────────────

function normalise(name) {
    return name.toLowerCase().trim();
}

function matchesStop(stop, query) {
    const q = normalise(query);
    return normalise(stop.name) === q || (stop.engName && normalise(stop.engName) === q);
}

// Returns array of { line, direction, stop } where:
//   - both origin and destination are in the direction's stop list
//   - origin comes before destination (determines travel direction)
function findDirectionedResult(originName, destName) {
    const results = [];
    for (const line of lines) {
        for (const direction of line.directions) {
            const stops = direction.stops;
            const originIdx = stops.findIndex(s => matchesStop(s, originName));
            const destIdx   = stops.findIndex(s => matchesStop(s, destName));
            if (originIdx !== -1 && destIdx !== -1 && originIdx < destIdx) {
                results.push({ line, direction, stop: stops[destIdx] });
            }
        }
    }
    return results;
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

function renderResult(entries) {
    if (!entries.length) {
        return `<p class="text-muted small mt-3">These two stops don't share a direct line, or the order seems reversed. Try swapping origin and destination.</p>`;
    }

    return entries.map(({ line, direction, stop }) => {
        const noData = stop.positions.length === 0;
        // note can be a string or an array
        const noteText = Array.isArray(stop.note) ? stop.note.join(' ') : stop.note;

        return `
        <div class="result-card">
            <div class="result-header d-flex align-items-center gap-2 mb-3">
                <span class="line-badge" style="background-color: ${line.color}">${line.name}</span>
                <span class="direction-text">→ ${direction.toward}</span>
            </div>
            ${noData
                ? `<p class="text-muted fst-italic small">No position data for this stop yet.</p>`
                : `${renderTrainDiagram(stop.positions)}
                   ${noteText ? `<div class="stop-note mt-3"><i class="bi bi-info-circle me-1" aria-hidden="true"></i>${noteText}</div>` : ''}`
            }
        </div>`;
    }).join('');
}

// ── Search input factory ────────────────────────────────────────────────────

function filterStops(query) {
    if (!query || query.length < 1) return [];
    const q = normalise(query);
    return allStops
        .filter(s => normalise(s.name).includes(q) || (s.engName && normalise(s.engName).includes(q)))
        .slice(0, 8);
}

// Creates a self-contained search input with autocomplete.
// onSelect(stopName) is called when the user picks a suggestion.
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
    let selectedName  = null;

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
        selectedName = name;
        input.value  = name;
        hideSuggestions();
        onSelect(name);
    }

    input.addEventListener('input', () => {
        selectedName = null;
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

    return { element: wrap, getSelected: () => selectedName };
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
            result.innerHTML = renderResult(findDirectionedResult(originName, destName));
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
