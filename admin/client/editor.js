// Station editor. Edits are queued in localStorage first and then sent to the
// server, so saving works underground; the queue is flushed whenever the
// connection comes back.

const STATE_URL = '/admin/api/state';
const QUEUE_KEY = 'move-admin:queue';
const LAST_KEY = 'move-admin:selection';
const RETRY_MS = 30_000;

const $ = id => document.getElementById(id);
const POSITION_LABELS = { 'back': 'Back', 'center-back': 'Near back', 'center': 'Center', 'center-front': 'Near front', 'front': 'Front' };

let state = null;
let selection = { line: null, dir: null, station: null };
let syncing = false;

// ── Storage ─────────────────────────────────────────────────────────────────

function readStore(key, fallback) {
    try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
}

function writeStore(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* private mode — edits just won't survive a reload */ }
}

const refKey = r => `${r.line}/${r.dir}/${r.station}`;
const queue = () => readStore(QUEUE_KEY, []);

// ── Entries ─────────────────────────────────────────────────────────────────

const committedEntry = r => state.committed[r.line]?.[r.dir]?.[r.station];
const overlayEntry = r => state.overlay[r.line]?.[r.dir]?.[r.station];
const pendingOp = r => queue().find(op => refKey(op) === refKey(r));

function currentEntry(r) {
    const op = pendingOp(r);
    if (op) return op.entry ?? committedEntry(r) ?? { exits: [] };
    return overlayEntry(r) ?? committedEntry(r) ?? { exits: [] };
}

function entryState(r) {
    const op = pendingOp(r);
    if (op) return op.entry ? 'pending' : 'pending-revert';
    return overlayEntry(r) ? 'edited' : 'committed';
}

// ── Pickers ─────────────────────────────────────────────────────────────────

function button(label, pressed, onClick, color) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'btn btn-sm picker-btn';
    b.textContent = label;
    b.setAttribute('aria-pressed', String(pressed));
    if (color) b.style.setProperty('--line-color', color);
    b.addEventListener('click', onClick);
    return b;
}

function select(next) {
    const line = state.lines[next.line] ? next.line : Object.keys(state.lines)[0];
    const dirs = state.lines[line].directions;
    const dir = dirs[next.dir] ? next.dir : Object.keys(dirs)[0];
    const stations = dirs[dir].stations;
    const station = stations.includes(next.station) ? next.station : stations[0];
    selection = { line, dir, station };
    writeStore(LAST_KEY, selection);
    renderPickers();
    renderEntry();
}

function renderPickers() {
    const { line, dir, station } = selection;

    $('line-picker').replaceChildren(...Object.entries(state.lines).map(([id, l]) =>
        button(l.name, id === line, () => select({ ...selection, line: id }), l.color)));

    $('dir-picker').replaceChildren(...Object.entries(state.lines[line].directions).map(([id, d]) =>
        button(`→ ${d.toward.en}`, id === dir, () => select({ ...selection, dir: id }))));

    const picker = $('station-picker');
    picker.replaceChildren(...state.lines[line].directions[dir].stations.map(id => {
        const ref = { line, dir, station: id };
        const s = state.stations[id];
        const marks = [
            entryState(ref).startsWith('pending') ? '⏳' : entryState(ref) === 'edited' ? '✎' : '',
            currentEntry(ref).exits?.length ? '' : '⚠',
        ].filter(Boolean).join(' ');
        return new Option(`${s.name.en} · ${s.name.el}${marks ? `  ${marks}` : ''}`, id, false, id === station);
    }));
}

// ── Entry form ──────────────────────────────────────────────────────────────

function carToggles(container, field, selected) {
    container.dataset.field = field;
    container.replaceChildren(...state.positions.map(p => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'car-toggle';
        b.dataset.position = p;
        b.textContent = POSITION_LABELS[p] ?? p;
        b.setAttribute('aria-pressed', String(selected.includes(p)));
        b.addEventListener('click', () => b.setAttribute('aria-pressed', String(b.getAttribute('aria-pressed') !== 'true')));
        return b;
    }));
}

const pressed = container => [...container.querySelectorAll('[aria-pressed="true"]')].map(b => b.dataset.position);

function renderEntry() {
    const ref = selection;
    const entry = currentEntry(ref);
    $('entry-form').hidden = false;

    const labels = {
        committed: 'Same as the committed data.',
        edited: 'Edited — not committed to git yet. Use Export to get the updated positions.json.',
        pending: 'Saved on this device — waiting to sync.',
        'pending-revert': 'Revert saved on this device — waiting to sync.',
    };
    const st = entryState(ref);
    $('entry-state').textContent = labels[st];
    $('entry-state').dataset.state = st;
    $('revert-btn').hidden = st === 'committed';
    $('entry-message').textContent = '';

    carToggles(document.querySelector('[data-field="exits"]'), 'exits', entry.exits ?? []);
    carToggles(document.querySelector('[data-field="elevators"]'), 'elevators', entry.elevators ?? []);
    $('central-platform').checked = Boolean(entry.centralPlatform);
    $('note').value = entry.note ?? '';

    // A transfer row for every direction of the other lines at this station
    const rows = [];
    for (const otherLine of state.stations[ref.station].lines) {
        if (otherLine === ref.line) continue;
        for (const [otherDir, d] of Object.entries(state.lines[otherLine].directions)) {
            const key = `${otherLine}/${otherDir}`;
            const fieldset = document.createElement('fieldset');
            const legend = document.createElement('legend');
            legend.textContent = `Change to ${state.lines[otherLine].name} → ${d.toward.en}`;
            const toggles = document.createElement('div');
            toggles.className = 'car-toggles';
            carToggles(toggles, `transfer:${key}`, entry.transfers?.[key] ?? []);
            fieldset.append(legend, toggles);
            rows.push(fieldset);
        }
    }
    $('transfers').replaceChildren(...rows);
}

