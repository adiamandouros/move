import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Html, escapeHtml, externalLink, format, formatDate, formatHtml, html, icon, localName, notice, raw, safeUrl, setHtml, walkingUrl } from '../public/js/core/html.js';
import { busPlate, linePill, pillList, stationSign } from '../public/js/core/lines.js';
import { centralPlatformBadge, clockTime, diagramLegend, diagramSymbols, exitDiagram, exitKind, lineEnd, stopNote, trainDiagram } from '../public/js/core/metro.js';

// Building HTML (public/js/core/html.js): html`` escapes every value put into
// it, except pieces it built itself; and the small helpers around it

test('html`` escapes every value', () => {
    const name = '<img src=x onerror="alert(1)"> & \'quotes\'';
    assert.equal(String(html`<p title="${name}">${name}</p>`),
        '<p title="&lt;img src=x onerror=&quot;alert(1)&quot;&gt; &amp; &#39;quotes&#39;">&lt;img src=x onerror=&quot;alert(1)&quot;&gt; &amp; &#39;quotes&#39;</p>');
});

test('pieces built with html``, and lists of them, go in as they are', () => {
    const items = ['<a>', 'b'].map(i => html`<li>${i}</li>`);
    assert.equal(String(html`<ul>${items}</ul>`), '<ul><li>&lt;a&gt;</li><li>b</li></ul>');
    assert.equal(String(html`<p>${html`<b>${'&'}</b>`}</p>`), '<p><b>&amp;</b></p>');
    // A plain string that looks like HTML is still text
    assert.equal(String(html`${'<b>x</b>'}`), '&lt;b&gt;x&lt;/b&gt;');
});

test('null, undefined and false give nothing; 0 and other values are text', () => {
    assert.equal(String(html`[${null}${undefined}${false}]`), '[]');
    assert.equal(String(html`${0} ${''} ${true} ${12.5}`), '0  true 12.5');
    const shown = false;
    assert.equal(String(html`<p>${shown && html`<b>x</b>`}</p>`), '<p></p>');
});

test('raw() marks HTML known to be safe; Html is a string wherever one is needed', () => {
    assert.equal(String(html`<p>${raw('<b>ok</b>')}</p>`), '<p><b>ok</b></p>');
    const piece = html`<b>${'x'}</b>`;
    assert.ok(piece instanceof Html);
    assert.equal(`${piece}`, '<b>x</b>');
});

test('pieces built by another copy of the module count as HTML too', async () => {
    const other = await import(`../public/js/core/html.js?copy=${Date.now()}`);
    assert.notEqual(other.html, html);
    assert.equal(String(html`<p>${other.html`<b>${'<'}</b>`}</p>`), '<p><b>&lt;</b></p>');
    // But an object that only looks like one doesn't
    assert.equal(String(html`${{ text: '<b>', toString: () => '<b>' }}`), '&lt;b&gt;');
});

test('setHtml puts it into an element as a string', () => {
    const element = /** @type {any} */ ({ innerHTML: null });
    setHtml(element, html`<b>${'<'}</b>`);
    assert.equal(element.innerHTML, '<b>&lt;</b>');
    setHtml(element, '');
    assert.equal(element.innerHTML, '');
});

test('safeUrl keeps web addresses only', () => {
    assert.equal(safeUrl('https://www.oasa.gr/news/1/'), 'https://www.oasa.gr/news/1/');
    assert.equal(safeUrl('http://stasy.gr/a?b=1&c=2'), 'http://stasy.gr/a?b=1&c=2');
    for (const url of ['javascript:alert(1)', ' JavaScript:alert(1)', 'data:text/html,<script>', 'vbscript:x', '/relative', '', null, undefined]) {
        assert.equal(safeUrl(url), null, String(url));
    }
});

test('escapeHtml and format are unchanged', () => {
    assert.equal(escapeHtml('<a href="x">\'&\'</a>'), '&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;');
    assert.equal(format('{min} min, {x}', { min: 12 }), '12 min, {x}');
});

test('formatHtml: the text escaped, pieces built with html`` as they are', () => {
    const pill = html`<b>M3</b>`;
    assert.equal(String(formatHtml('Change to {line} & {x}, {n}', { line: pill, n: '<i>' })), 'Change to <b>M3</b> &amp; {x}, &lt;i&gt;');
    assert.ok(formatHtml('a', {}) instanceof Html);
});

test('localName: the page\'s language, else English, else nothing', () => {
    assert.equal(localName({ el: 'Σύνταγμα', en: 'Syntagma' }, 'el'), 'Σύνταγμα');
    assert.equal(localName({ el: '', en: 'Syntagma' }, 'el'), 'Syntagma');
    assert.equal(localName({ en: 'Syntagma' }, 'el'), 'Syntagma');
    assert.equal(localName(null, 'en'), '');
});

