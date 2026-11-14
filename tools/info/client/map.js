import { html, icon, localName, setHtml } from '/js/core/html.js';
import { language, localHref, t } from '/js/core/i18n.js';
import { linePill, pillList } from '/js/core/lines.js';
import { suburbanId } from '/tools/subway/network.js';

// The schematic maps of the metro, the tram and the suburban railway: drawn
// as SVG from a layout (map-layout.js, tram-layout.js, suburban-layout.js:
// positions) and a network (names, colours and stop order: rail.json's metro
// part, its `tram`, or trains.json's lines, suburbanNetwork). Pinch, drag,
// double-click, Ctrl+wheel (trackpad pinch), the +/− buttons and the
// keyboard all zoom. A metro or railway station opens the subway page with
// it as the destination; tram stops open nothing yet. The railway's map has
// only the city's stations and the Airport (decision 54): where a line goes
// on, an arrow says where to.
//
// For screen readers and keyboards a map is one labelled image (focusable,
// for zooming). Its stations open on a tap or click; the same destinations
// are offered as real links in the list of stations by line (stationList).

const UNIT = 44;          // px per grid unit
const MAX_ZOOM = 6;
const LABEL_GAP = 13;
const STUB_LENGTH = 1.1 * UNIT;
const STUB_GAP = 9;       // between two lines' stubs at one stop
const BADGE = { w: 28, h: 18 };
const GAP = 11;           // between two lines side by side (a layout's LANES)
const BEYOND_LENGTH = 1.4 * UNIT;
const NS = 'http://www.w3.org/2000/svg';

/** @typedef {{ STATIONS: Record<string, any[]>, BENDS?: Record<string, number[][]>, DASHED?: Record<string, string[]>, STUBS?: Record<string, string>, BADGES?: Record<string, number[][]>, LANES?: Record<string, number>, BEYOND?: Record<string, string> }} Layout */

// A direction's station ids, in travel order
const directionStations = direction => direction.stops.map(s => s.station);
// Station ids in line order, from the line's first direction in rail.json
const lineStations = line => directionStations(Object.values(line.directions)[0]);

// A line's colour for the map: rail.json's, if it's a #rrggbb colour
const lineColor = line => /^#[0-9a-f]{6}$/i.test(line?.color) ? line.color : '#6c757d';

const pathData = points => points.map(([x, y], i) => `${i ? 'L' : 'M'}${x} ${y}`).join('');

// Compass directions, as unit steps on the grid
const COMPASS = {
    n: [0, -1], s: [0, 1], e: [1, 0], w: [-1, 0],
    ne: [Math.SQRT1_2, -Math.SQRT1_2], nw: [-Math.SQRT1_2, -Math.SQRT1_2],
    se: [Math.SQRT1_2, Math.SQRT1_2], sw: [-Math.SQRT1_2, Math.SQRT1_2],
};

// Text placement for each label side: anchor and baseline (the offset is the
// side's compass step, a little shorter on the diagonals)
const SIDES = {
    n: ['middle', 'auto'], s: ['middle', 'hanging'], e: ['start', 'central'], w: ['end', 'central'],
    ne: ['start', 'auto'], nw: ['end', 'auto'], se: ['start', 'hanging'], sw: ['end', 'hanging'],
};
const labelStep = side => COMPASS[side].map(v => Math.abs(v) < 1 ? Math.sign(v) * 0.7 : v);

/** @param {Layout} layout */
function geometry(layout) {
    const point = id => [layout.STATIONS[id][0] * UNIT, layout.STATIONS[id][1] * UNIT];
    // Points of a run of stations: the stations, with the corners from BENDS in between
    const linePoints = ids => ids.flatMap((id, i) => {
        if (i === 0) return [point(id)];
        const prev = ids[i - 1];
        const bends = layout.BENDS?.[`${prev}>${id}`] ?? [...(layout.BENDS?.[`${id}>${prev}`] ?? [])].reverse();
        return [...bends.map(([x, y]) => [x * UNIT, y * UNIT]), point(id)];
    });
    return { point, linePoints };
}

