import { initLocation } from './location.js';
import { getLanguage, setLanguage, onLanguageChange } from './settings.js';
import { t, translatePage } from './i18n.js';

// Shared by every page: location tracking, the language toggle and the
// service worker. Each tool's own script is loaded separately by its page.

// Request location permission once at startup so it's ready when tools need it
initLocation();

// ── Language toggle ──────────────────────────────────────────────────────────

document.querySelectorAll('.lang-toggle-btn').forEach(btn => {
    btn.addEventListener('click', () => setLanguage(getLanguage() === 'en' ? 'el' : 'en'));
});

onLanguageChange(translatePage);
// Pages written in one language (the station pages): translatePage has just
// moved the address to the other language's page, so load it
if (document.documentElement.hasAttribute('data-static-language')) onLanguageChange(() => location.reload());

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
