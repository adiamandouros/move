import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import { join, relative } from 'path';
import { fileURLToPath } from 'url';
import { linePill } from '../public/js/core/lines.js';
import { listFiles } from '../server/pages/assets.js';
import { renderPages } from '../server/pages/index.js';
import { mergeStrings, stringGetter, toolNames } from '../server/pages/i18n.js';
import { loadTools, stringTables } from '../server/pages/registry.js';
import { compileView, fill, HELPERS, parseTemplate, view } from '../server/pages/templates.js';

// The Handlebars views (server/pages/templates.js): what they may use, how
// strictly they're checked, and the views themselves: every string they use
// exists in both languages, and text written in both languages is complete

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const tools = loadTools();
const VIEWS = ['server/views', 'admin', ...tools.map(t => `tools/${t.id}`)]
    .flatMap(dir => listFiles(join(ROOT, dir)))
    .filter(file => file.endsWith('.hbs'))
    .map(file => ({ name: relative(ROOT, file), source: readFileSync(file, 'utf8') }));

// Every string in each language, as written (without English standing in for Greek)
const STRINGS = mergeStrings(...stringTables(tools));

// Every node of a parsed template
function* nodes(node) {
    if (!node || typeof node !== 'object') return;
    if (node.type) yield node;
    for (const value of Object.values(node)) {
        if (Array.isArray(value)) for (const child of value) yield* nodes(child);
        else if (value && typeof value === 'object' && value !== node.loc) yield* nodes(value);
    }
}
const calls = (ast, helper) => [...nodes(ast)].filter(n => ['MustacheStatement', 'SubExpression', 'BlockStatement'].includes(n.type) && n.path?.original === helper);

test('the views are found, and parse', () => {
    assert.ok(VIEWS.length >= 15, `${VIEWS.length} views`);
    for (const { name, source } of VIEWS) assert.doesNotThrow(() => parseTemplate(source), name);
});

test('every string a view uses exists in English and Greek', () => {
    for (const { name, source } of VIEWS) {
        for (const call of calls(parseTemplate(source), 't')) {
            const [key] = call.params;
            // A key from the view's data ({{t titleKey}}) is checked when the page renders
            if (key.type !== 'StringLiteral') continue;
            assert.ok(STRINGS.en[key.value], `${name}: "${key.value}" is missing in English`);
            assert.ok(STRINGS.el[key.value], `${name}: "${key.value}" is missing in Greek`);
        }
        // And the titles of accordion sections and their parts: {{#> section title="info.map"}}, {{#> subsection title="info.tram"}}
        for (const block of [...nodes(parseTemplate(source))].filter(n => n.type === 'PartialBlockStatement' && ['section', 'subsection'].includes(n.name.original))) {
            const title = block.hash.pairs.find(pair => pair.key === 'title').value.value;
            assert.ok(STRINGS.en[title] && STRINGS.el[title], `${name}: section title "${title}" is missing in a language`);
        }
    }
});

test('text written in both languages has both: {{#ifLang "en"}}…{{else}}…{{/ifLang}}', () => {
    let blocks = 0;
    for (const { name, source } of VIEWS) {
        for (const block of calls(parseTemplate(source), 'ifLang')) {
            blocks++;
            const where = `${name}, line ${block.loc.start.line}`;
            assert.deepEqual(block.params.map(p => p.value), ['en'], `${where}: {{#ifLang "en"}}, with the Greek after {{else}}`);
            assert.ok(block.inverse?.body.some(n => n.type !== 'ContentStatement' || n.value.trim()), `${where}: no Greek after {{else}}`);
        }
    }
    assert.ok(blocks > 20, 'the info page writes many');
});

test('nothing is left of the old ways: data-i18n, data-lang, <!-- with ads -->', () => {
    for (const { name, source } of VIEWS) assert.doesNotMatch(source, /data-i18n|data-lang|<!-- \/?(with|without) ads -->/, name);
});

