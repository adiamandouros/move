import { html, icon, localName, setHtml } from '/js/core/html.js';
import { language, localHref, t } from '/js/core/i18n.js';
import { lineBadge } from '/js/core/metro.js';
import { BENDS, DASHED, STATIONS } from './map-layout.js';

// The schematic metro map: drawn as SVG from map-layout.js (positions) and
// rail.json (names, colours and station order). Each station opens the
// subway page with it as the destination. Pinch, drag, double-click,
// Ctrl+wheel (trackpad pinch), the +/− buttons and the keyboard all zoom.
//
// For screen readers and keyboards the map is one labelled image (focusable,
// for zooming). Its stations open on a tap or click; the same destinations
// are offered as real links in the list of stations by line (stationList).

const UNIT = 44;          // px per grid unit
const MAX_ZOOM = 6;
const LABEL_GAP = 13;
const NS = 'http://www.w3.org/2000/svg';

const point = id => [STATIONS[id][0] * UNIT, STATIONS[id][1] * UNIT];

// Station ids in line order, from the line's first direction in rail.json
const lineStations = line => Object.values(line.directions)[0].stops.map(s => s.station);

// Points of a line: its stations, with the corners from BENDS in between
function linePoints(ids) {
    return ids.flatMap((id, i) => {
        if (i === 0) return [point(id)];
        const prev = ids[i - 1];
        const bends = BENDS[`${prev}>${id}`] ?? [...(BENDS[`${id}>${prev}`] ?? [])].reverse();
        return [...bends.map(([x, y]) => [x * UNIT, y * UNIT]), point(id)];
    });
}

const pathData = points => points.map(([x, y], i) => `${i ? 'L' : 'M'}${x} ${y}`).join('');

// A line's colour for the map: rail.json's, if it's a #rrggbb colour
const lineColor = line => /^#[0-9a-f]{6}$/i.test(line.color) ? line.color : '#6c757d';

// Text placement for each label side: offset direction, anchor and baseline
const SIDES = {
    n:  [0, -1, 'middle', 'auto'],
    s:  [0, 1, 'middle', 'hanging'],
    e:  [1, 0, 'start', 'central'],
    w:  [-1, 0, 'end', 'central'],
    ne: [0.7, -0.7, 'start', 'auto'],
    nw: [-0.7, -0.7, 'end', 'auto'],
    se: [0.7, 0.7, 'start', 'hanging'],
    sw: [-0.7, 0.7, 'end', 'hanging'],
};

function drawMap(rail) {
    const lines = Object.entries(rail.lines);

    const tracks = lines.map(([id, line]) => {
        const ids = lineStations(line);
        const dashed = DASHED[id];
        const [a, b] = dashed ? dashed.map(s => ids.indexOf(s)).sort((x, y) => x - y) : [];
        return html`<path class="map-line" d="${pathData(linePoints(ids))}" stroke="${lineColor(line)}"/>${dashed && html`<path class="map-line-dash" d="${pathData(linePoints(ids.slice(a, b + 1)))}"/>`}`;
    });

    const stations = Object.entries(rail.stations).filter(([id]) => STATIONS[id]).map(([id, station]) => {
        const [x, y] = point(id);
        const [dx, dy, anchor, baseline] = SIDES[STATIONS[id][2]];
        const interchange = station.lines.length > 1;
        const name = localName(station.name, language);
        return html`<g class="map-station${interchange ? ' map-interchange' : ''}" data-station="${id}">
            <title>${name}</title>
            <circle cx="${x}" cy="${y}" r="${interchange ? 9 : 6}"${!interchange && html` stroke="${lineColor(rail.lines[station.lines[0]])}"`}/>
            <text x="${x + dx * LABEL_GAP}" y="${y + dy * LABEL_GAP}" text-anchor="${anchor}" dominant-baseline="${baseline}">${name}</text>
        </g>`;
    });

    return html`<g class="map-content">${tracks}${stations}</g>`;
}

