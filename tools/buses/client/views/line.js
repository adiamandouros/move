import { format, setHtml } from '/js/core/html.js';
import { t } from '/js/core/i18n.js';
import { lineKey } from '../search.js';
import { lineHeader, nearestNote } from '../render.js';
import { $, accordion, lineBar, loadLines, renderStops, showMessage, state, withMeters } from '../page.js';

// A line's stops in order (?line=040, &dir=1 the other way), under its bar
// with the way to its other direction; the stop nearest you is marked

export async function showLine({ focus = false } = {}) {
    const { view } = state;
    const drawn = state.drawn;
    showMessage('loading spin', t('buses.loading-lines'));
    const lines = await loadLines();
    if (drawn !== state.drawn) return; // another view since
    if (!lines) {
        showMessage('no-connection', t('buses.lines-error'));
        return;
    }
    // ?line=x95 finds the Χ95 too
    const line = lines.find(l => l.line === view.line) ?? lines.find(l => lineKey(l.line) === lineKey(view.line));
    if (!line) {
        showMessage('bus', format(t('buses.line-not-found'), { line: view.line }));
        return;
    }
    const direction = Math.min(view.direction, line.directions.length - 1);
    setHtml(lineBar, lineHeader(line, direction));
    lineBar.hidden = false;
    renderStops(line.directions[direction].stops.map(code => state.byCode.get(code)).filter(Boolean).map(withMeters));
    if (focus) /** @type {HTMLElement} */ (lineBar.querySelector('.line-heading')).focus();
    markNearest();
}

// On a line, mark the stop nearest to you, once the location is known, and
// scroll to it unless a stop has been opened meanwhile
export function markNearest() {
    if (state.view.kind !== 'line' || !state.coords || !state.stops.length || accordion.querySelector('.stop-nearest')) return;
    const item = accordion.querySelector(`[data-stop="${state.stops.reduce((a, b) => (b.meters < a.meters ? b : a)).code}"]`);
    item.classList.add('stop-nearest');
    setHtml(item.querySelector('.stop-nearest-note'), nearestNote());
    if (accordion.querySelector('.stop-toggle[aria-expanded="true"]')) return;
    item.scrollIntoView({ block: 'center' });
    // The stop half under the line's bar, if one is: shown whole
    const pinned = lineBar.getBoundingClientRect().bottom;
    const cut = [...accordion.children].find(row => { const r = row.getBoundingClientRect(); return r.top < pinned && r.bottom > pinned; });
    if (cut && !lineBar.classList.contains('line-bar-unpinned')) $('app-content').scrollTop -= pinned - cut.getBoundingClientRect().top;
}