// The runs of a line its first direction doesn't cover (T7 goes back round
// its Piraeus loop the other way), and the hops trains only make one way
function lineParts(line) {
    const dirs = Object.values(line.directions).map(directionStations);
    const hops = dirs.flatMap(ids => ids.slice(1).map((id, i) => [ids[i], id]));
    const has = (a, b) => hops.some(([x, y]) => x === a && y === b);
    const firstHas = (a, b) => dirs[0].some((id, i) => i > 0 && ((dirs[0][i - 1] === a && id === b) || (dirs[0][i - 1] === b && id === a)));
    const extra = [];
    for (const ids of dirs.slice(1)) {
        let run = null;
        ids.slice(1).forEach((id, i) => {
            if (firstHas(ids[i], id)) { run = null; return; }
            if (!run) extra.push(run = [ids[i]]);
            run.push(id);
        });
    }
    const oneWay = hops.filter(([a, b], i) => !has(b, a) && hops.findIndex(([x, y]) => x === a && y === b) === i);
    return { extra, oneWay };
}

// A line's name in its colours, as linePill in lines.js draws it: the
// box's colour from rail.json, the text's from style.css's .line-m1 etc.
function badge(x, y, lineId, line) {
    return html`<g class="map-badge line-${lineId.toLowerCase()}"><rect x="${x - BADGE.w / 2}" y="${y - BADGE.h / 2}" width="${BADGE.w}" height="${BADGE.h}" rx="${BADGE.h / 2}" fill="${lineColor(line)}"/><text x="${x}" y="${y}" text-anchor="middle" dominant-baseline="central">${line?.name ?? lineId}</text></g>`;
}

// The stations where each line's directions start and end, and where its
// dashed branch starts (trains toward the airport may end at Doukissis):
// what a direction is called by
function terminals(network, layout) {
    return new Set([
        ...Object.values(network.lines).flatMap(line => Object.values(line.directions).flatMap(d => [d.stops[0].station, d.stops.at(-1).station])),
        ...Object.values(layout.DASHED ?? {}).flat(),
    ]);
}

// Lines side by side where they share track (a layout's LANES): on each hop
// between two stations, each line on it is moved across by its lane less the
// mean lane of the lines there, so together they sit centred on the stations.
// A higher lane is to the left of the way the hop's first line (in the
// network's order) runs it, whichever way another line does: so LANES follow
// the first line's run (lineStations) along all its shared track. Without
// LANES every line runs through the stations' places.
/** @param {{ lines: Record<string, any> }} network @param {Layout} layout */
function lanes(network, layout) {
    const placed = id => !!layout.STATIONS[id];
    const key = (a, b) => a < b ? `${a}>${b}` : `${b}>${a}`;
    const runs = Object.fromEntries(Object.entries(network.lines).map(([id, line]) => [id, lineStations(line).filter(placed)]));
    const onHop = new Map();
    const firstWay = new Map();
    for (const [id, ids] of Object.entries(runs)) {
        ids.slice(1).forEach((b, i) => {
            onHop.set(key(ids[i], b), [...onHop.get(key(ids[i], b)) ?? [], id]);
            if (!firstWay.has(key(ids[i], b))) firstWay.set(key(ids[i], b), ids[i]);
        });
    }
    const sharing = (a, b) => onHop.get(key(a, b))?.length ?? 1;
    // How far line `id` is moved to the left of a → b, in px
    const across = (id, a, b) => {
        if (!layout.LANES) return 0;
        const ids = onHop.get(key(a, b)) ?? [id];
        const mean = ids.reduce((sum, l) => sum + layout.LANES[l], 0) / ids.length;
        return (layout.LANES[id] - mean) * GAP * (firstWay.get(key(a, b)) === a ? 1 : -1);
    };
    return { runs, sharing, across };
}

/** @param {number[]} from @param {number[]} to @returns {number[]} */
const unit = ([x1, y1], [x2, y2]) => {
    const length = Math.hypot(x2 - x1, y2 - y1);
    return [(x2 - x1) / length, (y2 - y1) / length];
};
/** @param {number[]} step @returns {number[]} */
const leftOf = ([dx, dy]) => [dy, -dx];
/** @param {number[]} point @param {number[]} step @param {number} by @returns {number[]} */
const moved = ([x, y], [nx, ny], by) => [x + nx * by, y + ny * by];

