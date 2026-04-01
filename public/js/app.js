import { initLocation } from './location.js';
import { loadNearbyBuses, unloadNearbyBuses } from './tools/nearbyBuses.js';
import { loadSubwayPosition, unloadSubwayPosition } from './tools/subwayPosition.js';
import { getLanguage, setLanguage, onLanguageChange } from './settings.js';
import { t } from './i18n.js';

// Request location permission once at startup so it's ready when tools need it
initLocation();

const content = document.getElementById('app-content');
const navButtons = document.querySelectorAll('.nav-btn[data-tool]');

const tools = {
    'nearby-buses':    { load: loadNearbyBuses,    unload: unloadNearbyBuses },
    'subway-position': { load: loadSubwayPosition, unload: unloadSubwayPosition },
};

let activeTool = null;

function activateTool(toolName) {
    if (activeTool && tools[activeTool]?.unload) {
        tools[activeTool].unload();
    }

    activeTool = toolName;

    navButtons.forEach(btn => {
        const isActive = btn.dataset.tool === toolName;
        btn.classList.toggle('active', isActive);
        btn.setAttribute('aria-current', isActive ? 'page' : 'false');
    });

    tools[toolName]?.load(content);

    // Move focus to the main content area when a tool is activated
    content.focus();
}

navButtons.forEach(btn => {
    btn.addEventListener('click', () => activateTool(btn.dataset.tool));
});

// ── Language toggle ──────────────────────────────────────────────────────────

function updateLangUI(lang) {
    document.querySelectorAll('.lang-opt').forEach(opt => {
        opt.classList.toggle('active', opt.dataset.lang === lang);
    });
    document.querySelectorAll('[data-i18n]').forEach(el => {
        el.textContent = t(el.dataset.i18n);
    });
}

['lang-toggle-side', 'lang-toggle-bottom'].forEach(id => {
    document.getElementById(id)?.addEventListener('click', () => {
        setLanguage(getLanguage() === 'en' ? 'el' : 'en');
    });
});

// Apply on load, then keep in sync
updateLangUI(getLanguage());
onLanguageChange(updateLangUI);
