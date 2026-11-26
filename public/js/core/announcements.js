import { closableNotice, externalLink, format, html, icon, notice, safeUrl, setHtml } from './html.js';
import { language, localHref, t } from './i18n.js';

// Service announcements from /api/announcements (server/info/announcements.js),
// shown on the home and info pages. Importing this module fills the page's
// #announcements list and #disruptions banner, if it has them; on Home,
// #home-status and #disruptions (decision 81): "No disruptions" at the top
// right, or a disruption as one closed line under it. Titles and
// links come from OASA's and STASY's websites, and strikes from apergia.gr's
// (banner only, decision 71): escaped by html``, and only web addresses are
// linked (the server drops the rest too).

const SOURCE_PAGES = {
    rail: 'https://www.stasy.gr/%ce%bd%ce%ad%ce%b1-%ce%b1%ce%bd%ce%b1%ce%ba%ce%bf%ce%b9%ce%bd%cf%8e%cf%83%ce%b5%ce%b9%cf%82/',
    bus: { el: 'https://www.oasa.gr/%ce%b1%ce%bd%ce%b1%ce%ba%ce%bf%ce%b9%ce%bd%cf%8e%cf%83%ce%b5%ce%b9%cf%82/', en: 'https://www.oasa.gr/en/passenger-service/announcements/' },
};

// Newest announcements shown per group; the rest are a link away
const SHOWN = 3;

// The server's sources (server/info/announcements.js) each page reads
const SOURCES = { el: ['stasy', 'oasaEl', 'apergia'], en: ['stasy', 'oasaEn', 'apergia'] };

const list = document.getElementById('announcements');
const banner = /** @type {HTMLElement} */ (document.getElementById('disruptions'));
const homeStatus = document.getElementById('home-status');
/**
 * An announcement as /api/announcements sends it; greek: in Greek on an
 * English page (the rail's, which STASY writes in Greek only, and the
 * strikes'); until: when a strike ends; via: whose words they are, if not
 * the operator's
 * @typedef {{ title: string, link: string, date: string, until?: string, disruption?: boolean, greek?: boolean, via?: string }} Announcement
 * @typedef {{ rail: Announcement[], bus: Record<'el' | 'en', Announcement[]>, strikes?: Announcement[], available: string[] }} Announcements
 */
/** @type {Announcements | null} */
let data = null;
let failed = false;

// The day in Athens, wherever the device is: a strike's day starts at
// midnight there (decision 71)
const DAY = new Intl.DateTimeFormat(language === 'el' ? 'el-GR' : 'en-GB', { day: 'numeric', month: 'short', timeZone: 'Europe/Athens' });
/** @param {string} iso */
const formatDate = iso => DAY.format(new Date(iso));

// One announcement; exported for the tests
/** @param {Announcement} announcement @param {boolean | undefined} greek */
export function item({ title, link, date, via }, greek) {
    const text = html`<span${greek && html` lang="el"`}>${title}</span>`;
    const url = safeUrl(link);
    return html`<li class="announcement">
        ${url ? externalLink({ href: url }, text, t('shell.new-tab')) : text}
        <span class="announcement-meta">${formatDate(date)}${via && html` · ${format(t('announcements.via'), { source: via })}`}${greek && html` <span class="tag ms-1">${icon('in-greek', 'me-1')}${t('announcements.in-greek')}</span>`}</span>
    </li>`;
}

// Items already in the disruption banner aren't repeated in the list
/** @param {string} titleKey @param {Announcement[]} items @param {string} more @param {boolean} greek */
function group(titleKey, items, more, greek) {
    const rest = items.filter(i => !i.disruption);
    return html`<h3 class="info-subhead">${t(titleKey)}</h3>
        ${rest.length
            ? html`<ul class="announcements">${rest.slice(0, SHOWN).map(i => item(i, greek))}</ul>`
            : html`<p class="text-body-secondary">${t(items.length ? 'announcements.none-other' : 'announcements.none')}</p>`}
        <p class="info-source">${externalLink({ href: more }, t('announcements.more'), t('shell.new-tab'))}</p>`;
}