// A line's points, each piece moved to its left by its hop's amount: mitred
// where two pieces move alike, a step (under a station's mark) where they don't
/** @param {{ points: number[][], by: number }[]} hops */
function shifted(hops) {
    const pieces = hops.flatMap(({ points, by }) => points.slice(1).map((q, i) => ({ p: points[i], q, by })));
    return pieces.flatMap(({ p, q, by }, i) => {
        const n = leftOf(unit(p, q));
        const out = i === 0 ? [moved(p, n, by)] : [];
        const next = pieces[i + 1];
        if (!next) return [...out, moved(q, n, by)];
        const m = leftOf(unit(next.p, next.q));
        if (next.by !== by) return [...out, moved(q, n, by), moved(q, m, next.by)];
        const k = by / (1 + n[0] * m[0] + n[1] * m[1]);
        return [...out, [q[0] + (n[0] + m[0]) * k, q[1] + (n[1] + m[1]) * k]];
    });
}

// A small arrowhead halfway along the longest straight piece of a hop
function arrow(points) {
    const pieces = points.slice(1).map((p, i) => [points[i], p]);
    const [[x1, y1], [x2, y2]] = pieces.reduce((a, b) => Math.hypot(b[1][0] - b[0][0], b[1][1] - b[0][1]) > Math.hypot(a[1][0] - a[0][0], a[1][1] - a[0][1]) ? b : a);
    const angle = Math.atan2(y2 - y1, x2 - x1) * 180 / Math.PI;
    return html`<path class="map-arrow" d="M-3 -3.5L1.5 0L-3 3.5" transform="translate(${(x1 + x2) / 2} ${(y1 + y2) / 2}) rotate(${Math.round(angle)})"/>`;
}

// Where `line`'s trains go on to past station `id`, the last of its stations
// on the map at one end (the railway's map stops at the city): the station
// they end at, or none
/** @param {any} line @param {string} id @param {(id: string) => boolean} placed */
function goesOn(line, id, placed) {
    const ids = lineStations(line);
    const shown = ids.filter(placed);
    if (ids.at(-1) !== id && shown.at(-1) === id) return ids.at(-1);
    if (ids[0] !== id && shown[0] === id) return ids[0];
    return null;
}

/**
 * The map's SVG content (exported for the tests)
 * @param {{ lines: Record<string, any>, stations: Record<string, any> }} network
 * @param {Layout} layout
 * @param {{ id: string, colors: Record<string, any>, link: (id: string) => string | null, changes: (id: string) => string[], walks?: string[][] }} options
 * walks: pairs of stations a short walk apart (SKA's two), joined on the map
 */