test('walking directions, times and dates', () => {
    assert.equal(walkingUrl(37.97, 23.73), 'https://www.google.com/maps/dir/?api=1&destination=37.97,23.73&travelmode=walking');
    assert.equal(clockTime(5 * 3600 + 32 * 60 + 59), '05:32');
    assert.equal(clockTime(24 * 3600 + 15 * 60), '00:15');
    assert.equal(formatDate('2026-10-31'), '31/10/2026');
});

test('externalLink(): opens a new tab and says so; its attributes are escaped, and left out when empty', () => {
    assert.equal(String(externalLink({ href: 'https://x.gr/?a=1&b=2', class: 'btn', hidden: true, id: null, lang: false }, 'X', '(new tab)')),
        '<a href="https://x.gr/?a=1&amp;b=2" class="btn" hidden target="_blank" rel="noopener">X<span class="sr-only"> (new tab)</span></a>');
    assert.doesNotMatch(String(externalLink({ href: '"><script>' }, '<b>', '(new tab)')), /<script>|<b>/);
});

test('icon() is built with html``, so its classes are escaped', () => {
    assert.equal(String(icon('walk', 'me-1')), '<svg class="icon me-1" aria-hidden="true"><use href="/icons.svg#walk"></use></svg>');
    // A tab's filled form, for the current tab
    assert.equal(String(icon('metro', 'icon-nav', { filled: true })), '<svg class="icon icon-nav" aria-hidden="true"><use href="/icons.svg#metro-filled"></use></svg>');
    assert.doesNotMatch(String(icon('x', '"><script>')), /<script>/);
});

// Shared by the subway page and the station pages, so they look the same on both
test('where to ride: the train diagram, or a note when the stop\'s exits aren\'t known', () => {
    const s = key => key;
    const positions = ['back', 'center', 'front'];
    const diagram = String(exitDiagram(positions, { exits: ['back'] }, s));
    assert.match(diagram, /class="train-diagram"/);
    // No BACK / FRONT at the train's ends: the labels under the cars say it
    assert.doesNotMatch(diagram, /train-label|subway\.train-/);
    assert.equal(String(exitDiagram(positions, { exits: [] }, s)), '<p class="text-body-secondary fst-italic small">subway.no-position-data</p>');
});

// For when the labels don't fit under the cars (style.css shows one or the other)
test('the train diagram says where to ride in words too', () => {
    const s = key => key;
    const positions = ['back', 'center', 'front'];
    const words = diagram => String(diagram).match(/<p class="position-words">([^]*?)<\/p>/)[1].replace(/\s+/g, ' ').trim();
    assert.equal(words(exitDiagram(positions, { exits: ['back', 'front'], elevators: ['center'] }, s)),
        '<span class="highlighted">subway.ride-in subway.pos.back, subway.pos.front</span> <span class="has-elevator">subway.elevator-in subway.pos.center</span>');
    assert.equal(words(exitDiagram(positions, { exits: ['center'] }, s)), '<span class="highlighted">subway.ride-in subway.pos.center</span>');
    // With how the exit is reached, when that's recorded
    assert.equal(words(exitDiagram(positions, { exits: ['back', 'front'], escalators: ['back'], stairs: ['front'] }, s)),
        '<span class="highlighted">subway.ride-in subway.pos.back (subway.escalator), subway.pos.front (subway.stairs)</span>');
});

test('each car to ride in shows how it leads off the platform: escalator, stairs, or (not recorded) an arrow', () => {
    const s = key => key;
    const positions = ['back', 'center', 'front'];
    const where = { exits: ['back', 'center', 'front'], escalators: ['back', 'center'], stairs: ['center', 'front'], elevators: ['front'] };
    assert.deepEqual(positions.map(p => exitKind(where, p)), ['escalator', 'escalator', 'stairs']);
    assert.equal(exitKind({ exits: ['back'] }, 'back'), 'exit');
    const diagram = String(trainDiagram(positions, where, s));
    const cars = [...diagram.matchAll(/<div class="train-car[^"]*">([^]*?)<\/div>/g)].map(m => [...m[1].matchAll(/#([a-z-]+)"/g)].map(n => n[1]));
    assert.deepEqual(cars, [['escalator'], ['escalator'], ['stairs', 'lift']]);
    assert.match(diagram, /aria-label="subway\.diagram-label subway\.pos\.back \(subway\.escalator\), subway\.pos\.center \(subway\.escalator\), subway\.pos\.front \(subway\.stairs\), subway\.pos\.front \(subway\.elevator\)"/);
    assert.deepEqual(diagramSymbols(where), ['escalator', 'stairs', 'lift']);
    assert.deepEqual(diagramSymbols({ exits: ['back'] }), ['exit']);
});

