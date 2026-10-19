// /admin/diagnostics → "Check accessibility": loads each public page in a
// hidden frame at phone width, in English and Greek, waits for what its
// scripts draw, and runs axe-core (WCAG 2.2 AA and best practices) on it.

import { icon, setHtml } from '/js/core/html.js';

const $ = id => document.getElementById(id);
const ICONS = { ok: 'check-circle-fill', fail: 'x-octagon-fill', warn: 'exclamation-triangle-fill' };
const RULES = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'];
const LANGUAGES = { en: 'English', el: 'Ελληνικά' };
const WAIT_MS = 15_000;

// Each page: `ready` is its live content; `giveUp` means it showed a message
// instead (no location, no data), so it's checked but marked as incomplete.
// (The bus page's "Getting your location…" has a spinner and isn't final.)
const PAGES = [
    { name: 'Home', url: '/', ready: '#announcements .announcement, #announcements p' },
    { name: 'Subway (a route with a change)', url: '/subway?from=kifisia&to=airport', ready: '.result-card', giveUp: '#subway-result p' },
    { name: 'Buses', url: '/buses', ready: '.stop-item[data-has-arrivals="true"]', giveUp: '#bus-message:not(:has(.spin)) p', open: doc => doc.querySelector('.stop-toggle')?.click() },
    { name: 'Info (every section open)', url: '/info', ready: '#announcements .announcement, #announcements p', open: openInfo },
    { name: 'Offline', url: '/offline', ready: 'h1' },
    { name: 'Page not found', url: '/admin-accessibility-check-404', ready: 'h1' },
];

async function openInfo(doc) {
    // Twice: the station list's toggle only exists once the map section is open
    for (let i = 0; i < 2; i++) {
        doc.querySelectorAll('.accordion-button.collapsed').forEach(b => b.click());
        await sleep(800);
    }
}

// The page at url in a language: Greek ones are under /el
const localUrl = (url, lang) => lang === 'el' ? `/el${url === '/' ? '' : url}` : url;

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
}

function statusIcon(status) {
    const box = document.createElement('template');
    setHtml(box, icon(ICONS[status], `diag-icon diag-${status}`));
    return box.content.firstChild;
}

// Resolves with the frame's document once the page's content (`ready`) or its
// message (`giveUp`) appears, or after WAIT_MS; `ready` says which
function load(frame, { url, ready, giveUp }) {
    return new Promise(resolve => {
        frame.onload = async () => {
            const doc = frame.contentDocument;
            const start = Date.now();
            const settled = () => doc.querySelector(ready) || (giveUp && doc.querySelector(giveUp));
            while (!settled() && Date.now() - start < WAIT_MS) await sleep(250);
            resolve({ doc, ready: Boolean(doc.querySelector(ready)) });
        };
        frame.src = url;
    });
}

async function checkPage(frame, axeSource, page) {
    const { doc, ready } = await load(frame, page);
    await page.open?.(doc);
    await sleep(500);
    const script = doc.createElement('script');
    script.textContent = axeSource;
    doc.head.append(script);
    const result = await frame.contentWindow.axe.run(doc, { runOnly: RULES, resultTypes: ['violations'] });
    return { violations: result.violations, ready };
}

function resultRow(title, violations, ready) {
    const row = el('div', 'diag-row');
    const body = el('div', 'diag-body');
    const status = violations.length ? 'fail' : ready ? 'ok' : 'warn';
    body.append(el('div', 'diag-title', title));
    if (!ready) body.append(el('div', 'diag-hint', '→ Its live content didn\'t load (e.g. no location or no data), so only the message it showed was checked.'));
    if (!violations.length) {
        body.append(el('div', 'diag-detail', 'No problems found'));
    } else {
        const list = el('ul', 'diag-detail a11y-violations');
        for (const v of violations) {
            const item = el('li');
            const link = el('a', '', v.help);
            link.href = v.helpUrl;
            link.target = '_blank';
            link.rel = 'noopener';
            link.append(el('span', 'sr-only', ' (opens in a new tab)'));
            item.append(`[${v.impact}] `, link, ` — ${v.nodes.length}× e.g. ${v.nodes[0].target.join(' ')}`);
            list.append(item);
        }
        body.append(list);
    }
    row.append(statusIcon(status), el('span', 'sr-only', `${status}: `), body);
    return row;
}

async function run() {
    const btn = $('a11y-btn');
    const summary = $('a11y-summary');
    const results = $('a11y-results');
    btn.disabled = true;
    results.replaceChildren();
    summary.hidden = false;
    summary.dataset.status = 'info';

    // A saved language sends the public pages to that language (it's shared
    // with this page), so it's set to the one being checked and restored after
    let savedLanguage = null;
    try { savedLanguage = localStorage.getItem('language'); } catch { /* private mode */ }
    const frame = el('iframe', 'a11y-frame');
    frame.title = 'Page being checked';
    frame.setAttribute('aria-hidden', 'true');
    frame.tabIndex = -1;
    document.body.append(frame);

    const report = [];
    let problems = 0;
    let incomplete = 0;
    try {
        const res = await fetch('/admin/vendor/axe.min.js');
        if (res.status === 401) { location.href = '/admin/login'; return; }
        if (!res.ok) throw new Error((await res.text()) || `axe-core: HTTP ${res.status}`);
        const axeSource = await res.text();

        const total = PAGES.length * Object.keys(LANGUAGES).length;
        let done = 0;
        for (const page of PAGES) {
            for (const [lang, language] of Object.entries(LANGUAGES)) {
                const title = `${page.name} · ${language}`;
                summary.textContent = `Checking ${title} (${++done} of ${total})…`;
                try { localStorage.setItem('language', lang); } catch { /* private mode */ }
                let violations;
                let ready = true;
                try {
                    ({ violations, ready } = await checkPage(frame, axeSource, { ...page, url: localUrl(page.url, lang) }));
                } catch (err) {
                    violations = [{ impact: 'error', help: `Couldn't check the page: ${err.message}`, helpUrl: page.url, nodes: [{ target: [page.url] }] }];
                }
                problems += violations.length;
                if (!ready) incomplete++;
                results.append(resultRow(title, violations, ready));
                report.push(`${violations.length ? '✗' : ready ? '✓' : '?'} ${title}${ready ? '' : ' (live content did not load)'}${violations.map(v => `\n    [${v.impact}] ${v.help} (${v.nodes.length}×, e.g. ${v.nodes[0].target.join(' ')})`).join('')}`);
            }
        }
        const status = problems ? 'fail' : incomplete ? 'warn' : 'ok';
        const text = problems
            ? `${problems} accessibility problem${problems === 1 ? '' : 's'} found`
            : `No accessibility problems found on ${total} page checks`;
        summary.dataset.status = status;
        summary.replaceChildren(statusIcon(status), el('span', '', incomplete ? `${text}; ${incomplete} page${incomplete === 1 ? '' : 's'} checked before their live content loaded` : text));
        // Included in "Copy report"
        window.accessibilityReport = `Accessibility (axe-core, WCAG 2.2 AA):\n${report.join('\n')}`;
    } catch (err) {
        summary.dataset.status = 'fail';
        summary.textContent = `Couldn't run the accessibility check: ${err.message}`;
    } finally {
        try {
            if (savedLanguage === null) localStorage.removeItem('language');
            else localStorage.setItem('language', savedLanguage);
        } catch { /* private mode */ }
        frame.remove();
        btn.disabled = false;
        btn.textContent = 'Check accessibility again';
    }
}

$('a11y-btn').addEventListener('click', run);