export function drawMap(network, layout, { id: mapId, colors, link, changes, walks = [] }) {
    const { point, linePoints } = geometry(layout);
    const lines = Object.entries(network.lines);
    const placed = id => !!layout.STATIONS[id];
    const { runs, sharing, across } = lanes(network, layout);
    const trackPoints = (lineId, ids) => layout.LANES
        ? shifted(ids.slice(1).map((b, i) => ({ points: linePoints([ids[i], b]), by: across(lineId, ids[i], b) })))
        : linePoints(ids);

    // Where each line passes a station: moved across as on its hop there
    // with the most lines (so the marks line up across shared track)
    const marks = id => Object.entries(runs).flatMap(([lineId, ids]) => {
        const i = ids.indexOf(id);
        if (i < 0) return [];
        const hops = [ids[i - 1], ids[i + 1]].filter(Boolean).map(other => [id, other])
            .sort(([, a], [, b]) => sharing(id, b) - sharing(id, a));
        if (!hops.length) return [point(id)];
        const [a, b] = hops[0];
        return [moved(point(a), leftOf(unit(point(a), linePoints([a, b])[1])), across(lineId, a, b))];
    });
    // A station's mark: from one end of its lanes to the other (one point
    // without LANES), and halfway between them
    const extent = id => {
        const points = marks(id);
        let [from, to] = [points[0] ?? point(id), points[0] ?? point(id)];
        for (const p of points) for (const q of points) {
            if (Math.hypot(q[0] - p[0], q[1] - p[1]) > Math.hypot(to[0] - from[0], to[1] - from[1])) [from, to] = [p, q];
        }
        return { from, to, middle: [(from[0] + to[0]) / 2, (from[1] + to[1]) / 2], half: Math.hypot(to[0] - from[0], to[1] - from[1]) / 2 };
    };

    const tracks = lines.map(([id, line]) => {
        const ids = runs[id];
        const dashed = layout.DASHED?.[id];
        const [a, b] = dashed ? dashed.map(s => ids.indexOf(s)).sort((x, y) => x - y) : [];
        const { extra, oneWay } = lineParts(line);
        const stroke = lineColor(line);
        return html`<path class="map-line" d="${pathData(trackPoints(id, ids))}" stroke="${stroke}"/>${extra.map(run => html`<path class="map-line" d="${pathData(linePoints(run.filter(placed)))}" stroke="${stroke}"/>`)}${dashed && html`<path class="map-line-dash" d="${pathData(linePoints(ids.slice(a, b + 1)))}"/>`}${oneWay.filter(hop => hop.every(placed)).map(hop => arrow(linePoints(hop)))}`;
    });

    // Short strokes, fading out, in the colours of the lines of the other
    // network a stop changes to (metro ↔ tram), each ending in its
    // line's badge, so the change doesn't rest on colour alone. The badges
    // sit side by side across a stub going up or down, else one above another.
    const stubs = Object.entries(layout.STUBS ?? {}).filter(([id]) => network.stations[id] && changes(id).length).map(([id, side]) => {
        const [x, y] = extent(id).middle;
        const [dx, dy] = COMPASS[side];
        const others = changes(id);
        const middle = i => i - (others.length - 1) / 2;
        const strokes = others.map((lineId, i) => {
            const shift = middle(i) * STUB_GAP;
            const [x1, y1] = [x - dy * shift, y + dx * shift];
            const [x2, y2] = [x1 + dx * STUB_LENGTH, y1 + dy * STUB_LENGTH];
            const gradient = `${mapId}-stub-${id}-${lineId}`;
            return html`<linearGradient id="${gradient}" gradientUnits="userSpaceOnUse" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}">
                <stop offset="0.5" stop-color="${lineColor(colors[lineId])}"/><stop offset="1" stop-color="${lineColor(colors[lineId])}" stop-opacity="0"/>
            </linearGradient><path class="map-stub" d="M${x1} ${y1}L${x2} ${y2}" stroke="url(#${gradient})"/>`;
        });
        const [ex, ey] = [x + dx * STUB_LENGTH, y + dy * STUB_LENGTH];
        // In the stubs' order (they're shifted across by -dy, dx)
        const pills = others.map((lineId, i) => dx === 0
            ? badge(ex - Math.sign(dy) * middle(i) * (BADGE.w + 4), ey, lineId, colors[lineId])
            : badge(ex, ey + Math.sign(dx) * middle(i) * (BADGE.h + 3), lineId, colors[lineId]));
        return { strokes, pills };
    });

    // Line badges at the ends of the lines, where the lines share a colour
    const badges = Object.entries(layout.BADGES ?? {}).filter(([id]) => network.lines[id])
        .flatMap(([id, spots]) => spots.map(([x, y]) => badge(x * UNIT, y * UNIT, id, network.lines[id])));
    const ends = terminals(network, layout);

    // Where a line goes on past the map (the railway beyond the city): a
    // stroke in its colour, fading out, and where its trains go
    const beyond = Object.entries(layout.BEYOND ?? {}).filter(([id]) => network.stations[id]).flatMap(([id, side]) => {
        const [x1, y1] = extent(id).middle;
        const [dx, dy] = COMPASS[side];
        const [x2, y2] = [x1 + dx * BEYOND_LENGTH, y1 + dy * BEYOND_LENGTH];
        const [lx, ly] = labelStep(side);
        const [anchor, baseline] = SIDES[side];
        return lines.map(([lineId, line]) => [lineId, line, goesOn(line, id, placed)]).filter(([, , to]) => to).map(([lineId, line, to]) => {
            const gradient = `${mapId}-beyond-${id}-${lineId}`;
            return html`<linearGradient id="${gradient}" gradientUnits="userSpaceOnUse" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}">
                <stop offset="0.3" stop-color="${lineColor(line)}"/><stop offset="1" stop-color="${lineColor(line)}" stop-opacity="0"/>
            </linearGradient><path class="map-beyond" d="M${x1} ${y1}L${x2} ${y2}" stroke="url(#${gradient})"/>
            <g class="map-beyond-name"><text x="${x2 + lx * LABEL_GAP}" y="${y2 + ly * LABEL_GAP}" text-anchor="${anchor}" dominant-baseline="${baseline}">${t('info.toward-end').replace('{toward}', localName(network.stations[to].name, language))}</text></g>`;
        });
    });

    const walked = new Set(walks.flat());
    const walkLinks = walks.filter(pair => pair.every(placed)).map(([a, b]) => {
        const [[x1, y1], [x2, y2]] = [extent(a).middle, extent(b).middle];
        return html`<path class="map-walk" d="M${x1} ${y1}L${x2} ${y2}"/>`;
    });

    const stations = Object.entries(network.stations).filter(([id]) => placed(id)).map(([id, station]) => {
        const { from, to, middle: [x, y], half } = extent(id);
        const side = layout.STATIONS[id][2];
        const interchange = station.lines.length > 1 || changes(id).length > 0 || walked.has(id);
        const name = localName(station.name, language);
        const classes = `map-station${interchange ? ' map-interchange' : ''}${ends.has(id) ? ' map-terminal' : ''}${link(id) ? ' map-link' : ''}`;
        // A station on lines side by side: a white bar across them
        const mark = half > 0
            ? html`<path class="map-capsule-edge" d="M${from[0]} ${from[1]}L${to[0]} ${to[1]}"/><path class="map-capsule" d="M${from[0]} ${from[1]}L${to[0]} ${to[1]}"/>`
            : html`<circle cx="${x}" cy="${y}" r="${interchange ? 9 : 6}"${!interchange && html` stroke="${lineColor(network.lines[station.lines[0]])}"`}/>`;
        // A station shown only by its neighbour's name (SKA's two): no label
        if (!side) return html`<g class="${classes}" data-station="${id}"><title>${name}</title>${mark}</g>`;
        const [dx, dy] = labelStep(side);
        const [anchor, baseline] = SIDES[side];
        // A label on its stubs' side goes past their badges (Larissa Station)
        const gap = LABEL_GAP + half + (layout.STUBS?.[id] === side && changes(id).length ? STUB_LENGTH + BADGE.w / 2 : 0);
        return html`<g class="${classes}" data-station="${id}">
            <title>${name}</title>
            ${mark}
            <text x="${x + dx * gap}" y="${y + dy * gap}" text-anchor="${anchor}" dominant-baseline="${baseline}">${name}</text>
        </g>`;
    });

    return html`<g class="map-content">${stubs.map(s => s.strokes)}${beyond}${tracks}${badges}${walkLinks}${stations}${stubs.map(s => s.pills)}</g>`;
}

