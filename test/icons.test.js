import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { listFiles } from '../server/pages/assets.js';
import { ICONS, ICONS_DIR, iconSprite } from '../server/pages/icons.js';
import { loadTools } from '../server/pages/registry.js';

// The icon sprite has every icon the code shows, and only those.

const ROOT = new URL('..', import.meta.url).pathname;
const sources = ['server', 'public/js', 'tools', 'admin']
    .flatMap(dir => listFiles(join(ROOT, dir)))
    .filter(file => /\.(js|html)$/.test(file))
    .map(file => readFileSync(file, 'utf8'));

const quoted = text => [...text.matchAll(/'([a-z0-9-]+)'/g)].map(m => m[1]);
// Where icons are named: icon(name …), /icons.svg#name in static views, the
// tools' icons, and the names passed on to icon() (bus messages, the toast,
// the map buttons, the admin pages' status icons)
const used = new Set([
    ...sources.flatMap(text => [...text.matchAll(/\bicon\(([^,)]+)/g)].flatMap(m => quoted(m[1]))),
    ...sources.flatMap(text => [...text.matchAll(/\/icons\.svg#([a-z0-9-]+)/g)].map(m => m[1])),
    ...loadTools().map(tool => tool.icon),
    ...sources.flatMap(text => [...text.matchAll(/showMessage\('([a-z0-9-]+)/g)].map(m => m[1])),
    ...sources.flatMap(text => [...text.matchAll(/\btoast\([^;]*?, '([a-z0-9-]+)'\)/g)].map(m => m[1])),
    ...sources.flatMap(text => [...text.matchAll(/\bbutton\('\w+', '[\w.-]+', '([a-z0-9-]+)'\)/g)].map(m => m[1])),
    ...sources.flatMap(text => [...text.matchAll(/const ICONS = \{([^}]*)\}/g)].flatMap(m => quoted(m[1]))),
]);

test('every icon the code shows is in the sprite', () => {
    assert.deepEqual([...used].filter(name => !ICONS.includes(name)), []);
});

test('the sprite has no icons the code doesn\'t show', () => {
    assert.deepEqual(ICONS.filter(name => !used.has(name)), []);
});

test('every icon in the list is a Bootstrap icon, and in the sprite', () => {
    const sprite = iconSprite();
    for (const name of ICONS) {
        assert.ok(existsSync(join(ICONS_DIR, `${name}.svg`)), `${name} isn't a Bootstrap icon`);
        assert.match(sprite, new RegExp(`<symbol id="${name}" viewBox="0 0 16 16"><path`));
    }
});

test('the icon font is gone', () => {
    for (const text of sources) assert.doesNotMatch(text, /class="bi bi-|bootstrap-icons\.(min\.)?css/);
});
