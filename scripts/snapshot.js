// Every response the server sends, written to files, so two versions of the
// code can be compared before and after a change that shouldn't change them:
//   node scripts/snapshot.js /tmp/before
//   … change the code …
//   node scripts/snapshot.js /tmp/after && diff -r /tmp/before /tmp/after
//
// It runs the browser tests' server (test/browser/server.js: test data, no
// network). Asset versions (?v=…) are blanked out, as they change with any file.
import { spawn } from 'child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { loadTools, sitePages } from '../server/pages/registry.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = process.argv[2];
if (!out) {
    console.error('Usage: node scripts/snapshot.js <folder>');
    process.exit(2);
}

const PORT = 3458;
const base = `http://localhost:${PORT}`;
const server = spawn(process.execPath, [join(ROOT, 'test', 'browser', 'server.js')], {
    env: { ...process.env, BROWSER_TEST_PORT: String(PORT) },
    stdio: 'ignore',
});
try {
    for (let i = 0; ; i++) {
        try { await fetch(base); break; } catch { if (i > 50) throw new Error('the server didn\'t start'); }
        await new Promise(r => setTimeout(r, 100));
    }

    const rail = JSON.parse(readFileSync(join(ROOT, 'test', 'browser', 'data', 'rail.json'), 'utf8'));
    const english = [...sitePages(loadTools()).map(p => p.path), '/subway/stations',
        ...Object.keys(rail.stations).map(id => `/subway/stations/${id}`), '/nope'];
    const urls = [...english, ...english.map(p => p === '/' ? '/el' : `/el${p}`),
        '/sw.js', '/robots.txt', '/sitemap.xml', '/manifest.webmanifest', '/el/manifest.webmanifest', '/icons.svg'];

    rmSync(out, { recursive: true, force: true });
    mkdirSync(out, { recursive: true });
    for (const url of urls) {
        const res = await fetch(base + url);
        const body = (await res.text())
            .replace(/\?v=[0-9a-f]{10}/g, '?v=V')
            .replace(/const VERSION = '[0-9a-f]+'/, "const VERSION = 'V'");
        writeFileSync(join(out, `${url.replace(/\//g, '_') || '_'}.txt`), `${res.status}\n${body}`);
    }
    console.log(`${urls.length} responses → ${out}`);
} finally {
    server.kill();
}
