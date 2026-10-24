import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'fs';
import { createRequire } from 'module';
import { dirname, join } from 'path';
import { listFiles } from '../server/pages/assets.js';
import { ICONS_DIR, MEANINGS, iconFiles, iconSprite } from '../server/pages/icons.js';
import { loadTools } from '../server/pages/registry.js';

// Icons by meaning (server/pages/icons.js, DESIGN.md): every icon the code
// shows is a meaning in the list, every meaning is shown, and no picture
// means two things. The sprite has them all, from server/icons/.

const ROOT = new URL('..', import.meta.url).pathname;
const sources = ['server', 'public/js', 'tools', 'admin']
    .flatMap(dir => listFiles(join(ROOT, dir)))
    .filter(file => /\.(js|html|hbs)$/.test(file))
    .map(file => readFileSync(file, 'utf8'));

const quoted = text => [...text.matchAll(/'([a-z0-9-]+)'/g)].map(m => m[1]);
// Where icons are named: icon(name …), {{icon "name"}} in the views, the
// tools' icons, and the names passed on to icon() (bus messages, the toast,
// the map buttons, the admin pages' status icons)
const used = new Set([
    ...sources.flatMap(text => [...text.matchAll(/\bicon\(([^,)]+)/g)].flatMap(m => quoted(m[1]))),
    ...sources.flatMap(text => [...text.matchAll(/\/icons\.svg#([a-z0-9-]+)/g)].map(m => m[1])),
    ...sources.flatMap(text => [...text.matchAll(/\{\{icon "([a-z0-9-]+)"/g)].map(m => m[1])),
    // and icons passed to a view as data ({{icon iconName}}: the tiles, the site links)
    ...sources.flatMap(text => [...text.matchAll(/\biconName: '([a-z0-9-]+)'/g)].map(m => m[1])),
    // and to a partial ({{#> section iconName="map"}}: the info page's sections)
    ...sources.flatMap(text => [...text.matchAll(/\biconName="([a-z0-9-]+)"/g)].map(m => m[1])),
    ...loadTools().map(tool => tool.icon),
    ...sources.flatMap(text => [...text.matchAll(/showMessage\('([a-z0-9-]+)/g)].map(m => m[1])),
    ...sources.flatMap(text => [...text.matchAll(/\btoast\([^;]*?, '([a-z0-9-]+)'\)/g)].map(m => m[1])),
    ...sources.flatMap(text => [...text.matchAll(/\bbutton\('\w+', '[\w.-]+', '([a-z0-9-]+)'\)/g)].map(m => m[1])),
    ...sources.flatMap(text => [...text.matchAll(/const ICONS = \{([^}]*)\}/g)].flatMap(m => quoted(m[1]))),
]);

test('every icon the code shows is a meaning in the list', () => {
    assert.ok(used.size >= 30, 'found the icons');
    assert.deepEqual([...used].filter(name => !Object.hasOwn(MEANINGS, name)), []);
});

test('every meaning in the list is shown somewhere', () => {
    assert.deepEqual(Object.keys(MEANINGS).filter(name => !used.has(name)), []);
});

test('no picture means two things', () => {
    const symbols = Object.values(MEANINGS).map(m => m.symbol);
    assert.deepEqual(symbols.filter((symbol, i) => symbols.indexOf(symbol) !== i), []);
});

test('status icons and the symbols in the train are filled; the tools have both forms, for the current tab', () => {
    for (const name of ['ok', 'warning', 'error', 'exit', 'escalator', 'stairs', 'lift']) assert.equal(MEANINGS[name].filled, true, name);
    for (const tool of loadTools()) assert.equal(MEANINGS[tool.icon]?.tab, true, `${tool.id}'s icon`);
    assert.ok(Object.entries(MEANINGS).filter(([, m]) => m.filled).length <= 7, 'outline beside words: few icons are filled');
});

test('server/icons/ has exactly the files the list needs, as the package has them', () => {
    const wanted = [...Object.values(MEANINGS).flatMap(iconFiles), 'LICENSE'].sort();
    assert.deepEqual(readdirSync(ICONS_DIR).sort(), wanted, 'run npm run icons');
    // The package is a dev dependency: checked where it's installed
    const require = createRequire(import.meta.url);
    let packageDir = null;
    try { packageDir = join(dirname(require.resolve('@material-symbols/svg-400/package.json')), 'rounded'); } catch { /* not installed */ }
    if (!packageDir) return;
    for (const file of wanted.filter(f => f !== 'LICENSE')) assert.equal(readFileSync(join(ICONS_DIR, file), 'utf8'), readFileSync(join(packageDir, file), 'utf8'), `${file}: run npm run icons`);
});

test('the sprite has every meaning, and a tab\'s filled form too', () => {
    const sprite = iconSprite();
    for (const [name, meaning] of Object.entries(MEANINGS)) {
        assert.match(sprite, new RegExp(`<symbol id="${name}" viewBox="0 -960 960 960"><path d="`), name);
        assert.equal(sprite.includes(`<symbol id="${name}-filled"`), Boolean(meaning.tab), `${name}-filled`);
    }
    // Filled where the list says so: the -fill file's drawing
    const drawing = file => readFileSync(join(ICONS_DIR, file), 'utf8').match(/<path d="([^"]+)"/)[1];
    assert.ok(sprite.includes(drawing(`${MEANINGS.warning.symbol}-fill.svg`)));
    assert.ok(sprite.includes(drawing(`${MEANINGS['metro'].symbol}-fill.svg`)));
    assert.ok(existsSync(join(ICONS_DIR, `${MEANINGS.walk.symbol}.svg`)));
});

test('the icon font and Bootstrap Icons are gone', () => {
    for (const text of sources) assert.doesNotMatch(text, /class="bi\b|bootstrap-icons/);
});
