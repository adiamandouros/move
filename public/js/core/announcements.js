import { escapeHtml, icon } from './html.js';
import { language, t } from './i18n.js';

// Service announcements from /api/announcements (server/info/announcements.js),
// shown on the home and info pages. Importing this module fills the page's
// #announcements list and #disruptions banner, if it has them.

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

const formatDate = iso => new Date(iso).toLocaleDateString(language === 'el' ? 'el-GR' : 'en-GB', { day: 'numeric', month: 'short' });

const newTab = () => `<span class="sr-only"> ${t('shell.new-tab')}</span>`;

function item({ title, link, date }, greek) {
    return `<li class="announcement">
        <a href="${escapeHtml(link)}" target="_blank" rel="noopener"><span${greek ? ' lang="el"' : ''}>${escapeHtml(title)}</span>${newTab()}</a>
        <span class="announcement-meta">${formatDate(date)}${greek ? ` · ${t('announcements.in-greek')}` : ''}</span>
    </li>`;
}

// Items already in the disruption banner aren't repeated in the list
function group(titleKey, items, more, greek) {
    const rest = items.filter(i => !i.disruption);
    return `<h3 class="info-subhead">${t(titleKey)}</h3>
        ${rest.length
            ? `<ul class="announcements">${rest.slice(0, SHOWN).map(i => item(i, greek)).join('')}</ul>`
            : `<p class="text-body-secondary">${t(items.length ? 'announcements.none-other' : 'announcements.none')}</p>`}
        <p class="info-source"><a href="${more}" target="_blank" rel="noopener">${t('announcements.more')}${newTab()}</a></p>`;
}

function render() {
    if (failed) {
        list.innerHTML = `<p class="text-body-secondary">${t('announcements.error')}</p>`;
        banner.innerHTML = '';
        return;
    }
    if (!data) return;
    const bus = data.bus[language];
    list.innerHTML = group('announcements.rail', data.rail, SOURCE_PAGES.rail, language !== 'el')
        + group('announcements.buses', bus, SOURCE_PAGES.bus[language], false);

    const disruptions = [...data.rail.map(i => ({ ...i, greek: language !== 'el' })), ...bus].filter(i => i.disruption);
    banner.innerHTML = disruptions.length
        ? `<div class="disruption-banner">
            <div class="fw-semibold">${icon('exclamation-triangle-fill')} ${t('announcements.disruption')}</div>
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

if (list) load();
