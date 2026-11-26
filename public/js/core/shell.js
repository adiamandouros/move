import { startFavourites } from './favourites.js';
import { html, icon as iconHtml, setHtml } from './html.js';
import { t } from './i18n.js';
import { startStationLifts } from './lifts.js';
import { rememberClosed } from './metro.js';
import { fitStationTitle } from './station-title.js';
import { restoreLinks } from './remember.js';
import { startTheme } from './theme.js';
import { localStore } from './storage.js';

// Shared by every page: the links to the tools, the language link and the service worker. Each
// tool's own script is loaded separately by its page, and only the pages
// that use the location start it (/js/core/location.js).

// ── Links to the tools ───────────────────────────────────────────────────────

// Back to where each tool was left (/js/core/remember.js)
restoreLinks();
window.addEventListener('pageshow', restoreLinks);

// ── Colour mode ──────────────────────────────────────────────────────────────

// Auto, Light and Dark in the menu and the sidebar (/js/core/theme.js)
startTheme();

// ── Favourites ───────────────────────────────────────────────────────────────

// Every star on every page: stations, bus stops, bus lines (/js/core/favourites.js)
startFavourites();

// ── The train legends and step-free notices ──────────────────────────────────

// Closed once, closed on every page (/js/core/metro.js)
rememberClosed();

// ── A station page's title ───────────────────────────────────────────────────

// Its star beside the sign, alone, or under it (/js/core/station-title.js)
fitStationTitle();

// Its lifts out of service, if any (/js/core/lifts.js)
startStationLifts();

// ── Language ─────────────────────────────────────────────────────────────────

// The language links (sidebar, menu, suggestion: the links with hreflang)
// open this page in the other language. Remember the choice, so pages open in
// it from now on (see languageRedirect in server/pages/layout.js), and keep
// this page's state, like the stations chosen on the subway page, which lives
// in the address.
/** @type {NodeListOf<HTMLAnchorElement>} */ (document.querySelectorAll('a[hreflang]')).forEach(link => {
    link.addEventListener('click', () => {
        localStore.set('language', link.hreflang);
        link.href = link.pathname + location.search + location.hash;
    });
});

// Offer the other language once, to someone whose browser prefers it and who
// hasn't chosen a language (on phones the language link is in the menu)
const suggestion = /** @type {HTMLElement | null} */ (document.querySelector('.lang-suggest'));
if (suggestion && !localStore.get('language') && !localStore.get('language-suggested')) {
    const preferred = (navigator.languages ?? [navigator.language])
        .map(l => l?.slice(0, 2).toLowerCase())
        .find(l => l === 'en' || l === 'el');
    if (preferred && preferred !== document.documentElement.lang) {
        suggestion.hidden = false;
        /** @type {HTMLElement} */ (suggestion.querySelector('button')).addEventListener('click', () => {
            suggestion.hidden = true;
            localStore.set('language-suggested', '1');
            /** @type {HTMLElement} */ (document.getElementById('app-content')).focus();
        });
    }
}

// ── Service worker ───────────────────────────────────────────────────────────

if ('serviceWorker' in navigator) {
    // A new version installs in the background and waits: this page keeps the
    // version it started with (nobody loses what they were doing), and the
    // next visit after the pages are closed gets the new one
    const hadController = Boolean(navigator.serviceWorker.controller);
    navigator.serviceWorker.register('/sw.js').then(registration => {
        // First install: say so once everything is saved for offline use.
        // (Installed iPhone apps get their own storage, so their first launch counts too.)
        const worker = registration?.installing ?? registration?.waiting;
        if (hadController || !worker) return;
        const done = () => {
            if (worker.state !== 'activated') return false;
            toast(t('shell.offline-ready'), 'offline-ready');
            return true;
        };
        if (!done()) worker.addEventListener('statechange', done);
    }).catch(() => { /* not allowed here (e.g. some private windows): the site works without offline use */ });
}

// ── Toast ────────────────────────────────────────────────────────────────────

// How long the page has to stay still before the toast shows
const QUIET_MS = 2000;

// A short message above the navigation that goes away by itself (Bootstrap's
// toast). It waits for a quiet moment, so it never covers what's being typed
// or drawn: no text field has the keyboard, and the page hasn't changed for
// QUIET_MS (an answer still coming in). Shown, it goes as soon as the person
// scrolls or touches the page, to read what's under it.
/** @param {string} message @param {string} icon */
function toast(message, icon) {
    const content = document.getElementById('app-content') ?? document.body;
    const typing = () => document.activeElement?.matches('input, textarea, select, [contenteditable]') ?? false;
    let timer = 0;
    const wait = () => {
        clearTimeout(timer);
        timer = window.setTimeout(ready, QUIET_MS);
    };
    const changes = new MutationObserver(wait);
    // Typing: it waits for the field to be left (focusout)
    const ready = () => {
        if (typing()) return;
        changes.disconnect();
        document.removeEventListener('focusout', wait);
        showToast(message, icon);
    };
    changes.observe(content, { childList: true, subtree: true, characterData: true });
    document.addEventListener('focusout', wait);
    wait();
}

/** @param {string} message @param {string} icon */
function showToast(message, icon) {
    const el = document.createElement('div');
    el.className = 'toast toast-message';
    el.setAttribute('role', 'status');
    el.setAttribute('aria-atomic', 'true');
    setHtml(el, html`<div class="toast-body">${iconHtml(icon)}<span>${message}</span></div>`);
    document.body.append(el);
    const shown = window.bootstrap.Toast.getOrCreateInstance(el, { delay: 4000 });
    // A scroll doesn't bubble: caught on its way down, from whatever scrolls
    const away = () => shown.hide();
    document.addEventListener('scroll', away, { capture: true, passive: true });
    document.addEventListener('pointerdown', away, true);
    el.addEventListener('hidden.bs.toast', () => {
        document.removeEventListener('scroll', away, true);
        document.removeEventListener('pointerdown', away, true);
        el.remove();
    });
    shown.show();
}
