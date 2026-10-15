import { escapeHtml } from './html.js';
import { t } from './i18n.js';
import { getLanguage, onLanguageChange } from './settings.js';

// Service announcements from /api/announcements (server/info/announcements.js),
// shown on the home and info pages. Importing this module fills the page's
// #announcements list and #disruptions banner, if it has them, and redraws
// them when the language changes.

const SOURCE_PAGES = {
    rail: 'https://www.stasy.gr/%ce%bd%ce%ad%ce%b1-%ce%b1%ce%bd%ce%b1%ce%ba%ce%bf%ce%b9%ce%bd%cf%8e%cf%83%ce%b5%ce%b9%cf%82/',
    bus: { el: 'https://www.oasa.gr/%ce%b1%ce%bd%ce%b1%ce%ba%ce%bf%ce%b9%ce%bd%cf%8e%cf%83%ce%b5%ce%b9%cf%82/', en: 'https://www.oasa.gr/en/passenger-service/announcements/' },
};

// Newest announcements shown per group; the rest are a link away
const SHOWN = 3;

const list = document.getElementById('announcements');
const banner = document.getElementById('disruptions');
let data = null;
let failed = false;

const formatDate = iso => new Date(iso).toLocaleDateString(getLanguage() === 'el' ? 'el-GR' : 'en-GB', { day: 'numeric', month: 'short' });

function item({ title, link, date }, greek) {
    return `<li class="announcement">
        <a href="${escapeHtml(link)}" target="_blank" rel="noopener"${greek ? ' lang="el" class="any-lang"' : ''}>${escapeHtml(title)}</a>
        <span class="announcement-meta">${formatDate(date)}${greek ? ` · ${t('announcements.in-greek')}` : ''}</span>
    </li>`;
}

function group(titleKey, items, more, greek) {
    return `<h2 class="info-subhead">${t(titleKey)}</h2>
        ${items.length
            ? `<ul class="announcements">${items.slice(0, SHOWN).map(i => item(i, greek)).join('')}</ul>`
            : `<p class="text-secondary">${t('announcements.none')}</p>`}
        <p class="info-source"><a href="${more}" target="_blank" rel="noopener">${t('announcements.more')}</a></p>`;
}

function render() {
    if (failed) {
        list.innerHTML = `<p class="text-secondary">${t('announcements.error')}</p>`;
        banner.innerHTML = '';
        return;
    }
    if (!data) return;
    const lang = getLanguage() === 'el' ? 'el' : 'en';
    const bus = data.bus[lang];
    list.innerHTML = group('announcements.rail', data.rail, SOURCE_PAGES.rail, lang !== 'el')
        + group('announcements.buses', bus, SOURCE_PAGES.bus[lang], false);

    const disruptions = [...data.rail.map(i => ({ ...i, greek: lang !== 'el' })), ...bus].filter(i => i.disruption);
    banner.innerHTML = disruptions.length
        ? `<div class="disruption-banner" role="status">
            <div class="fw-semibold"><i class="bi bi-exclamation-triangle-fill" aria-hidden="true"></i> ${t('announcements.disruption')}</div>
            <ul>${disruptions.map(i => item(i, i.greek)).join('')}</ul>
        </div>`
        : '';
}

async function load() {
    try {
        const res = await fetch('/api/announcements');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        data = await res.json();
    } catch {
        failed = true;
    }
    render();
}

if (list) {
    onLanguageChange(render);
    load();
}
