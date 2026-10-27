import { startFavourites } from './favourites.js';
import { html, icon as iconHtml, setHtml } from './html.js';
import { t } from './i18n.js';
import { startStationLifts } from './lifts.js';
import { rememberLegends } from './metro.js';
import { fitStationTitle } from './station-title.js';
import { restoreLinks } from './remember.js';
import { startTheme } from './theme.js';

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

// ── The train legends ────────────────────────────────────────────────────────

// Closed once, closed on every page (/js/core/metro.js)
rememberLegends();

// ── A station page's title ───────────────────────────────────────────────────

// Its star beside the sign, alone, or under it (/js/core/station-title.js)
fitStationTitle();

// Its lifts out of service, if any (/js/core/lifts.js)
startStationLifts();

// ── Language ─────────────────────────────────────────────────────────────────

const storage = {
    get: key => { try { return localStorage.getItem(key); } catch { return null; } },
    set: (key, value) => { try { localStorage.setItem(key, value); } catch { /* storage blocked: just this page */ } },
};

// The language links (sidebar, menu, suggestion: the links with hreflang)
// open this page in the other language. Remember the choice, so pages open in
// it from now on (see languageRedirect in server/pages/layout.js), and keep
// this page's state, like the stations chosen on the subway page, which lives
// in the address.
/** @type {NodeListOf<HTMLAnchorElement>} */ (document.querySelectorAll('a[hreflang]')).forEach(link => {
    link.addEventListener('click', () => {
        storage.set('language', link.hreflang);
        link.href = link.pathname + location.search + location.hash;
    });
});

// Offer the other language once, to someone whose browser prefers it and who
// hasn't chosen a language (on phones the language link is in the menu)
const suggestion = /** @type {HTMLElement | null} */ (document.querySelector('.lang-suggest'));
if (suggestion && !storage.get('language') && !storage.get('language-suggested')) {
    const preferred = (navigator.languages ?? [navigator.language])
        .map(l => l?.slice(0, 2).toLowerCase())
        .find(l => l === 'en' || l === 'el');
    if (preferred && preferred !== document.documentElement.lang) {
        suggestion.hidden = false;
        suggestion.querySelector('button').addEventListener('click', () => {
            suggestion.hidden = true;
            storage.set('language-suggested', '1');
            document.getElementById('app-content').focus();
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

// A short message above the navigation that goes away by itself (Bootstrap's toast)
function toast(message, icon) {
    const el = document.createElement('div');
    el.className = 'toast toast-message';
    el.setAttribute('role', 'status');
    el.setAttribute('aria-atomic', 'true');
    setHtml(el, html`<div class="toast-body">${iconHtml(icon)}<span>${message}</span></div>`);
    document.body.append(el);
    el.addEventListener('hidden.bs.toast', () => el.remove());
    window.bootstrap.Toast.getOrCreateInstance(el, { delay: 4000 }).show();
}