function readForm() {
    const transfers = {};
    document.querySelectorAll('#transfers [data-field^="transfer:"]').forEach(el => {
        const list = pressed(el);
        if (list.length) transfers[el.dataset.field.slice('transfer:'.length)] = list;
    });
    return {
        exits: pressed(document.querySelector('[data-field="exits"]')),
        elevators: pressed(document.querySelector('[data-field="elevators"]')),
        centralPlatform: $('central-platform').checked,
        transfers,
        note: $('note').value.trim(),
    };
}

// ── Queue and sync ──────────────────────────────────────────────────────────

function enqueue(entry) {
    const op = { ...selection, entry, at: Date.now() };
    writeStore(QUEUE_KEY, [...queue().filter(o => refKey(o) !== refKey(op)), op]);
    renderPickers();
    renderEntry();
    renderSyncStatus();
    sync();
}

function renderSyncStatus(message = '') {
    const pending = queue().length;
    const el = $('sync-status');
    el.hidden = !pending && !message;
    el.replaceChildren();
    if (message) el.append(message);
    if (pending) {
        el.append(`${message ? ' ' : ''}${pending} edit${pending === 1 ? '' : 's'} waiting to sync. `);
        const retry = document.createElement('button');
        retry.type = 'button';
        retry.className = 'btn btn-link btn-sm p-0 align-baseline';
        retry.textContent = 'Sync now';
        retry.addEventListener('click', () => sync());
        el.append(retry);
    }
}

// Fetch the server's current data; the service worker keeps the response for offline use
async function fetchState() {
    const res = await fetch(STATE_URL);
    if (res.status === 401) { location.href = '/admin/login'; return null; }
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? `HTTP ${res.status}`);
    return res.json();
}

async function sync() {
    if (syncing || !queue().length) return;
    syncing = true;
    let message = '';
    let saved = false;
    try {
        for (const op of queue()) {
            const url = `/admin/api/positions/${encodeURIComponent(op.line)}/${encodeURIComponent(op.dir)}/${encodeURIComponent(op.station)}`;
            let res;
            try {
                res = op.entry
                    ? await fetch(url, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ entry: op.entry }) })
                    : await fetch(url, { method: 'DELETE' });
            } catch {
                message = 'Offline.';
                break;
            }
            if (res.status === 401) {
                message = 'Your session has expired — log in again to sync.';
                break;
            }
            if (res.status >= 500) {
                message = 'The server had a problem; will retry.';
                break;
            }
            const body = await res.json().catch(() => ({}));
            if (res.ok) {
                saved = true;
                const lineOverlay = ((state.overlay[op.line] ??= {})[op.dir] ??= {});
                if (body.edited) lineOverlay[op.station] = body.entry;
                else delete lineOverlay[op.station];
            } else {
                message = `Couldn't save ${state.stations[op.station]?.name.en ?? op.station}: ${(body.details ?? [body.error]).join('; ')}`;
            }
            // Done with this op (saved, or rejected as invalid)
            writeStore(QUEUE_KEY, queue().filter(o => o.at !== op.at));
        }
        // Refresh from the server so the offline copy includes what was just saved
        if (saved) state = (await fetchState().catch(() => null)) ?? state;
    } finally {
        syncing = false;
    }
    renderSyncStatus(message);
    renderPickers();
    renderEntry();
    // Edits saved while this round was running
    if (!message && queue().length) sync();
}

// ── Nearest station ─────────────────────────────────────────────────────────

function nearestStation() {
    if (!navigator.geolocation) return;
    $('nearest-btn').disabled = true;
    navigator.geolocation.getCurrentPosition(({ coords }) => {
        $('nearest-btn').disabled = false;
        let best = null;
        let bestDist = Infinity;
        for (const [id, s] of Object.entries(state.stations)) {
            const x = (s.coords[1] - coords.longitude) * Math.cos((coords.latitude * Math.PI) / 180);
            const y = s.coords[0] - coords.latitude;
            if (x * x + y * y < bestDist) { bestDist = x * x + y * y; best = id; }
        }
        const lines = state.stations[best].lines;
        select({ ...selection, line: lines.includes(selection.line) ? selection.line : lines[0], station: best });
    }, () => {
        $('nearest-btn').disabled = false;
        $('entry-message').textContent = 'Location is unavailable.';
    }, { enableHighAccuracy: true, timeout: 10_000 });
}

// ── Start ───────────────────────────────────────────────────────────────────

async function start() {
    try {
        state = await fetchState();
        if (!state) return;
    } catch (err) {
        $('load-error').hidden = false;
        $('load-error').textContent = `Couldn't load the station data (${err.message}). Open the editor once while online so it's available offline.`;
        return;
    }

    select(readStore(LAST_KEY, {}));
    renderSyncStatus();

    $('station-picker').addEventListener('change', e => select({ ...selection, station: e.target.value }));
    $('nearest-btn').addEventListener('click', nearestStation);
    $('entry-form').addEventListener('submit', e => { e.preventDefault(); enqueue(readForm()); });
    $('revert-btn').addEventListener('click', () => enqueue(null));

    window.addEventListener('online', () => sync());
    setInterval(() => sync(), RETRY_MS);
    sync();
}

if ('serviceWorker' in navigator) navigator.serviceWorker.register('/admin/sw.js', { scope: '/admin/' });
start();
