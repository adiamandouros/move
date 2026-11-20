import { html, setHtml } from '/js/core/html.js';
import { t } from '/js/core/i18n.js';
import { selectOnFirstTap } from '/js/core/select-on-tap.js';
import { addRecentPlace, recentFirst, recentPlaces } from './recent.js';
import { howExact, placeOption } from './render.js';

// A field that finds a place on our server as it's typed (POST /api/places;
// decision 22), as a combobox and listbox. `onChange(found | null)` says what
// was chosen, and how exact it is is said under the field. `chosen()`:
// whether the field holds what was chosen (a place picked, or My location)
// rather than what's being typed; tapped into then, its words are selected,
// so typing replaces them (selectOnFirstTap). Nothing typed is kept, and it's never put in the page's address;
// the last 3 places picked are (recent.js): tapped, or ArrowDown, with
// nothing in it, the field lists them, and they come first while one that
// matches is typed.

const WAIT_MS = 200;
const FEWEST_LETTERS = 2;
// With no signal a request hangs rather than fails: after this long the
// search is said to be unavailable (Road · 13). An answer takes well under
// 2 seconds, the first after a deploy, which loads the index, longer
const ANSWER_WITHIN_MS = 10_000;

// What can be said above the list, or ''. `recent`: the places picked lately
export function listNote({ results, notInTown, noSuchTown, corrected, recent }) {
    if (recent) return t('trip.recent');
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

export function placePicker({ input, list, status, rail, onChange, chosen }) {
    let found = [];
    /** @type {ReturnType<typeof setTimeout> | undefined} */
    let timer;
    /** @type {AbortController | null} */
    let asking = null;
    // Whether the list shows the places picked lately, as said above it
    let offering = false;

    const say = message => { status.textContent = message; };
    const hide = () => {
        list.hidden = true;
        input.setAttribute('aria-expanded', 'false');
        if (offering) say('');
        offering = false;
    };

    function show(answer) {
        offering = Boolean(answer.recent);
        found = answer.results;
        say(listNote(answer));
        setHtml(list, html`${found.map((place, i) => placeOption(place, i, rail, list.id))}`);
        list.hidden = !found.length;
        input.setAttribute('aria-expanded', String(found.length > 0));
    }

    async function search(q) {
        asking?.abort();
        const mine = asking = new AbortController();
        let late = false;
        const timer = setTimeout(() => { late = true; mine.abort(); }, ANSWER_WITHIN_MS);
        try {
            const answer = await findPlaces(q, mine.signal);
            show({ ...answer, results: recentFirst(recentPlaces(), answer.results, q) });
        } catch {
            // Stopped for a newer search: that one says what it finds
            if (mine.signal.aborted && !late) return;
            found = [];
            hide();
            say(t('trip.search-unavailable'));
        } finally {
            clearTimeout(timer);
        }
    }

    function pick(index) {
        const place = found[index];
        if (!place) return;
        hide();
        say(howExact(place)?.words ?? '');
        addRecentPlace(place);
        onChange(place);
    }

    // With nothing in the field, the places picked lately, if there are any
    function offerRecent() {
        if (input.value.trim()) return false;
        const recent = recentPlaces();
        if (recent.length) show({ results: recent, recent: true });
        return recent.length > 0;
    }

    selectOnFirstTap(input, chosen);

    input.addEventListener('input', () => {
        clearTimeout(timer);
        asking?.abort();
        onChange(null);
        const q = input.value.trim();
        if (q.length < FEWEST_LETTERS) { found = []; hide(); say(''); offerRecent(); return; }
        timer = setTimeout(() => search(q), WAIT_MS);
    });

    // Opened on click rather than focus, as the Subway page's: the focus
    // comes back here after a pick from the keyboard
    input.addEventListener('click', () => {
        if (list.hidden) offerRecent();
    });

    input.addEventListener('keydown', e => {
        if (e.key === 'ArrowDown' && list.hidden) {
            if (offerRecent()) e.preventDefault();
        } else if (e.key === 'ArrowDown') {
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
        const focused = /** @type {HTMLElement | null | undefined} */ (document.activeElement?.closest('[role="option"]'));
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
