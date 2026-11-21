import { format } from '/js/core/html.js';
import { t } from '/js/core/i18n.js';
import { accordion, poll, renderStops, showMessage, state, withMeters } from '../page.js';

// One stop (?stop=10341), opened, with its live times

export function showStop({ focus = false } = {}) {
    const { view } = state;
    if (view.kind !== 'stop') return;
    const { code } = view;
    const stop = state.byCode.get(code);
    if (!stop) {
        showMessage('bus', format(t('buses.stop-not-found'), { code }));
        return;
    }
    renderStops([withMeters(stop)], { open: true });
    if (focus) /** @type {HTMLElement | null} */ (accordion.querySelector('.stop-toggle'))?.focus();
    poll();
}
