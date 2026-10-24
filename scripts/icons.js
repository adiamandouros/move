// npm run icons: copies the Material Symbols that server/pages/icons.js
// lists from node_modules (@material-symbols/svg-400, a dev dependency) into
// server/icons/, and removes the ones it no longer lists. The server builds
// the sprite from that folder, so the 23,000-file package never has to be
// installed on the server. test/icons.test.js checks the folder matches.
import { copyFileSync, mkdirSync, readdirSync, rmSync } from 'fs';
import { createRequire } from 'module';
import { dirname, join } from 'path';
import { ICONS_DIR, MEANINGS, iconFiles } from '../server/pages/icons.js';

const require = createRequire(import.meta.url);
export const PACKAGE_DIR = join(dirname(require.resolve('@material-symbols/svg-400/package.json')), 'rounded');

const wanted = new Set(Object.values(MEANINGS).flatMap(iconFiles));
mkdirSync(ICONS_DIR, { recursive: true });
for (const file of wanted) copyFileSync(join(PACKAGE_DIR, file), join(ICONS_DIR, file));
// Their license goes with them (Apache 2.0)
copyFileSync(join(PACKAGE_DIR, '..', 'LICENSE'), join(ICONS_DIR, 'LICENSE'));
wanted.add('LICENSE');
const old = readdirSync(ICONS_DIR).filter(file => !wanted.has(file));
for (const file of old) rmSync(join(ICONS_DIR, file));
console.log(`[icons] ${wanted.size - 1} in server/icons/${old.length ? `, removed ${old.join(', ')}` : ''}`);
