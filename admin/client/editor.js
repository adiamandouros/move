// Station editor. Edits are queued in localStorage first and then sent to the
// server, so saving works underground; the queue is flushed whenever the
// connection comes back.
import { distanceMeters } from '/js/core/geo.js';
import { checks, field, rowList } from './lists.js';
import { missing, missingAtStation } from './missing.js';
import { here, placeField } from './place.js';

const STATE_URL = '/admin/api/state';
const QUEUE_KEY = 'move-admin:queue';
const LAST_KEY = 'move-admin:selection';
const RETRY_MS = 30_000;

const $ = id => document.getElementById(id);
const POSITION_LABELS = { 'back': 'Back', 'center-back': 'Near back', 'center': 'Center', 'center-front': 'Near front', 'front': 'Front' };
const WAY_LABELS = { 'stairs': 'Stairs', 'escalator-up': 'Escalator up', 'escalator-down': 'Escalator down' };

let state = null;
let selection = { line: null, dir: null, station: null };
let syncing = false;
let elevatorRows = null;
let exitRows = null;
let streetLiftRows = null;
// The form as it was drawn, for each part, so Save sends only what changed
let shown = new Map();

// ── Storage ─────────────────────────────────────────────────────────────────

function readStore(key, fallback) {
    try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
}

function writeStore(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* private mode — edits just won't survive a reload */ }
}

const queue = () => readStore(QUEUE_KEY, []);

// ── Entries ─────────────────────────────────────────────────────────────────

// What the editor edits: a platform's entry in positions.json, and a
// station's in street.json. A ref ({ line, dir, station }, or { kind:
// 'street', station }) and each queued edit say which; one without a kind
// is a platform's, as edits were queued before there was a second.
const KINDS = {
    positions: {
        key: r => `${r.line}/${r.dir}/${r.station}`,
        url: r => `/admin/api/positions/${[r.line, r.dir, r.station].map(encodeURIComponent).join('/')}`,
        data: () => state,
        get: (tree, r) => tree[r.line]?.[r.dir]?.[r.station],
        put: (tree, r, entry) => { ((tree[r.line] ??= {})[r.dir] ??= {})[r.station] = entry; },
        drop: (tree, r) => { delete tree[r.line]?.[r.dir]?.[r.station]; },
        blank: { exits: [] },
        file: 'positions.json',
    },
    street: {
        key: r => `street/${r.station}`,
        url: r => `/admin/api/street/${encodeURIComponent(r.station)}`,
        // (an older copy of the data, from before street.json, has none)
        data: () => state.street ?? { committed: {}, overlay: {} },
        get: (tree, r) => tree[r.station],
        put: (tree, r, entry) => { tree[r.station] = entry; },
        drop: (tree, r) => { delete tree[r.station]; },
        blank: {},
        file: 'street.json',
    },
};
const kindOf = r => KINDS[r.kind ?? 'positions'];
const refKey = r => kindOf(r).key(r);
const stationRef = station => ({ kind: 'street', station });

const committedEntry = r => kindOf(r).get(kindOf(r).data().committed, r);
const overlayEntry = r => kindOf(r).get(kindOf(r).data().overlay, r);
const pendingOp = r => queue().find(op => refKey(op) === refKey(r));

function currentEntry(r) {
    const op = pendingOp(r);
    const committed = committedEntry(r) ?? kindOf(r).blank;
    if (op) return op.entry ?? committed;
    return overlayEntry(r) ?? committed;
}

function entryState(r) {
    const op = pendingOp(r);
    if (op) return op.entry ? 'pending' : 'pending-revert';
    return overlayEntry(r) ? 'edited' : 'committed';
}

// Every platform of a station, on each line and direction that serves it
const platformsOf = station => state.stations[station].lines.flatMap(line =>
    Object.entries(state.lines[line].directions)
        .filter(([, d]) => d.stations.includes(station))
        .map(([dir]) => ({ line, dir, station })));

// What the station needs, whichever platform it's seen from
const stationGaps = station => missingAtStation(
    currentEntry(stationRef(station)), state.stasyLifts?.[station] ?? [], platformsOf(station).map(currentEntry));

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
        const states = [entryState(ref), entryState(stationRef(id))];
        const gaps = [...new Set([...missing(currentEntry(ref)), ...stationGaps(id)])];
        const marks = [
            states.some(st => st.startsWith('pending')) ? '⏳' : states.includes('edited') ? '✎' : '',
            gaps.length ? `⚠ ${gaps.join(', ')}` : '',
        ].filter(Boolean).join(' ');
        return new Option(`${s.name.en} · ${s.name.el}${marks ? `  ${marks}` : ''}`, id, false, id === station);
    }));
}

// ── Entry form ──────────────────────────────────────────────────────────────

