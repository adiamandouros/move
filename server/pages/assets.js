import { createHash } from 'crypto';
import express from 'express';
import { existsSync, readdirSync, readFileSync, statSync } from 'fs';
import { createRequire } from 'module';
import { dirname, join, relative, sep } from 'path';
import { fileURLToPath } from 'url';
import { iconSprite } from './icons.js';

// The files the pages link to: stylesheets, scripts, icons (icons.js) and the
// third-party files, with the version that keeps browsers from mixing
// files from two deploys.

const ROOT       = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const TOOLS_DIR  = join(ROOT, 'tools');
const PUBLIC_DIR = join(ROOT, 'public');

const require = createRequire(import.meta.url);
const packageDir = name => dirname(require.resolve(`${name}/package.json`));

// Third-party files served from node_modules, so nothing loads from a CDN
export const VENDOR = {
    '/vendor/bootstrap': join(packageDir('bootstrap'), 'dist'),
    '/vendor/roboto': join(packageDir('@fontsource-variable/roboto'), 'files'),
};

// Roboto, every weight in one file per alphabet: the @font-face rules at the
// top of style.css name the same files. Every page preloads both
// (layout.js), so text rarely shows in the fallback font.
export const FONTS = {
    latin: '/vendor/roboto/roboto-latin-wght-normal.woff2',
    greek: '/vendor/roboto/roboto-greek-wght-normal.woff2',
};

// Served as they are. Fonts are kept for 30 days: their names don't change
// with the package's version, but an old copy of a font is harmless.
const FONT_CACHE = 'public, max-age=2592000';
export const vendorStatic = dir => express.static(dir, {
    setHeaders: (res, file) => { if (file.endsWith('.woff2')) res.set('Cache-Control', FONT_CACHE); },
});

// Files every page needs, cached by the service worker on install
const SHELL_FILES = [
    '/vendor/bootstrap/css/bootstrap.min.css',
    '/vendor/bootstrap/js/bootstrap.min.js',
    '/icons.svg',
    FONTS.latin,
    FONTS.greek,
];
const SHELL_DIRS = ['css', 'icon', join('js', 'core')];

// ── Asset versions ──────────────────────────────────────────────────────────

// Stylesheets and scripts are linked as <url>?v=<hash of every asset file>, so
// each deploy gives them new URLs. The live server's LiteSpeed serves public/
// with a 7-day cache, so without this browsers kept old stylesheets and
// scripts after a deploy (and so did the service worker, which fills its cache
// through the browser's), mixing them with new pages.
let version = null;
export function assetVersion() {
    if (version) return version;
    const hash = createHash('sha256');
    const toolFiles = listFiles(TOOLS_DIR).filter(f => f.includes(`${sep}client${sep}`));
    for (const file of [...shellFiles(), ...toolFiles]) hash.update(readFileSync(file));
    for (const dir of Object.values(VENDOR)) hash.update(readFileSync(join(dir, '..', 'package.json')));
    hash.update(iconSprite());
    version = hash.digest('hex').slice(0, 10);
    return version;
}

// (and the icon sprite, whose links name an icon after the #)
const VERSIONED = /^(\/(css|js|tools|vendor)\/.+\.(css|js)|\/icons\.svg)(#.*)?$/;
export const versioned = url => url.replace(VERSIONED, (_, file, _dir, _ext, hash = '') => `${file}?v=${assetVersion()}${hash}`);

// Every page script, mapped to its versioned URL, so that their imports
// (import … from '/js/core/i18n.js', './map.js') load the same version
export function importMap(tools) {
    const modules = [
        ...listFiles(join(PUBLIC_DIR, 'js', 'core')).map(f => urlPath('', PUBLIC_DIR, f)),
        ...tools.flatMap(t => listFiles(t.clientDir).map(f => urlPath(`/tools/${t.id}`, t.clientDir, f))),
    ].filter(url => url.endsWith('.js'));
    return { imports: Object.fromEntries(modules.map(url => [url, versioned(url)])) };
}

// ── Files ───────────────────────────────────────────────────────────────────

export function listFiles(dir) {
    if (!existsSync(dir)) return [];
    return readdirSync(dir).flatMap(name => {
        const path = join(dir, name);
        return statSync(path).isDirectory() ? listFiles(path) : [path];
    });
}

export const urlPath = (base, dir, file) => `${base}/${relative(dir, file).split(sep).join('/')}`;

// URLs of the files every page needs (stylesheets, core scripts, icons)
export function shellUrls() {
    return [
        ...SHELL_FILES,
        ...SHELL_DIRS.flatMap(d => listFiles(join(PUBLIC_DIR, d)).map(f => urlPath('', PUBLIC_DIR, f))),
    ].map(versioned);
}

// Contents of those files, for computing cache versions
export function shellFiles() {
    return SHELL_DIRS.flatMap(d => listFiles(join(PUBLIC_DIR, d)));
}