/**
 * A zoomable map in `container`
 * @param {any} container
 * @param {{ lines: Record<string, any>, stations: Record<string, any> }} network
 * @param {Layout} layout
 * @param {{ label: string, describedBy: string, colors?: Record<string, any>, link?: (id: string) => string | null, changes?: (id: string) => string[], walks?: string[][] }} options
 */
function createRailMap(container, network, layout, { label, describedBy, colors = network.lines, link = () => null, changes = () => [], walks = [] }) {
    const button = (zoom, key, symbol) => html`<button type="button" class="btn map-btn" data-zoom="${zoom}"
        aria-label="${t(key)}" title="${t(key)}">${icon(symbol)}</button>`;
    setHtml(container, html`
        <div class="map-controls">
            ${button('in', 'info.zoom-in', 'zoom-in')}
            ${button('out', 'info.zoom-out', 'zoom-out')}
            ${button('reset', 'info.zoom-reset', 'zoom-reset')}
        </div>
        <svg xmlns="${NS}" class="map-svg" role="img" aria-label="${label}" aria-describedby="${describedBy}" tabindex="0"></svg>`);
    const svg = container.querySelector('.map-svg');

    let base;   // the whole map, as a viewBox
    let view;   // the visible part

    function draw() {
        setHtml(svg, drawMap(network, layout, { id: container.id, colors, link, changes, walks }));
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

    // A tap on a station opens its link (the directions to it), unless it ended a drag
    svg.addEventListener('click', e => {
        const href = link(e.target.closest('.map-station')?.dataset.station);
        if (href && moved <= 6) location.href = href;
    });

    draw();
}

// The metro's stations open the directions to them
export const subwayLink = id => id ? localHref(`/subway?to=${encodeURIComponent(id)}`) : null;
// And the railway's, by the id the subway page gives them
/** @param {import('../../../types/data.js').Rail} rail */
export const suburbanLink = rail => id => id ? subwayLink(suburbanId(rail, id)) : null;

// The suburban railway as drawMap and stationList take a network, from
// trains.json: each line's ways of running that no other of its ways holds
// (A3's Chalkida–Oinoi trains are inside the Athens ones), by their first
// station's id (A1 from the Airport: the way suburban-layout.js's LANES
// follow), its stations with the lines calling there
/** @param {import('../../../types/data.js').Trains} trains */
export function suburbanNetwork(trains) {
    const within = (a, b) => { let i = 0; for (const id of b) if (id === a[i]) i++; return i === a.length; };
    const ways = new Map();
    for (const routes of Object.values(trains.dates)) {
        for (const { line, stops } of routes) {
            const mine = ways.get(line) ?? [];
            if (!mine.some(other => within(stops, other))) ways.set(line, [...mine.filter(other => !within(other, stops)), stops]);
        }
    }
    const name = id => ({ el: trains.stations[id][2], en: trains.stations[id][3] });
    const lines = {};
    const calledAt = new Map();
    for (const [id, { name: lineName, color }] of Object.entries(trains.lines)) {
        const mine = ways.get(id)?.sort((a, b) => a[0].localeCompare(b[0]) || a.at(-1).localeCompare(b.at(-1)));
        if (!mine) continue;
        lines[id] = { name: lineName, color, directions: Object.fromEntries(mine.map((stops, i) => [`${stops.at(-1)}-${i}`, { toward: name(stops.at(-1)), stops: stops.map(station => ({ station })) }])) };
        for (const station of mine.flat()) calledAt.set(station, new Set(calledAt.get(station)).add(id));
    }
    const stations = Object.fromEntries([...calledAt].map(([id, on]) => [id, { name: name(id), lines: [...on].sort() }]));
    return { lines, stations };
}

// The walks between the railway and the metro (trains.json's, 'train:athens'
// to 'rail:larissa-station'), and between two of the railway's stations
const metroWalks = trains => (trains?.walks ?? []).filter(([, to]) => to.startsWith('rail:')).map(([from, to]) => [from.slice(6), to.slice(5)]);
/** @param {import('../../../types/data.js').Trains} trains */
export const suburbanWalks = trains => trains.walks.filter(([from, to]) => from.startsWith('train:') && to.startsWith('train:')).map(([from, to]) => [from.slice(6), to.slice(6)]);

// The railway's lines a metro station changes to, a walk away
/** @param {import('../../../types/data.js').Trains | null} trains @returns {(id: string) => string[]} */
function suburbanChanges(trains) {
    if (!trains) return () => [];
    const network = suburbanNetwork(trains);
    const byStation = new Map();
    for (const [station, metro] of metroWalks(trains)) {
        byStation.set(metro, [...new Set([...byStation.get(metro) ?? [], ...network.stations[station]?.lines ?? []])].sort());
    }
    return id => byStation.get(id) ?? [];
}
// And the metro's lines a railway station changes to
/** @param {import('../../../types/data.js').Rail} rail @param {import('../../../types/data.js').Trains} trains @returns {(id: string) => string[]} */
export function metroChangesOfRailway(rail, trains) {
    const byStation = new Map(metroWalks(trains).map(([station, metro]) => [station, rail.stations[metro]?.lines ?? []]));
    return id => byStation.get(id) ?? [];
}
// A metro station's changes: to the tram, then the railway
/** @param {import('../../../types/data.js').Rail} rail @param {import('../../../types/data.js').Trains | null} trains */
export const metroStationChanges = (rail, trains) => {
    const [tram, railway] = [tramChanges(rail), suburbanChanges(trains)];
    return id => [...tram(id), ...railway(id)];
};

// The tram lines a metro station changes to (from the tram stops'
// `metro`), and the metro lines a tram stop changes to
/** @param {import('../../../types/data.js').Rail} rail @returns {(id: string) => string[]} */
export function tramChanges(rail) {
    const byStation = new Map();
    for (const stop of Object.values(rail.tram?.stations ?? {})) {
        if (stop.metro) byStation.set(stop.metro.station, [...new Set([...byStation.get(stop.metro.station) ?? [], ...stop.lines])].sort());
    }
    return id => byStation.get(id) ?? [];
}
/** @param {import('../../../types/data.js').Rail} rail @returns {(id: string) => string[]} */
export const metroChanges = rail => id => rail.tram?.stations[id]?.metro?.lines ?? [];

/** @param {import('../../../types/data.js').Rail} rail @param {import('../../../types/data.js').Trains | null} [trains] */
export const allColors = (rail, trains) => ({ ...rail.lines, ...rail.tram?.lines, ...trains?.lines });

/** @param {any} container @param {import('../../../types/data.js').Rail} rail @param {import('../../../types/data.js').Trains | null} trains @param {Layout} layout */
export function createMetroMap(container, rail, trains, layout) {
    createRailMap(container, rail, layout, { label: t('info.map-label'), describedBy: 'map-help subway-map-help', colors: allColors(rail, trains), link: subwayLink, changes: metroStationChanges(rail, trains) });
}

/** @param {any} container @param {import('../../../types/data.js').Rail} rail @param {Layout} layout */
export function createTramMap(container, rail, layout) {
    if (!rail.tram) throw new Error('No tram in rail.json');
    createRailMap(container, rail.tram, layout, { label: t('info.tram-map-label'), describedBy: 'map-help tram-map-help', colors: allColors(rail), changes: metroChanges(rail) });
}

/** @param {any} container @param {import('../../../types/data.js').Rail} rail @param {import('../../../types/data.js').Trains} trains @param {Layout} layout */
export function createSuburbanMap(container, rail, trains, layout) {
    createRailMap(container, suburbanNetwork(trains), layout, {
        label: t('info.suburban-map-label'), describedBy: 'map-help suburban-map-help', colors: allColors(rail, trains),
        link: suburbanLink(rail), changes: metroChangesOfRailway(rail, trains), walks: suburbanWalks(trains),
    });
}

// The stations of each line in order, with the changes to other lines (of
// its own network, and `changes` to the other one): the
// accessible counterpart of a map. Metro stations are links to the
// directions to them. Where a line's other direction goes another way (T7's
// Piraeus loop), a sentence says which way. `shown`: the stations on its map
// (the railway's in the city), the others said in a sentence after them.
/** @param {{ lines: Record<string, any>, stations: Record<string, any> }} network @param {{ link?: (id: string) => string | null, changes?: (id: string) => string[], shown?: (id: string) => boolean }} [options] */
export function stationList(network, { link = () => null, changes = () => [], shown = () => true } = {}) {
    const name = id => localName(network.stations[id].name, language);
    return html`${Object.entries(network.lines).map(([lineId, line]) => {
        const ids = lineStations(line);
        const on = [ids[0], ids.at(-1)].filter(id => !shown(id)).map(id => goesOn(line, ids.filter(shown).at(id === ids[0] ? 0 : -1), shown)).filter(Boolean);
        const items = ids.filter(shown).map(id => {
            const station = network.stations[id];
            const others = [...station.lines.filter(l => l !== lineId), ...changes(id)];
            const change = others.length > 0 && html` <span class="station-change">· ${t('info.change-to')} ${pillList(others.map(l => linePill(l, l, 's')))}</span>`;
            const href = link(id);
            return html`<li>${href ? html`<a href="${href}">${name(id)}</a>` : name(id)}${change}</li>`;
        });
        const { extra } = lineParts(line);
        const ways = Object.values(line.directions).slice(1).filter(d => extra.some(run => directionStations(d).includes(run[1])))
            .map(d => html`<p class="station-way">${t('info.other-way').replace('{toward}', localName(d.toward, language))} ${extra.map(run => run.map(name).join(' – ')).join('; ')}.</p>`);
        const further = on.map(to => html`<p class="station-way">${t('info.goes-on').replace('{toward}', name(to))}</p>`);
        return html`<h5 class="station-line">${linePill(lineId, line.name)} ${name(ids[0])} – ${name(ids.at(-1))}</h5>
            <ol class="station-stops">${items}</ol>${ways}${further}`;
    })}`;
}