// What goes in #disruptions: the banner, or a quiet box saying there are no
// such announcements, so people learn where they'd be. Only when every source
// the page reads answered: "none" can't be said of one we couldn't read.
// Exported for the tests.
/** @param {Announcements} announcements */
// A strike from apergia.gr comes first, in their words and with their name
// (decision 71); an older server sends none.
export function disruptionView(announcements) {
    const disruptions = disruptionsOf(announcements);
    if (disruptions.length) {
        return notice('warn', 'warning', html`<div class="fw-semibold">${t('announcements.disruption')}</div>
            <ul>${disruptions.map(i => item(i, i.greek))}</ul>`, 'disruption-banner mb-3');
    }
    if (!allAnswered(announcements)) return '';
    return notice('ok', 'ok', t('announcements.no-disruptions'), 'no-disruptions mb-3');
}

// The disruptions, a strike first; those in Greek on an English page marked
/** @param {Announcements} announcements @returns {Announcement[]} */
const disruptionsOf = ({ rail, bus, strikes = [] }) => [
    ...strikes.map(i => ({ ...i, greek: language !== 'el', via: 'apergia.gr' })),
    ...rail.map(i => ({ ...i, greek: language !== 'el' })), ...bus[language],
].filter(i => i.disruption);

// Every source the page reads answered
/** @param {Announcements} announcements */
const allAnswered = ({ available }) => SOURCES[language].every(source => available.includes(source));

// Home's (decision 81): `status`, "No disruptions" at the top right once
// every source answered with none; `line`, the disruptions as one closed
// line under it: the first one's title, cut to the line, and how many more;
// opened, each of them and the way to every announcement on Info.
// Exported for the tests.
/** @param {Announcements} announcements @returns {{ status: import('./html.js').Html | '', line: import('./html.js').Html | '' }} */
export function homeView(announcements) {
    const disruptions = disruptionsOf(announcements);
    if (!disruptions.length) {
        return { status: allAnswered(announcements) ? html`<span class="status-chip">${icon('ok')}${t('near.no-disruptions')}</span>` : '', line: '' };
    }
    const [first] = disruptions;
    const more = disruptions.length - 1;
    const summary = html`<span class="disruption-first"><span class="sr-only">${t('announcements.disruption')}: </span><span${first.greek && html` lang="el"`}>${first.title}</span></span>${more > 0 && html`<span class="disruption-more">${format(t('near.disruptions-more'), { count: more })}</span>`}`;
    const content = html`<ul>${disruptions.map(i => item(i, i.greek))}</ul>
        <p class="mb-0"><a href="${localHref('/info')}#announcements">${t('announcements.more')}</a></p>`;
    return { status: '', line: closableNotice('warn', 'warning', summary, content, 'disruption-line mb-3', false) };
}

function render() {
    if (homeStatus) { renderHome(); return; }
    if (!list) return;
    if (failed) {
        setHtml(list, html`<p class="text-body-secondary">${t('announcements.error')}</p>`);
        setHtml(banner, '');
        return;
    }
    if (!data) return;
    const bus = data.bus[language];
    setHtml(list, html`${group('announcements.rail', data.rail, SOURCE_PAGES.rail, language !== 'el')}${group('announcements.buses', bus, SOURCE_PAGES.bus[language], false)}`);

    setHtml(banner, disruptionView(data));
}

// Home: nothing said when they couldn't be loaded, as nothing can be said
// of what's running; opened, the line stays open as it's drawn again
function renderHome() {
    if (!homeStatus || failed || !data) return;
    const { status, line } = homeView(data);
    setHtml(homeStatus, status);
    const open = banner.querySelector('details')?.open ?? false;
    setHtml(banner, line);
    if (open) banner.querySelector('details')?.setAttribute('open', '');
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

if (list || homeStatus) load();
