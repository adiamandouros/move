// /admin/diagnostics: runs the server checks (server/diagnostics.js) and shows them

import { icon, setHtml } from '/js/core/html.js';
import { progressBar } from './progress.js';

const $ = id => document.getElementById(id);
const ICONS = { ok: 'ok', warn: 'warning', fail: 'error', info: 'info' };
let report = '';

function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
}

// The element an html`` view makes
function node(view) {
    const box = document.createElement('template');
    setHtml(box, view);
    return box.content.firstChild;
}

const statusIcon = status => node(icon(ICONS[status], `diag-icon diag-${status}`));

function render({ summary, checks }) {
    const box = $('diag-summary');
    box.hidden = false;
    box.dataset.status = summary.status;
    box.replaceChildren(statusIcon(summary.status), el('span', '', summary.text));

    const groups = [];
    let current = null;
    for (const c of checks) {
        if (c.group !== current?.dataset.group) {
            current = el('section', 'diag-group');
            current.dataset.group = c.group;
            current.append(el('h2', 'diag-group-title', c.group));
            groups.push(current);
        }
        const row = el('div', 'diag-row');
        const body = el('div', 'diag-body');
        body.append(el('div', 'diag-title', c.title), el('div', 'diag-detail', c.detail));
        if (c.progress) body.append(node(progressBar(c.progress)));
        if (c.hint) body.append(el('div', 'diag-hint', `→ ${c.hint}`));
        const label = el('span', 'sr-only', `${c.status}: `);
        row.append(statusIcon(c.status), label, body);
        current.append(row);
    }
    $('diag-checks').replaceChildren(...groups);
}

async function run() {
    const btn = $('run-btn');
    btn.disabled = true;
    btn.textContent = 'Running…';
    try {
        const res = await fetch('/admin/api/diagnostics');
        if (res.status === 401) { location.href = '/admin/login'; return; }
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const result = await res.json();
        report = result.report;
        render(result);
        $('copy-btn').hidden = false;
    } catch (err) {
        $('diag-summary').hidden = false;
        $('diag-summary').dataset.status = 'fail';
        $('diag-summary').textContent = `Couldn't run the checks: ${err.message}. If the app is down, use "npm run diagnose" instead.`;
    } finally {
        btn.disabled = false;
        btn.textContent = 'Run checks again';
    }
}

$('run-btn').addEventListener('click', run);
$('copy-btn').addEventListener('click', async () => {
    try {
        // The accessibility check (accessibility.js) adds its results, once it has run
        await navigator.clipboard.writeText([report, window.accessibilityReport].filter(Boolean).join('\n\n'));
        $('copy-btn').textContent = 'Copied';
    } catch {
        $('copy-btn').textContent = 'Copy failed';
    }
    setTimeout(() => { $('copy-btn').textContent = 'Copy report'; }, 2000);
});

run();
