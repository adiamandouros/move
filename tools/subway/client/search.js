import { html, localName, setHtml } from '/js/core/html.js';
import { language } from '/js/core/i18n.js';
import { lineBadge } from '/js/core/metro.js';
import { normalise } from '/js/core/text.js';
import { addRecentStation, recentStations } from './recent.js';

const MAX_SUGGESTIONS = 8;

const stationName = station => localName(station.name, language);

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

// What a field offers before anything is typed, to show what it takes: the
// stations picked lately (`recent`), then the interchanges, then the ends of
// the lines, each A–Z
export function startingStations(rail, recent) {
    const byName = ids => [...ids].sort((a, b) => stationName(rail.stations[a]).localeCompare(stationName(rail.stations[b]), 'el'));
    const interchanges = Object.keys(rail.stations).filter(id => rail.stations[id].lines.length > 1);
    const ends = Object.values(rail.lines).flatMap(line => Object.values(line.directions)
        .flatMap(({ stops }) => [stops[0].station, stops.at(-1).station]));
    const known = recent.filter(id => Object.hasOwn(rail.stations, id)).slice(0, 3);
    return [...new Set([...known, ...byName(interchanges), ...byName(new Set(ends))])];
}

// Wire an <input role="combobox"> and its <ul role="listbox"> (from page.html)
// into a station picker. `onChange(id | null)` fires when the selection changes.
// Tapping the field, or ArrowDown in it, lists stations to start from.
export function stationSearch({ input, list, rail, onChange }) {
    let selected = null;

    function render(ids) {
        if (!ids.length) { hide(); return; }
        setHtml(list, html`${ids.map(id => {
            const s = rail.stations[id];
            return html`
            <li role="option" aria-selected="false" class="suggestion-item" tabindex="-1" data-id="${id}">
                <span class="suggestion-names">
                    <span class="suggestion-name-gr" lang="el">${s.name.el}</span>
                    <span class="suggestion-name-en" lang="en">${s.name.en}</span>
                </span>
                <span class="suggestion-lines" aria-hidden="true">${s.lines.map(line => lineBadge(line, rail.lines[line].name, 'suggestion-line-badge'))}</span>
                <span class="sr-only">, ${s.lines.join(', ')}</span>
            </li>`;
        })}`);
        list.hidden = false;
        input.setAttribute('aria-expanded', 'true');
    }

    function hide() {
        list.hidden = true;
        input.setAttribute('aria-expanded', 'false');
    }

    function set(id, { notify = true } = {}) {
        // Object.hasOwn: ?from=constructor isn't a station
        selected = id && Object.hasOwn(rail.stations, id) ? id : null;
        input.value = selected ? stationName(rail.stations[selected]) : '';
        hide();
        if (notify) onChange(selected);
    }

    // A station the person chose themselves, so it's offered again later
    function pick(id) {
        set(id);
        if (selected) addRecentStation(selected);
    }

    // What's typed, or with nothing typed (or a station chosen) the stations to start from
    const suggestions = () => selected || !normalise(input.value)
        ? startingStations(rail, recentStations())
        : matchStations(rail.stations, input.value);

    input.addEventListener('input', () => {
        if (selected) { selected = null; onChange(null); }
        render(suggestions());
    });

    // Opened on click rather than focus: the focus comes back here after a
    // pick from the keyboard, and the list shouldn't open again then
    input.addEventListener('click', () => {
        if (selected) input.select();
        if (list.hidden) render(suggestions());
    });

    // Typing a full station name and leaving the field counts as choosing it
    input.addEventListener('change', () => {
        if (selected) return;
        const q = normalise(input.value);
        const exact = Object.keys(rail.stations).find(id =>
            [rail.stations[id].name.el, rail.stations[id].name.en].some(n => normalise(n) === q));
        if (exact) pick(exact);
    });

    input.addEventListener('keydown', e => {
        if (e.key === 'ArrowDown' && list.hidden) {
            e.preventDefault();
            render(suggestions());
        } else if (e.key === 'ArrowDown') {
            e.preventDefault();
            list.querySelector('[role="option"]')?.focus();
        } else if (e.key === 'Enter' && !list.hidden) {
            e.preventDefault();
            const first = list.querySelector('[role="option"]');
            if (first) pick(first.dataset.id);
        } else if (e.key === 'Escape') {
            hide();
        }
    });

    list.addEventListener('keydown', e => {
        const focused = /** @type {HTMLElement | null} */ (document.activeElement.closest('[role="option"]'));
        if (!focused) return;
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            /** @type {HTMLElement | null} */ (focused.nextElementSibling)?.focus();
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            (focused.previousElementSibling ?? input).focus();
        } else if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            pick(focused.dataset.id);
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

    // mousedown rather than click, so the input doesn't lose focus and close the list first.
    // Then let go of the input, so a phone's keyboard closes and the route shows.
    list.addEventListener('mousedown', e => {
        const item = e.target.closest('[role="option"]');
        if (item) { e.preventDefault(); pick(item.dataset.id); input.blur(); }
    });

    input.closest('.subway-search-wrap').addEventListener('focusout', e => {
        if (!e.currentTarget.contains(e.relatedTarget)) hide();
    });

    return {
        get: () => selected,
        set,
    };
}
