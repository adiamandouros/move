import { createHash } from 'crypto';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { listFiles, shellFiles, shellUrls, urlPath, VENDOR, versioned } from './assets.js';
import { LANGS, localPath } from './i18n.js';
import { fill } from './layout.js';

// The service worker (server/views/sw.js), with what it caches for offline
// use filled in: the home and offline pages, the files every page needs, and
// the tools marked "offline" with their scripts and data.

const VIEWS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'views');

// pages: every rendered page by path, so the version changes with any of them
export function renderServiceWorker(tools, pages) {
    const offlineTools = tools.filter(t => t.offline);
    // Pages in every language, so the Greek ones work offline too
    const inLangs = path => LANGS.map(lang => localPath(path, lang));
    const precache = [
        ...inLangs('/'), ...inLangs('/offline'),
        ...shellUrls(),
        ...offlineTools.flatMap(t => [
            ...inLangs(t.path),
            ...listFiles(t.clientDir).map(f => versioned(urlPath(`/tools/${t.id}`, t.clientDir, f))),
        ]),
    ];
    const precacheData = offlineTools.flatMap(t => t.precache);

    // The version changes whenever any page or cached file changes
    const hash = createHash('sha256');
    for (const html of Object.values(pages)) hash.update(html);
    for (const file of [
        ...shellFiles(),
        ...tools.flatMap(t => listFiles(t.clientDir)),
        join(VIEWS_DIR, 'sw.js'),
    ]) hash.update(readFileSync(file));
    for (const dir of Object.values(VENDOR)) hash.update(readFileSync(join(dir, '..', 'package.json')));

    return fill(readFileSync(join(VIEWS_DIR, 'sw.js'), 'utf8'), {
        version: hash.digest('hex').slice(0, 12),
        precache: JSON.stringify(precache, null, 4),
        precacheData: JSON.stringify(precacheData, null, 4),
        offlinePages: JSON.stringify(offlineTools.flatMap(t => inLangs(t.path))),
    });
}
