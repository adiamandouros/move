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

// Files every page needs, cached by the service worker on install. Not the
// PNG icons and the share image in public/icon: the browser and the home
// screen keep those themselves.
const SHELL_FILES = [
    '/vendor/bootstrap/css/bootstrap.min.css',
    '/vendor/bootstrap/js/bootstrap.min.js',
    '/icons.svg',
    FONTS.latin,
    FONTS.greek,
];
const SHELL_DIRS = ['css', join('js', 'core')];

// ── Asset versions ──────────────────────────────────────────────────────────

// Stylesheets and scripts are linked as <url>?v=<hash of that file>, so a
// deploy gives new URLs to the files it changed, and only to them: the others
// stay in browsers' caches. The live server's LiteSpeed serves public/ with a
// 7-day cache, so without this browsers kept old stylesheets and scripts after
// a deploy (and so did the service worker, which fills its cache through the
// browser's), mixing them with new pages. Scripts import each other by plain
// URL; every page's import map points each one at its version (importMap).
const versions = new Map();
export function versionOf(url) {
    if (!versions.has(url)) {
        const hash = createHash('sha256').update(url === '/icons.svg' ? iconSprite() : readFileSync(fileAt(url)));
        versions.set(url, hash.digest('hex').slice(0, 10));
    }
    return versions.get(url);
}

// The file on disk an asset URL is served from
function fileAt(url) {
    const tool = url.match(/^\/tools\/([^/]+)\/(.+)$/);
    if (tool) return join(TOOLS_DIR, tool[1], 'client', tool[2]);
    const vendor = Object.keys(VENDOR).find(prefix => url.startsWith(`${prefix}/`));
    if (vendor) return join(VENDOR[vendor], url.slice(vendor.length));
    return join(PUBLIC_DIR, url);
}

// (and the icon sprite, whose links name an icon after the #)
const VERSIONED = /^(\/(css|js|tools|vendor)\/.+\.(css|js)|\/icons\.svg)(#.*)?$/;
export const versioned = url => url.replace(VERSIONED, (_, file, _dir, _ext, hash = '') => `${file}?v=${versionOf(file)}${hash}`);

// How long browsers keep a file asked for at `url`: for good when its ?v= is
// the file's version now, so it's never asked for again. A ?v= that isn't (a
// page from before a deploy asking for a file that has changed since) gets
// today's file, which mustn't be kept under the old address, so it's checked
// every time; so is a file asked for without one. Fonts are linked without a
// version and kept for 30 days: their names don't change with the package's
// version, but an old copy of a font is harmless.
const KEPT_FOR_GOOD = 'public, max-age=31536000, immutable';
const FONT_CACHE = 'public, max-age=2592000';
export function cacheControl(url, v) {
    if (v) return v === versionOf(url) ? KEPT_FOR_GOOD : 'no-cache';
    return url.endsWith('.woff2') ? FONT_CACHE : 'no-cache';
}

// Files served as they are (the tools' scripts, Bootstrap, Roboto, public/),
// kept as cacheControl says. LiteSpeed serves public/ itself on the live
// server, with its own 7 days.
/** @param {string} dir @param {object} [options] */
export const staticFiles = (dir, options = {}) => express.static(dir, {
    ...options,
    setHeaders: (res, _file) => {
        const req = /** @type {any} */ (res).req;
        res.set('Cache-Control', cacheControl(`${req.baseUrl}${req.path}`, typeof req.query.v === 'string' ? req.query.v : undefined));
    },
});

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
