import { getLanguage } from '/js/core/settings.js';

const MAX_SUGGESTIONS = 8;

export function normalise(text) {
    return text.toLowerCase().trim().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ς/g, 'σ');
}

const stationName = station => station.name[getLanguage()] ?? station.name.en;

// Stations whose Greek or English name contains the query; names that start
// with it come first.
export function matchStations(stations, query) {
    const q = normalise(query);
    if (!q) return [];
    const scored = [];
    for (const [id, station] of Object.entries(stations)) {
        const names = [station.name.el, station.name.en].map(normalise);
        if (names.some(n => n.startsWith(q))) scored.push([0, id]);
        else if (names.some(n => n.includes(q))) scored.push([1, id]);
    }
    return scored
        .sort((a, b) => a[0] - b[0] || stationName(stations[a[1]]).localeCompare(stationName(stations[b[1]]), 'el'))
        .slice(0, MAX_SUGGESTIONS)
        .map(([, id]) => id);
}

// Wire an <input role="combobox"> and its <ul role="listbox"> (from page.html)
// into a station picker. `onChange(id | null)` fires when the selection changes.
export function stationSearch({ input, list, rail, onChange }) {
    let selected = null;

    function render(ids) {
        if (!ids.length) { hide(); return; }
        list.innerHTML = ids.map(id => {
            const s = rail.stations[id];
            const badges = s.lines.map(line =>
                `<span class="suggestion-line-badge" style="background-color:${rail.lines[line].color}">${rail.lines[line].name}</span>`).join('');
            return `
            <li role="option" aria-selected="false" class="suggestion-item" tabindex="-1" data-id="${id}">
                <span class="suggestion-names">
                    <span class="suggestion-name-gr">${s.name.el}</span>
                    <span class="suggestion-name-en">${s.name.en}</span>
                </span>
                <span class="suggestion-lines" aria-hidden="true">${badges}</span>
            </li>`;
        }).join('');
        list.hidden = false;
        input.setAttribute('aria-expanded', 'true');
    }

    function hide() {
        list.hidden = true;
        input.setAttribute('aria-expanded', 'false');
    }

    function set(id, { notify = true } = {}) {
        selected = id && rail.stations[id] ? id : null;
        input.value = selected ? stationName(rail.stations[selected]) : '';
        hide();
        if (notify) onChange(selected);
    }

    input.addEventListener('input', () => {
        render(matchStations(rail.stations, input.value));
        if (selected) { selected = null; onChange(null); }
    });

    // Typing a full station name and leaving the field counts as choosing it
    input.addEventListener('change', () => {
        if (selected) return;
        const q = normalise(input.value);
        const exact = Object.keys(rail.stations).find(id =>
            [rail.stations[id].name.el, rail.stations[id].name.en].some(n => normalise(n) === q));
        if (exact) set(exact);
    });

    input.addEventListener('keydown', e => {
        if (e.key === 'ArrowDown' && !list.hidden) {
            e.preventDefault();
            list.querySelector('[role="option"]')?.focus();
        } else if (e.key === 'Enter' && !list.hidden) {
            e.preventDefault();
            const first = list.querySelector('[role="option"]');
            if (first) set(first.dataset.id);
        } else if (e.key === 'Escape') {
            hide();
        }
    });

    list.addEventListener('keydown', e => {
        const focused = document.activeElement.closest('[role="option"]');
        if (!focused) return;
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            focused.nextElementSibling?.focus();
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            (focused.previousElementSibling ?? input).focus();
        } else if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            set(focused.dataset.id);
            input.focus();
        } else if (e.key === 'Escape') {
            hide();
            input.focus();
        }
    });

    list.addEventListener('focusin', e => {
        const focused = e.target.closest('[role="option"]');
        list.querySelectorAll('[role="option"]').forEach(el => el.setAttribute('aria-selected', String(el === focused)));
    });

    // mousedown rather than click, so the input doesn't lose focus and close the list first
    list.addEventListener('mousedown', e => {
        const item = e.target.closest('[role="option"]');
        if (item) { e.preventDefault(); set(item.dataset.id); }
    });

    input.closest('.subway-search-wrap').addEventListener('focusout', e => {
        if (!e.currentTarget.contains(e.relatedTarget)) hide();
    });

    return {
        get: () => selected,
        set,
        // Show the selected station's name in the current language
        refresh: () => { if (selected) input.value = stationName(rail.stations[selected]); },
    };
}
