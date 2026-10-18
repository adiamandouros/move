import { t } from './i18n.js';

// Shared by every page: the language link and the service worker. Each
// tool's own script is loaded separately by its page, and only the pages
// that use the location start it (/js/core/location.js).

// ── Language link ────────────────────────────────────────────────────────────

// The language link opens this page in the other language. Remember the
// choice, so pages open in it from now on (see languageRedirect in
// server/pages/layout.js), and keep this page's state, like the stations
// chosen on the subway page, which lives in the address.
document.querySelectorAll('.lang-toggle-btn').forEach(link => {
    link.addEventListener('click', () => {
        try { localStorage.setItem('language', link.hreflang); } catch { /* storage blocked: just this page */ }
        link.href = link.pathname + location.search + location.hash;
    });
});

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