test('the legend: what the trains show, in words, open, only for the symbols there', () => {
    const s = key => key;
    const legend = String(diagramLegend(['exit', 'lift'], s));
    assert.match(legend, /^<details class="diagram-legend" open>\s*<summary>subway\.legend<\/summary>/);
    const lines = [...legend.matchAll(/<li>([^]*?)<\/li>/g)].map(m => m[1]);
    assert.deepEqual(lines.map(line => line.replace(/<[^>]+>/g, '')), ['subway.legend-ride', 'subway.legend-exit', 'subway.legend-lift']);
    // The small cars are decoration: the words say it
    for (const line of lines) assert.match(line, /^<span class="legend-car train-car[^"]*" aria-hidden="true">/);
    assert.doesNotMatch(String(diagramLegend(['escalator'], s)), /legend-exit|legend-lift|legend-stairs/);
    // Closed by the person before (legendOpen()): drawn closed
    assert.match(String(diagramLegend(['exit'], s, false)), /^<details class="diagram-legend">/);
});

test('the central platform badge and a stop\'s note', () => {
    const s = key => key;
    assert.match(String(centralPlatformBadge(s)), /^<span class="tag"><svg [^]*<\/svg>subway\.doors-left<\/span>$/);
    assert.match(String(centralPlatformBadge(s, 'ms-2')), /^<span class="tag ms-2">/);
    assert.match(String(stopNote('No data yet!')), /^<div class="stop-note mt-3"><svg [^]*<\/svg>No data yet!<\/div>$/);
    assert.match(String(stopNote('<b>x</b>')), /&lt;b&gt;x&lt;\/b&gt;/);
    for (const none of [null, undefined, '']) assert.equal(stopNote(none), null);
});

test('a line\'s pill is coloured by its class (style.css), with no inline style, in three sizes', () => {
    assert.equal(String(linePill('M1', 'M1')), '<span class="line-pill pill-m line-m1">M1</span>');
    assert.equal(String(linePill('M3', 'M3', 's')), '<span class="line-pill pill-s line-m3">M3</span>');
    assert.equal(String(linePill('T6', 'T6', 'l')), '<span class="line-pill pill-l line-t6">T6</span>');
    assert.doesNotMatch(String(linePill('M9" onclick="x', '<b>M9</b>')), /<b>|" onclick/);
});

test('a bus line\'s plate, with words for screen readers when asked', () => {
    assert.equal(String(busPlate('040')), '<span class="bus-plate pill-m">040</span>');
    assert.equal(String(busPlate('X95', 'l', 'Line')), '<span class="bus-plate pill-l"><span class="sr-only">Line </span>X95</span>');
    assert.doesNotMatch(String(busPlate('<b>', 's', '<i>')), /<b>|<i>/);
});

test('a station\'s sign: its metro lines on its edges, the lower number on top', () => {
    assert.equal(String(stationSign('Kifisia', ['M1'])), '<span class="station-sign sign-m sign-top-m1">Kifisia</span>');
    assert.equal(String(stationSign('Σύνταγμα', ['M3', 'M2'], 'l')), '<span class="station-sign sign-l sign-top-m2 sign-bottom-m3">Σύνταγμα</span>');
    // Tram lines aren't edges; a third line would have no edge left
    assert.equal(String(stationSign('Syntagma', ['T6', 'M3', 'M2'])), '<span class="station-sign sign-m sign-top-m2 sign-bottom-m3">Syntagma</span>');
    assert.equal(String(stationSign('Edem', ['T7'])), '<span class="station-sign sign-m">Edem</span>');
    assert.doesNotMatch(String(stationSign('<b>', ['M1"><b>'])), /<b>/);
});

test('where a direction of a line ends: its last stop, as the signs say', () => {
    const rail = { lines: { M3: { directions: { doukissis: { toward: { en: 'Doukissis / Airport' }, stops: [{ station: 'syntagma' }, { station: 'doukissis' }, { station: 'airport' }] } } } } };
    assert.equal(lineEnd(/** @type {any} */ (rail), 'M3', 'doukissis'), 'airport');
});

test('several pills: a space between them, and a comma for screen readers', () => {
    assert.equal(String(pillList([linePill('M2', 'M2', 's'), linePill('M3', 'M3', 's')])),
        '<span class="line-pill pill-s line-m2">M2</span><span class="sr-only">,</span> <span class="line-pill pill-s line-m3">M3</span>');
    assert.equal(String(pillList([])), '');
});

test('notice() is an icon and a body in one of four tones, its content escaped', () => {
    assert.equal(String(notice('ok', 'ok', 'All clear')), `<div class="notice notice-ok">${icon('ok')}<div class="notice-body">All clear</div></div>`);
    assert.match(String(notice('warn', 'warning', html`<b>${'<i>'}</b>`, 'mt-3')), /^<div class="notice notice-warn mt-3">[^]*<b>&lt;i&gt;<\/b>/);
});