function carToggles(container, key, selected) {
    container.dataset.field = key;
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

// STASY's names for the station's lifts, each once
const stasyNames = station => [...new Set(state.stasyLifts?.[station] ?? [])];

// Whether the platform's elevators are known: '' (not yet), 'none' or 'list'
const elevatorsKnown = () => document.querySelector('input[name="elevators-known"]:checked')?.value ?? '';

function showElevatorList() {
    const list = elevatorsKnown() === 'list';
    $('elevator-list').hidden = !list;
    $('elevator-list').disabled = !list;
    if (list && !elevatorRows.size) elevatorRows.add();
}

// An elevator's name, STASY's offered
function liftName(fields, name) {
    const names = stasyNames(selection.station);
    return field(fields, 'Name', name, {
        list: 'stasy-lifts',
        wide: true,
        check: value => value.trim() && names.length && !names.includes(value.trim()) ? { warn: 'Not one of STASY\'s names for this station.' } : '',
    });
}

// Where on the street a station's exit or elevator is
const place = (fields, coords) => placeField(fields, coords, { station: state.stations[selection.station].coords, bounds: state.bounds });

// One elevator of the platform: its name and where on the platform it is
function elevatorRow(fields, lift) {
    const name = liftName(fields, lift.name);
    const at = field(fields, 'Where', lift.at ?? '', {
        options: [['', 'Choose…'], ...state.positions.map(p => [p, POSITION_LABELS[p] ?? p])],
        required: true,
    });
    return () => ({ at: at.value, name: name.value.trim() });
}

// One exit to the street: its name as the signs inside write it, in English
// too when they do, where it comes out and how it's reached from inside
function exitRow(fields, exit) {
    const el = field(fields, 'Name, as signed', exit.name?.el, { wide: true });
    const en = field(fields, 'In English, if signed', exit.name?.en, { wide: true });
    const coords = place(fields, exit.coords);
    const way = checks(fields, 'How it\'s reached', state.exitWays.map(w => [w, WAY_LABELS[w] ?? w]), exit.way);
    return () => ({ name: { el: el.value.trim(), en: en.value.trim() }, coords: coords(), way: way() });
}

// One elevator to the street: its name and where it comes out
function streetLiftRow(fields, lift) {
    const name = liftName(fields, lift.name);
    const coords = place(fields, lift.coords);
    return () => ({ name: name.value.trim(), coords: coords() });
}

function renderEntry() {
    renderForm();
    renderStatus();
}

// Where the platform's and the station's edits are, and what they still need
function renderStatus() {
    const labels = file => ({
        committed: 'Same as the committed data.',
        edited: `Edited — not committed to git yet. Use Export to get the updated ${file}.`,
        pending: 'Saved on this device — waiting to sync.',
        'pending-revert': 'Revert saved on this device — waiting to sync.',
    });
    const parts = [
        [{ ...selection }, 'entry', 'positions.json', $('revert-platform'), missing(currentEntry(selection))],
        [stationRef(selection.station), 'street', 'street.json', $('revert-station'), stationGaps(selection.station)],
    ];
    for (const [ref, id, file, revert, gaps] of parts) {
        const st = entryState(ref);
        $(`${id}-state`).textContent = labels(file)[st];
        $(`${id}-state`).dataset.state = st;
        revert.hidden = st === 'committed';
        $(`${id}-missing`).hidden = !gaps.length;
        $(`${id}-missing`).textContent = `Missing: ${gaps.join(', ')}.`;
    }
}

// The form, with the platform's and the station's entries as they are now
function renderForm() {
    const ref = selection;
    const entry = currentEntry(ref);
    $('entry-form').hidden = false;
    $('entry-message').textContent = '';

    carToggles(document.querySelector('[data-field="exits"]'), 'exits', entry.exits ?? []);
    for (const name of ['escalators', 'stairs']) carToggles(document.querySelector(`[data-field="${name}"]`), name, entry[name] ?? []);

    // (an elevator from before they had names is a plain position)
    const elevators = Array.isArray(entry.elevators) ? entry.elevators.map(lift => typeof lift === 'string' ? { at: lift } : lift) : [];
    const known = entry.elevators === 'none' ? 'none' : elevators.length ? 'list' : '';
    document.querySelector(`input[name="elevators-known"][value="${known}"]`).checked = true;
    $('stasy-lifts').replaceChildren(...stasyNames(ref.station).map(name => new Option(name)));
    elevatorRows.set(elevators);
    showElevatorList();
    $('central-platform').checked = Boolean(entry.centralPlatform);
    $('step-free').value = entry.stepFree ?? '';
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

    // The whole station
    $('street-part').hidden = !state.street;
    const station = stationRef(ref.station);
    const street = currentEntry(station);
    exitRows.set(street.exits ?? []);
    streetLiftRows.set(street.lifts ?? []);

    shown = new Map([[refKey(ref), JSON.stringify(readPlatform())], [refKey(station), JSON.stringify(readStation())]]);
}

function readPlatform() {
    const transfers = {};
    document.querySelectorAll('#transfers [data-field^="transfer:"]').forEach(el => {
        const list = pressed(el);
        if (list.length) transfers[el.dataset.field.slice('transfer:'.length)] = list;
    });
    const known = elevatorsKnown();
    return {
        exits: pressed(document.querySelector('[data-field="exits"]')),
        // Left out while not known
        ...(known === 'none' && { elevators: 'none' }),
        ...(known === 'list' && { elevators: elevatorRows.read() }),
        escalators: pressed(document.querySelector('[data-field="escalators"]')),
        stairs: pressed(document.querySelector('[data-field="stairs"]')),
        centralPlatform: $('central-platform').checked,
        // '' (not known yet) is left out
        ...($('step-free').value && { stepFree: $('step-free').value }),
        transfers,
        note: $('note').value.trim(),
    };
}

const readStation = () => ({ exits: exitRows.read(), lifts: streetLiftRows.read() });

// The parts of the form that changed since it was drawn, as [ref, entry]
function changes() {
    const parts = [[{ ...selection }, readPlatform()]];
    if (state.street) parts.push([stationRef(selection.station), readStation()]);
    return parts.filter(([ref, entry]) => JSON.stringify(entry) !== shown.get(refKey(ref)));
}

// ── Queue and sync ──────────────────────────────────────────────────────────

// Queue edits, each [ref, entry] (null: back to the committed one), in place
// of any waiting for the same platform or station
function enqueue(...edits) {
    const at = Date.now();
    let next = queue();
    for (const [ref, entry] of edits) next = [...next.filter(o => refKey(o) !== refKey(ref)), { ...ref, entry, at }];
    writeStore(QUEUE_KEY, next);
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
            const kind = kindOf(op);
            let res;
            try {
                res = op.entry
                    ? await fetch(kind.url(op), { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ entry: op.entry }) })
                    : await fetch(kind.url(op), { method: 'DELETE' });
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
                if (body.edited) kind.put(kind.data().overlay, op, body.entry);
                else kind.drop(kind.data().overlay, op);
            } else {
                message = `Couldn't save ${state.stations[op.station]?.name.en ?? op.station}: ${(body.details ?? [body.error]).join('; ')}`;
            }
            // Done with this op (saved, or rejected as invalid); two queued
            // by one Save share the time
            writeStore(QUEUE_KEY, queue().filter(o => o.at !== op.at || refKey(o) !== refKey(op)));
        }
        // Refresh from the server so the offline copy includes what was just saved
        if (saved) state = (await fetchState().catch(() => null)) ?? state;
    } finally {
        syncing = false;
    }
    renderSyncStatus(message);
    renderPickers();
    renderStatus();
    // The form again, unless it has something not saved yet
    if (!changes().length) renderForm();
    // Edits saved while this round was running
    if (!message && queue().length) sync();
}

