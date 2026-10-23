import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Html, escapeHtml, externalLink, format, formatDate, html, icon, localName, raw, safeUrl, setHtml, walkingUrl } from '../public/js/core/html.js';
import { centralPlatformBadge, clockTime, exitDiagram, lineBadge, stopNote } from '../public/js/core/metro.js';

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
    assert.equal(String(icon('geo-alt', 'me-1')), '<svg class="bi me-1" aria-hidden="true"><use href="/icons.svg#geo-alt"></use></svg>');
    assert.doesNotMatch(String(icon('x', '"><script>')), /<script>/);
});

// Shared by the subway page and the station pages, so they look the same on both
test('where to ride: the train diagram, or a note when the stop\'s exits aren\'t known', () => {
    const s = key => key;
    const positions = ['back', 'center', 'front'];
    const diagram = String(exitDiagram(positions, ['back'], [], s));
    assert.match(diagram, /class="train-diagram"/);
    // No BACK / FRONT at the train's ends: the labels under the cars say it
    assert.doesNotMatch(diagram, /train-label|subway\.train-/);
    assert.equal(String(exitDiagram(positions, [], [], s)), '<p class="text-body-secondary fst-italic small">subway.no-position-data</p>');
});

test('the central platform badge and a stop\'s note', () => {
    const s = key => key;
    assert.match(String(centralPlatformBadge(s)), /^<span class="central-platform-badge"><svg [^]*<\/svg>subway\.doors-left<\/span>$/);
    assert.match(String(centralPlatformBadge(s, 'ms-2')), /^<span class="central-platform-badge ms-2">/);
    assert.match(String(stopNote('No data yet!')), /^<div class="stop-note mt-3"><svg [^]*<\/svg>No data yet!<\/div>$/);
    assert.match(String(stopNote('<b>x</b>')), /&lt;b&gt;x&lt;\/b&gt;/);
    for (const none of [null, undefined, '']) assert.equal(stopNote(none), null);
});

test('a line badge is coloured by its class (style.css), with no inline style', () => {
    assert.equal(String(lineBadge('M1', 'M1')), '<span class="line-badge line-m1">M1</span>');
    assert.equal(String(lineBadge('M3', 'M3', 'suggestion-line-badge')), '<span class="suggestion-line-badge line-m3">M3</span>');
    assert.doesNotMatch(String(lineBadge('M9" onclick="x', '<b>M9</b>')), /<b>|" onclick/);
});
