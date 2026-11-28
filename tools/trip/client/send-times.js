import { announce, html, setHtml } from '/js/core/html.js';
import { localHref, t } from '/js/core/i18n.js';
import { dueReports, ENDPOINT, keepWaiting, riderAnswer, setRiderAnswer, waitingReports, withReport } from '/js/core/rider-times.js';

// Times measured by riders, on the Trip page (decision 84): the question,
// asked once, the first time a metro or tram ride is followed; the switch
// that changes the answer once it's given; and the reports of rides, each
// sent a random moment up to 15 minutes after it, kept on the device till
// then (and for a day, without a signal). The measuring is measure.js's, by
// way of the controller.

// The waiting reports are looked at this often while the page is open
const CHECK_MS = 60_000;
// This page's reports so far of a ride still measured: sent only by a later
// page, once this one has gone (the phone closed it)
const PAGE = Math.random().toString(36).slice(2);

/** @typedef {import('/js/core/rider-times.js').Waiting & { draft?: string }} Kept */

/**
 * The question's box and the switch's, on the page; `answered` is told
 * the rider's answer as they give or change it
 * @param {{ box: HTMLElement, toggle: HTMLElement, answered: (answer: 'yes' | 'no') => void }} parts
 */
export function sendTimes({ box, toggle, answered }) {
    const input = /** @type {HTMLInputElement} */ (toggle.querySelector('input'));
    /** @type {Kept | null} */
    let draft = null;

    const showSwitch = () => {
        const answer = riderAnswer();
        toggle.hidden = answer === null;
        input.checked = answer === 'yes';
    };
    /** @param {'yes' | 'no'} answer */
    const answer = answer => {
        setRiderAnswer(answer);
        if (answer === 'no') draft = null;
        answered(answer);
    };
    input.addEventListener('change', () => answer(input.checked ? 'yes' : 'no'));
    showSwitch();

    // Above the answer, without taking the keyboard: said once. Answered, it
    // goes, the switch says the answer, and the keyboard goes on to it
    const ask = () => {
        if (riderAnswer() !== null || !box.hidden) return;
        setHtml(box, html`<section class="trip-ask" aria-labelledby="trip-ask-title">
            <h2 id="trip-ask-title" class="trip-ask-title">${t('trip.ask-title')}</h2>
            <p class="mb-0">${t('trip.ask-text')}</p>
            <p class="mb-0"><a href="${localHref('/privacy')}#rider-times">${t('trip.ask-more')}</a></p>
            <div class="trip-quicker-actions">
                <button type="button" class="btn btn-primary btn-sm rounded-pill px-4" data-answer="yes">${t('trip.ask-yes')}</button>
                <button type="button" class="btn btn-sm locate-btn" data-answer="no">${t('trip.ask-no')}</button>
            </div>
        </section>`);
        box.hidden = false;
        announce(t('trip.ask-title'));
    };
    box.addEventListener('click', e => {
        const button = /** @type {HTMLElement} */ (e.target).closest('button[data-answer]');
        if (!button) return;
        const given = button.getAttribute('data-answer') === 'yes' ? 'yes' : 'no';
        answer(given);
        box.hidden = true;
        setHtml(box, html``);
        showSwitch();
        input.focus();
        announce(t(given === 'yes' ? 'trip.ask-said-yes' : 'trip.ask-said-no'));
    });

    // Sent, each due report: dropped once the server has it, or refused it
    // as wrong; kept for later when it can't be reached or asks to wait
    const sendDue = () => {
        if (riderAnswer() !== 'yes') return;
        const now = Date.now();
        const { due, later } = dueReports(waitingReports(), now);
        /** @type {Kept[]} */
        const mine = due.filter(w => /** @type {Kept} */ (w).draft === PAGE);
        const sending = due.filter(w => /** @type {Kept} */ (w).draft !== PAGE);
        keepWaiting([...later, ...mine]);
        for (const waiting of sending) {
            fetch(ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(waiting.report), keepalive: true })
                .then(response => response.status === 429 || response.status >= 500 ? Promise.reject(new Error(String(response.status))) : undefined)
                .catch(() => keepWaiting([...waitingReports(), waiting]));
        }
    };
    sendDue();
    setInterval(sendDue, CHECK_MS);

    return {
        ask,
        /**
         * A ride's report to send, `final` once it's over; one so far (the
         * page out of sight) waits for the next in its place, and is sent
         * only if this page goes
         * @param {import('./measure.js').Report} report @param {boolean} final
         */
        report(report, final) {
            if (riderAnswer() !== 'yes') return;
            const now = Date.now();
            const before = draft ? JSON.stringify(draft) : null;
            const kept = waitingReports().filter(w => JSON.stringify(w) !== before);
            const added = /** @type {Kept[]} */ (withReport(kept, report, now, Math.random()));
            const entry = /** @type {Kept} */ (added.at(-1));
            if (final) draft = null;
            else draft = Object.assign(entry, { draft: PAGE });
            keepWaiting(added);
        },
    };
}