test('every page renders, with nothing left of its template', () => {
    const { pages, notFound, errorPage } = renderPages(tools);
    for (const [path, html] of Object.entries({ ...pages, '(404)': notFound('/el/nope'), '(error)': errorPage('/x') })) {
        assert.doesNotMatch(html, /\{\{/, path);
    }
});

// ── The helpers ─────────────────────────────────────────────────────────────

const PAGE = { lang: 'el', strings: { greeting: 'Γεια σου, {name}', 'shell.skip': 'Μετάβαση' } };
const render = (source, context = {}, page = PAGE) => compileView(source, 'test.hbs')(context, page);

test('only these helpers exist', () => {
    assert.deepEqual(HELPERS.sort(), ['external', 'formatDate', 'icon', 'ifLang', 'json', 'pill', 'plate', 't']);
    assert.throws(() => render('{{shout "x"}}'), /test\.hbs/);
});

test('values are escaped, unless written with three braces', () => {
    assert.equal(render('<p title="{{v}}">{{v}}</p>{{{h}}}', { v: '"><script>', h: '<b>ok</b>' }), '<p title="&quot;&gt;&lt;script&gt;">&quot;&gt;&lt;script&gt;</p><b>ok</b>');
});

test('a value the view names but isn\'t given fails, naming the view', () => {
    assert.throws(() => render('<p>{{missing}}</p>'), /test\.hbs: "missing" not defined/);
    assert.throws(() => render('{{#each items}}{{name}}{{/each}}', { items: [{}] }), /"name" not defined/);
    // null or false is given: it just shows nothing
    assert.equal(render('{{#if v}}x{{/if}}[{{w}}]', { v: false, w: null }), '[]');
});

test('{{t}}: the page\'s string, escaped, with its placeholders filled; a missing one fails', () => {
    assert.equal(render('{{t "shell.skip"}}'), 'Μετάβαση');
    assert.equal(render('{{t "greeting" name=who}}', { who: '<Ελένη>' }), 'Γεια σου, &lt;Ελένη&gt;');
    assert.equal(render('{{t key}}', { key: 'shell.skip' }), 'Μετάβαση');
    assert.throws(() => render('{{t "nope"}}'), /test\.hbs: There's no string "nope" \(el\)/);
    // A piece built with html`` (a line's pill) goes into the sentence as it is
    assert.equal(render('{{t "greeting" name=pill}}', { pill: linePill('M3', 'M3') }), 'Γεια σου, <span class="line-pill pill-m line-m3">M3</span>');
});

test('{{pill}} and {{plate}}: a line\'s pill, a bus line\'s plate, in size m unless given', () => {
    assert.equal(render('{{pill "M3"}}'), '<span class="line-pill pill-m line-m3">M3</span>');
    assert.equal(render('{{pill "T7" "s"}}'), '<span class="line-pill pill-s line-t7">T7</span>');
    assert.equal(render('{{plate "X95"}}'), '<span class="bus-plate pill-m">X95</span>');
    assert.equal(render('{{plate "040" "l"}}'), '<span class="bus-plate pill-l">040</span>');
});

test('{{#ifLang}} keeps the page\'s language', () => {
    const source = '{{#ifLang "en"}}Piraeus{{else}}Πειραιάς{{/ifLang}}';
    assert.equal(render(source), 'Πειραιάς');
    assert.equal(render(source, {}, { lang: 'en', strings: {} }), 'Piraeus');
});

test('{{icon}} and {{json}}', () => {
    assert.equal(render('{{icon "geo-alt"}}'), '<svg class="bi" aria-hidden="true"><use href="/icons.svg#geo-alt"></use></svg>');
    assert.equal(render('{{icon "geo-alt" "me-1"}}'), '<svg class="bi me-1" aria-hidden="true"><use href="/icons.svg#geo-alt"></use></svg>');
    assert.equal(render('<script type="application/json">{{json v}}</script>', { v: { a: '</script><script>alert(1)</script>' } }),
        '<script type="application/json">{"a":"\\u003c/script>\\u003cscript>alert(1)\\u003c/script>"}</script>');
});

test('{{formatDate}}, and {{> checked}}: when a page\'s facts were checked, and where', () => {
    assert.equal(render('{{formatDate "2026-10-14"}}'), '14/10/2026');
    const section = { date: '2026-10-14', sources: [{ name: 'stasy.gr', url: 'https://www.stasy.gr/' }, { name: 'oasa.gr', url: 'https://www.oasa.gr/' }] };
    const strings = { 'info.checked': 'Checked on {date} at', 'shell.new-tab': '(opens in a new tab)' };
    assert.equal(render('{{> checked section}}', { section }, { lang: 'en', strings }).trim(),
        '<p class="info-source">Checked on 14/10/2026 at <a href="https://www.stasy.gr/" target="_blank" rel="noopener">stasy.gr<span class="sr-only"> (opens in a new tab)</span></a>, '
        + '<a href="https://www.oasa.gr/" target="_blank" rel="noopener">oasa.gr<span class="sr-only"> (opens in a new tab)</span></a></p>');
});

test('{{#external}}: a link to another site, in a new tab, that says so; nothing else of the view\'s data in it', () => {
    const page = { lang: 'en', strings: { 'shell.new-tab': '(opens in a new tab)' } };
    assert.equal(render('{{#external href="https://oasa.gr/?a=1&b=2"}}OASA{{/external}}', {}, page),
        '<a href="https://oasa.gr/?a=1&amp;b=2" target="_blank" rel="noopener">OASA<span class="sr-only"> (opens in a new tab)</span></a>');
    // Attributes as given, from values too; the view's own values (id here) stay out
    assert.equal(render('{{#external href=url class="btn" lang="en" hidden=true}}<b>{{name}}</b>{{/external}}', { id: 'omonia', url: 'https://x.gr/', name: '<i>' }, page),
        '<a href="https://x.gr/" class="btn" hidden lang="en" target="_blank" rel="noopener"><b>&lt;i&gt;</b><span class="sr-only"> (opens in a new tab)</span></a>');
    // No address yet (the page's script sets it)
    assert.match(render('{{#external id="walk-btn"}}x{{/external}}', {}, page), /^<a id="walk-btn" target="_blank"/);
    assert.throws(() => render('{{#external href="https://x.gr/"}}x{{/external}}', {}, { lang: 'el', strings: {} }), /no string "shell\.new-tab" \(el\)/);
});

test('{{#> section}}: an accordion section around its content, closed unless open=true', () => {
    const strings = { 'info.map': 'Map' };
    const html = source => render(source, { inside: 'x' }, { lang: 'en', strings }).replace(/\s+</g, '<');
    const closed = html('{{#> section id="map" iconName="map" title="info.map"}}<p>{{inside}}</p>{{/section}}');
    assert.match(closed, /<button type="button" class="accordion-button collapsed" data-bs-toggle="collapse" data-bs-target="#sec-map" aria-expanded="false" aria-controls="sec-map" id="toggle-map"><svg [^]*#map"><\/use><\/svg><span>Map<\/span><\/button>/);
    // The content, with the page's values, inside the section's body
    assert.match(closed, /<div class="accordion-collapse collapse" id="sec-map"><div class="accordion-body info-body"><p>x<\/p><\/div>/);
    const open = html('{{#> section id="map" iconName="map" title="info.map" open=true}}{{/section}}');
    assert.match(open, /class="accordion-button" [^>]*aria-expanded="true"/);
    assert.match(open, /class="accordion-collapse collapse show"/);
});

test('{{#> subsection}}: a closed toggle at a heading level, around its content', () => {
    const html = source => render(source, { inside: 'x' }, { lang: 'en', strings: { 'info.tram': 'Tram' } }).replace(/\s+</g, '<');
    const part = html('{{#> subsection id="tram" level=3 title="info.tram"}}<p>{{inside}}</p>{{/subsection}}');
    assert.equal(part, '<h3 class="info-subhead"><button type="button" class="accordion-button collapsed info-subtoggle" data-bs-toggle="collapse" data-bs-target="#tram" aria-expanded="false" aria-controls="tram" id="toggle-tram"><span>Tram</span></button></h3><div id="tram" class="collapse"><p>x</p></div>\n');
});

test('fill() fills a script\'s slots as they are, and fails on a missing one', () => {
    assert.equal(fill('const A = {{a}};', { a: '["x"]' }), 'const A = ["x"];');
    assert.throws(() => fill('{{a}} {{b}}', { a: '1' }), /No value for \{\{b\}\}/);
});

test('view(): one loader for every view, by its path from the repository\'s root or in full, compiled once', () => {
    assert.equal(view('admin/login.hbs'), view(join(ROOT, 'admin', 'login.hbs')));
    assert.match(view('tools/subway/page.hbs')({}, { lang: 'en', strings: STRINGS.en }), /<h1 class="sr-only">Subway<\/h1>/);
    // A mistake names the view
    assert.throws(() => view('server/views/notfound.hbs')({}, { lang: 'en', strings: {} }), /^Error: server\/views\/notfound\.hbs: There's no string/);
});

test('strings: a missing one fails; tables merge, later ones winning; the tools\' names', () => {
    assert.equal(stringGetter({ a: 'A' }, 'el')('a'), 'A');
    assert.throws(() => stringGetter({}, 'el')('b'), /There's no string "b" \(el\)/);
    assert.deepEqual(mergeStrings({ en: { a: '1', b: '1' } }, { en: { b: '2' }, el: { a: 'α' } }), { en: { a: '1', b: '2' }, el: { a: 'α' } });
    const names = toolNames([{ id: 'x', title: { en: 'X', el: 'Χ' }, shortTitle: { en: 'x', el: 'χ' } }]);
    assert.deepEqual(names.el, { 'tool.x.title': 'Χ', 'tool.x.short': 'χ' });
});
