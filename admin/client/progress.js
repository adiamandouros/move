// A check's progress (server/diagnostics.js): how far something got, as a
// bar with its numbers
import { html } from '/js/core/html.js';

export function progressBar({ done, total, label }) {
    return html`<div class="diag-progress"><progress max="${total}" value="${done}" aria-label="${label}"></progress><span>${done} / ${total}</span></div>`;
}
