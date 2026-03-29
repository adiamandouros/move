import { lines, stopIndex, allStops } from '../data/subway.js';

// ── Position config ─────────────────────────────────────────────────────────

const POSITIONS = [
    { id: 'back',        label: 'Back',       labelGr: 'Πίσω' },
    { id: 'center-back', label: 'Near Back',  labelGr: 'Κέντρο-Πίσω' },
    { id: 'center',       label: 'Center',      labelGr: 'Κέντρο' },
    { id: 'center-front',  label: 'Near Front',   labelGr: 'Κέντρο-Μπροστά' },
    { id: 'front',         label: 'Front',        labelGr: 'Μπροστά' },
];

// ── Rendering ───────────────────────────────────────────────────────────────

function renderTrainDiagram(positions) {
    return `
        <div class="train-diagram" role="img" aria-label="Train diagram showing where to stand: ${positions.map(p => POSITIONS.find(x => x.id === p)?.label).join(' and ')}">
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
    return entries.map(({ line, direction, stop }) => {
        const noData = stop.positions.length === 0;
        const positionText = noData
            ? 'No data available'
            : stop.positions.map(p => POSITIONS.find(x => x.id === p)?.labelGr).join(' / ');

        return `
        <div class="result-card">
            <div class="result-header d-flex align-items-center gap-2 mb-3">
                <span class="line-badge" style="background-color: ${line.color}">${line.name}</span>
                <span class="direction-text">→ ${direction.toward}</span>
            </div>

            ${noData
                ? `<p class="text-muted fst-italic small">No data for this direction yet.</p>`
                : `${renderTrainDiagram(stop.positions)}
                   ${stop.note ? `<div class="stop-note mt-2"><i class="bi bi-info-circle me-1" aria-hidden="true"></i>${stop.note}</div>` : ''}`
            }
        </div>`;
    }).join('');
}

// ── Search ──────────────────────────────────────────────────────────────────

function filterStops(query) {
    if (!query || query.length < 1) return [];
    const q = query.toLowerCase().trim();
    return allStops
        .filter(s => s.name.toLowerCase().includes(q) || s.engName?.toLowerCase().includes(q))
        .slice(0, 8);
}

function lookupStop(name) {
    return stopIndex.get(name.toLowerCase()) || [];
}

// ── Main view ───────────────────────────────────────────────────────────────

export function loadSubwayPosition(container) {
    container.innerHTML = `
        <div class="subway-view">
            <div class="subway-search-wrap">
                <label for="stop-search" class="form-label fw-semibold">Where are you going?</label>
                <div class="position-relative">
                    <input id="stop-search"
                           type="search"
                           class="form-control subway-search-input"
                           placeholder="Type a station name…"
                           autocomplete="off"
                           aria-label="Destination station"
                           aria-autocomplete="list"
                           aria-controls="stop-suggestions"
                           aria-expanded="false">
                    <ul id="stop-suggestions"
                        class="stop-suggestions list-unstyled mb-0"
                        role="listbox"
                        aria-label="Station suggestions"
                        hidden></ul>
                </div>
            </div>

            <div id="subway-result" aria-live="polite" aria-atomic="true"></div>
        </div>`;

    const input = container.querySelector('#stop-search');
    const suggestions = container.querySelector('#stop-suggestions');
    const result = container.querySelector('#subway-result');

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

    function selectStop(name) {
        input.value = name;
        hideSuggestions();

        const entries = lookupStop(name);
        if (!entries.length) {
            result.innerHTML = `<p class="text-muted small mt-3">No data found for "${name}".</p>`;
            return;
        }
        result.innerHTML = renderResult(entries);
    }

    // Keyboard: arrow keys to navigate suggestions, Enter to select
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
            const prev = focused.previousElementSibling;
            prev ? prev.focus() : input.focus();
        } else if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            selectStop(focused.dataset.name);
            input.focus();
        } else if (e.key === 'Escape') {
            hideSuggestions();
            input.focus();
        }
    });

    input.addEventListener('input', () => {
        showSuggestions(filterStops(input.value));
        result.innerHTML = '';
    });

    suggestions.addEventListener('mousedown', e => {
        const item = e.target.closest('[role="option"]');
        if (item) selectStop(item.dataset.name);
    });

    // Hide suggestions when focus leaves both input and list
    container.addEventListener('focusout', e => {
        if (!container.contains(e.relatedTarget)) hideSuggestions();
    });
}
