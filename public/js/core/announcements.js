import { externalLink, html, icon, safeUrl, setHtml } from './html.js';
import { language, t } from './i18n.js';

// Service announcements from /api/announcements (server/info/announcements.js),
// shown on the home and info pages. Importing this module fills the page's
// #announcements list and #disruptions banner, if it has them. Titles and
// links come from OASA's and STASY's websites: escaped by html``, and only
// web addresses are linked (the server drops the rest too).

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

// One announcement; exported for the tests
export function item({ title, link, date }, greek) {
    const text = html`<span${greek && html` lang="el"`}>${title}</span>`;
    const url = safeUrl(link);
    return html`<li class="announcement">
        ${url ? externalLink({ href: url }, text, t('shell.new-tab')) : text}
        <span class="announcement-meta">${formatDate(date)}${greek && ` · ${t('announcements.in-greek')}`}</span>
    </li>`;
}

// Items already in the disruption banner aren't repeated in the list
function group(titleKey, items, more, greek) {
    const rest = items.filter(i => !i.disruption);
    return html`<h3 class="info-subhead">${t(titleKey)}</h3>
        ${rest.length
            ? html`<ul class="announcements">${rest.slice(0, SHOWN).map(i => item(i, greek))}</ul>`
            : html`<p class="text-body-secondary">${t(items.length ? 'announcements.none-other' : 'announcements.none')}</p>`}
        <p class="info-source">${externalLink({ href: more }, t('announcements.more'), t('shell.new-tab'))}</p>`;
}

function render() {
    if (failed) {
        setHtml(list, html`<p class="text-body-secondary">${t('announcements.error')}</p>`);
        setHtml(banner, '');
        return;
    }
    if (!data) return;
    const bus = data.bus[language];
    setHtml(list, html`${group('announcements.rail', data.rail, SOURCE_PAGES.rail, language !== 'el')}${group('announcements.buses', bus, SOURCE_PAGES.bus[language], false)}`);

    const disruptions = [...data.rail.map(i => ({ ...i, greek: language !== 'el' })), ...bus].filter(i => i.disruption);
    setHtml(banner, disruptions.length
        ? html`<div class="disruption-banner">
            <div class="fw-semibold">${icon('exclamation-triangle-fill')} ${t('announcements.disruption')}</div>
            <ul>${disruptions.map(i => item(i, i.greek))}</ul>
        </div>`
        : '');
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
