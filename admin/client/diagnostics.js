// /admin/diagnostics: runs the server checks (server/diagnostics.js) and shows them

const $ = id => document.getElementById(id);
const ICONS = { ok: 'check-circle-fill', warn: 'exclamation-triangle-fill', fail: 'x-octagon-fill', info: 'info-circle' };
let report = '';

function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
}

function icon(status) {
    const i = el('i', `bi bi-${ICONS[status]} diag-icon diag-${status}`);
    i.setAttribute('aria-hidden', 'true');
    return i;
}

function render({ summary, checks }) {
    const box = $('diag-summary');
    box.hidden = false;
    box.dataset.status = summary.status;
    box.replaceChildren(icon(summary.status), el('span', '', summary.text));

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
        if (c.hint) body.append(el('div', 'diag-hint', `→ ${c.hint}`));
        const label = el('span', 'sr-only', `${c.status}: `);
        row.append(icon(c.status), label, body);
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
        await navigator.clipboard.writeText(report);
        $('copy-btn').textContent = 'Copied';
    } catch {
        $('copy-btn').textContent = 'Copy failed';
    }
    setTimeout(() => { $('copy-btn').textContent = 'Copy report'; }, 2000);
});

run();
