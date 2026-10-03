import { initLocation } from './location.js';
import { getLanguage, setLanguage, onLanguageChange } from './settings.js';
import { translatePage } from './i18n.js';

// Shared by every page: location tracking, the language toggle and the
// service worker. Each tool's own script is loaded separately by its page.

// Request location permission once at startup so it's ready when tools need it
initLocation();

// ── Language toggle ──────────────────────────────────────────────────────────

document.querySelectorAll('.lang-toggle-btn').forEach(btn => {
    btn.addEventListener('click', () => setLanguage(getLanguage() === 'en' ? 'el' : 'en'));
});

onLanguageChange(translatePage);

// ── Service worker ───────────────────────────────────────────────────────────

if ('serviceWorker' in navigator) {
    // Reload once a new version takes over, but not on the very first install
    const hadController = Boolean(navigator.serviceWorker.controller);
    navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (hadController) window.location.reload();
    });
    navigator.serviceWorker.register('/sw.js');
}
