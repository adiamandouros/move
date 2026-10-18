import { t } from './i18n.js';

// Shared by every page: the language link and the service worker. Each
// tool's own script is loaded separately by its page, and only the pages
// that use the location start it (/js/core/location.js).

// ── Language ─────────────────────────────────────────────────────────────────

const storage = {
    get: key => { try { return localStorage.getItem(key); } catch { return null; } },
    set: (key, value) => { try { localStorage.setItem(key, value); } catch { /* storage blocked: just this page */ } },
};

// The language links (sidebar, footer, suggestion: the links with hreflang)
// open this page in the other language. Remember the choice, so pages open in
// it from now on (see languageRedirect in server/pages/layout.js), and keep
// this page's state, like the stations chosen on the subway page, which lives
// in the address.
document.querySelectorAll('a[hreflang]').forEach(link => {
    link.addEventListener('click', () => {
        storage.set('language', link.hreflang);
        link.href = link.pathname + location.search + location.hash;
    });
});

// Offer the other language once, to someone whose browser prefers it and who
// hasn't chosen a language (on phones the language link is down in the footer)
const suggestion = document.querySelector('.lang-suggest');
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
    // Reload once a new version takes over, but not on the very first install
    const hadController = Boolean(navigator.serviceWorker.controller);
    navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (hadController) window.location.reload();
    });
    navigator.serviceWorker.register('/sw.js').then(registration => {
        // First install: say so once everything is saved for offline use.
        // (Installed iPhone apps get their own storage, so their first launch counts too.)
        const worker = registration.installing ?? registration.waiting;
        if (hadController || !worker) return;
        const done = () => worker.state === 'activated' && toast(t('shell.offline-ready'), 'cloud-check');
        if (!done()) worker.addEventListener('statechange', done);
    });
}

// ── Toast ────────────────────────────────────────────────────────────────────

// A short message above the navigation that goes away by itself
function toast(message, icon) {
    const el = document.createElement('div');
    el.className = 'toast-message';
    el.setAttribute('role', 'status');
    el.innerHTML = `<i class="bi bi-${icon}" aria-hidden="true"></i><span></span>`;
    el.querySelector('span').textContent = message;
    document.body.append(el);
    requestAnimationFrame(() => el.classList.add('show'));
    setTimeout(() => {
        el.classList.remove('show');
        setTimeout(() => el.remove(), 400);
    }, 4000);
}