// ── Nearest station ─────────────────────────────────────────────────────────

async function nearestStation() {
    $('nearest-btn').disabled = true;
    try {
        const { lat, lng } = await here();
        const away = id => distanceMeters(lat, lng, ...state.stations[id].coords);
        const best = Object.keys(state.stations).reduce((a, b) => away(b) < away(a) ? b : a);
        const lines = state.stations[best].lines;
        select({ ...selection, line: lines.includes(selection.line) ? selection.line : lines[0], station: best });
    } catch {
        $('entry-message').textContent = 'Location is unavailable.';
    } finally {
        $('nearest-btn').disabled = false;
    }
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

    elevatorRows = rowList($('elevator-rows'), $('add-elevator'), 'Elevator', elevatorRow);
    exitRows = rowList($('street-exit-rows'), $('add-street-exit'), 'Exit', exitRow);
    streetLiftRows = rowList($('street-lift-rows'), $('add-street-lift'), 'Street elevator', streetLiftRow);
    document.querySelectorAll('input[name="elevators-known"]').forEach(radio => radio.addEventListener('change', showElevatorList));

    select(readStore(LAST_KEY, {}));
    renderSyncStatus();

    $('station-picker').addEventListener('change', e => select({ ...selection, station: e.target.value }));
    $('nearest-btn').addEventListener('click', nearestStation);
    $('entry-form').addEventListener('submit', e => {
        e.preventDefault();
        const edits = changes();
        if (edits.length) enqueue(...edits);
        else $('entry-message').textContent = 'Nothing has changed.';
    });
    $('revert-platform').addEventListener('click', () => enqueue([{ ...selection }, null]));
    $('revert-station').addEventListener('click', () => enqueue([stationRef(selection.station), null]));

    window.addEventListener('online', () => sync());
    setInterval(() => sync(), RETRY_MS);
    sync();
}

if ('serviceWorker' in navigator) navigator.serviceWorker.register('/admin/sw.js', { scope: '/admin/' });
start();
