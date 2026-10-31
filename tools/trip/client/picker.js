import { html, setHtml } from '/js/core/html.js';
import { t } from '/js/core/i18n.js';
import { placeOption } from './render.js';

// A field that finds a place on our server as it's typed (POST /api/places;
// decision 22), as a combobox and listbox. `onChange(found | null)` says what
// was chosen. Nothing typed is kept, and it's never put in the page's address.

const WAIT_MS = 200;
const FEWEST_LETTERS = 2;

// What can be said above the list, or ''
export function listNote({ results, notInTown, noSuchTown, corrected }) {
    if (!results.length) return t('trip.nothing-found');
    if (noSuchTown) return t('trip.no-such-town');
    if (notInTown) return t('trip.not-in-town');
    return corrected ? t('trip.mended') : '';
}

async function findPlaces(q, signal) {
    const response = await fetch('/api/places', {
        method: 'POST', signal, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ q }),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
}

export function placePicker({ input, list, status, rail, onChange }) {
    let found = [];
    let timer = null;
    let asking = null;

    const hide = () => {
        list.hidden = true;
        input.setAttribute('aria-expanded', 'false');
    };
    const say = message => { status.textContent = message; };

    function show(answer) {
        found = answer.results;
        say(listNote(answer));
        setHtml(list, html`${found.map((place, i) => placeOption(place, i, rail, list.id))}`);
        list.hidden = !found.length;
        input.setAttribute('aria-expanded', String(found.length > 0));
    }

    async function search(q) {
        asking?.abort();
        const mine = asking = new AbortController();
        try {
            show(await findPlaces(q, mine.signal));
        } catch {
            if (mine.signal.aborted) return;
            found = [];
            hide();
            say(t('trip.search-unavailable'));
        }
    }

    function pick(index) {
        const place = found[index];
        if (!place) return;
        hide();
        say('');
        onChange(place);
    }

    input.addEventListener('input', () => {
        clearTimeout(timer);
        asking?.abort();
        onChange(null);
        const q = input.value.trim();
        if (q.length < FEWEST_LETTERS) { found = []; hide(); say(''); return; }
        timer = setTimeout(() => search(q), WAIT_MS);
    });

    input.addEventListener('keydown', e => {
        if (e.key === 'ArrowDown' && !list.hidden) {
            e.preventDefault();
            list.querySelector('[role="option"]')?.focus();
        } else if (e.key === 'Enter') {
            e.preventDefault();
            if (!list.hidden) pick(0);
        } else if (e.key === 'Escape' && !list.hidden) {
            // Only closes the list: by itself it would also empty a search field
            e.preventDefault();
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
            /** @type {HTMLElement} */ (focused.previousElementSibling ?? input).focus();
        } else if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            pick(Number(focused.dataset.index));
            input.focus();
        } else if (e.key === 'Escape') {
            hide();
            input.focus();
        }
    });

    list.addEventListener('click', e => {
        const item = /** @type {HTMLElement | null} */ (/** @type {Element} */ (e.target).closest('[role="option"]'));
        if (item) pick(Number(item.dataset.index));
    });

    document.addEventListener('click', e => {
        if (!list.contains(/** @type {Node} */ (e.target)) && e.target !== input) hide();
    });

    return { say };
}