export function createMetroMap(container, rail) {
    const button = (zoom, key, symbol) => html`<button type="button" class="btn map-btn" data-zoom="${zoom}"
        aria-label="${t(key)}" title="${t(key)}">${icon(symbol)}</button>`;
    setHtml(container, html`
        <div class="map-controls">
            ${button('in', 'info.zoom-in', 'plus-lg')}
            ${button('out', 'info.zoom-out', 'dash-lg')}
            ${button('reset', 'info.zoom-reset', 'arrows-angle-contract')}
        </div>
        <svg xmlns="${NS}" class="map-svg" role="img" aria-label="${t('info.map-label')}" aria-describedby="map-help" tabindex="0"></svg>`);
    const svg = container.querySelector('.map-svg');

    let base;   // the whole map, as a viewBox
    let view;   // the visible part

    function draw() {
        setHtml(svg, drawMap(rail));
        const box = svg.querySelector('.map-content').getBBox();
        const pad = UNIT / 2;
        base = { x: box.x - pad, y: box.y - pad, w: box.width + 2 * pad, h: box.height + 2 * pad };
        svg.style.aspectRatio = `${base.w} / ${base.h}`;
        view ??= { ...base };
        apply();
    }

    function apply() {
        // Keep the view inside the map
        view.w = Math.min(base.w, Math.max(base.w / MAX_ZOOM, view.w));
        view.h = view.w * base.h / base.w;
        view.x = Math.min(base.x + base.w - view.w, Math.max(base.x, view.x));
        view.y = Math.min(base.y + base.h - view.h, Math.max(base.y, view.y));
        svg.setAttribute('viewBox', `${view.x} ${view.y} ${view.w} ${view.h}`);
        // Zoomed in, a finger drags the map; zoomed out, it scrolls the page
        container.classList.toggle('zoomed', view.w < base.w - 0.5);
    }

    // Client coordinates → map coordinates
    /** @returns {[number, number]} */
    function toMap(clientX, clientY) {
        const rect = svg.getBoundingClientRect();
        return [view.x + (clientX - rect.left) / rect.width * view.w, view.y + (clientY - rect.top) / rect.height * view.h];
    }

    function zoomAt(factor, [px, py] = [view.x + view.w / 2, view.y + view.h / 2]) {
        const w = Math.min(base.w, Math.max(base.w / MAX_ZOOM, view.w / factor));
        const k = w / view.w;
        view = { x: px - (px - view.x) * k, y: py - (py - view.y) * k, w, h: view.h * k };
        apply();
    }

    function panBy(dxClient, dyClient) {
        const rect = svg.getBoundingClientRect();
        view.x -= dxClient / rect.width * view.w;
        view.y -= dyClient / rect.height * view.h;
        apply();
    }

    container.querySelector('.map-controls').addEventListener('click', e => {
        const action = e.target.closest('[data-zoom]')?.dataset.zoom;
        if (action === 'in') zoomAt(1.6);
        if (action === 'out') zoomAt(1 / 1.6);
        if (action === 'reset') { view = { ...base }; apply(); }
    });

    svg.addEventListener('dblclick', e => {
        e.preventDefault();
        zoomAt(2, toMap(e.clientX, e.clientY));
    });

    // Trackpad pinches arrive as Ctrl+wheel; a plain wheel still scrolls the page
    svg.addEventListener('wheel', e => {
        if (!e.ctrlKey) return;
        e.preventDefault();
        zoomAt(Math.exp(-e.deltaY / 100), toMap(e.clientX, e.clientY));
    }, { passive: false });

    svg.addEventListener('keydown', e => {
        const zoomed = container.classList.contains('zoomed');
        const step = 60;
        const actions = {
            '+': () => zoomAt(1.6), '=': () => zoomAt(1.6), '-': () => zoomAt(1 / 1.6),
            '0': () => { view = { ...base }; apply(); },
            ArrowLeft: () => zoomed && panBy(step, 0), ArrowRight: () => zoomed && panBy(-step, 0),
            ArrowUp: () => zoomed && panBy(0, step), ArrowDown: () => zoomed && panBy(0, -step),
        };
        if (!actions[e.key] || (e.key.startsWith('Arrow') && !zoomed)) return;
        e.preventDefault();
        actions[e.key]();
    });

    // Drag and pinch. Pointer capture isn't used, so that a tap on a station
    // still reaches its link; a drag swallows the click that follows it.
    const pointers = new Map();
    let moved = 0;
    let gesture = null; // { dist, mid } of the last two-finger frame

    svg.addEventListener('pointerdown', e => {
        if (e.pointerType === 'mouse' && e.button !== 0) return;
        if (!pointers.size) moved = 0;
        pointers.set(e.pointerId, [e.clientX, e.clientY]);
        gesture = null;
    });

    window.addEventListener('pointermove', e => {
        const last = pointers.get(e.pointerId);
        if (!last) return;
        const now = [e.clientX, e.clientY];
        pointers.set(e.pointerId, now);
        if (pointers.size === 1) {
            if (!container.classList.contains('zoomed')) return;
            moved += Math.hypot(now[0] - last[0], now[1] - last[1]);
            panBy(now[0] - last[0], now[1] - last[1]);
        } else if (pointers.size === 2) {
            const [a, b] = [...pointers.values()];
            const dist = Math.hypot(a[0] - b[0], a[1] - b[1]);
            const mid = /** @type {[number, number]} */ ([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]);
            if (gesture) {
                moved += 10;
                panBy(mid[0] - gesture.mid[0], mid[1] - gesture.mid[1]);
                zoomAt(dist / gesture.dist, toMap(...mid));
            }
            gesture = { dist, mid };
        }
    });

    const release = e => {
        pointers.delete(e.pointerId);
        gesture = null;
    };
    window.addEventListener('pointerup', release);
    window.addEventListener('pointercancel', release);

    // A tap on a station opens the directions to it, unless it ended a drag
    svg.addEventListener('click', e => {
        const station = e.target.closest('.map-station');
        if (station && moved <= 6) location.href = localHref(`/subway?to=${encodeURIComponent(station.dataset.station)}`);
    });

    draw();
}

// The stations of each line in order, as lists of links, with the changes
// to other lines. The accessible counterpart of the map.
export function stationList(rail) {
    const name = id => localName(rail.stations[id].name, language);
    return html`${Object.entries(rail.lines).map(([lineId, line]) => {
        const ids = lineStations(line);
        const items = ids.map(id => {
            const others = rail.stations[id].lines.filter(l => l !== lineId);
            const change = others.length > 0 && html` <span class="station-change">· ${t('info.change-to')} ${others.join(', ')}</span>`;
            return html`<li><a href="${localHref(`/subway?to=${encodeURIComponent(id)}`)}">${name(id)}</a>${change}</li>`;
        });
        return html`<h4 class="station-line">${lineBadge(lineId, line.name)} ${name(ids[0])} – ${name(ids.at(-1))}</h4>
            <ol class="station-stops">${items}</ol>`;
    })}`;
}
