import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';

// The live host (cPanel's LiteSpeed, through its lsnode.js) starts server.js
// with require(). Node allows that for ES modules, but not when anything they
// import uses top-level await (ERR_REQUIRE_ASYNC_MODULE): the site doesn't
// start. So: no top-level await in the server's code.

const SERVER = readFileSync(new URL('../server.js', import.meta.url), 'utf8');
const canRequireModules = Boolean(process.features.require_module);

test('everything server.js imports loads with require(), as the live host starts it', { skip: !canRequireModules && 'this Node can\'t require() ES modules' }, () => {
    const require = createRequire(import.meta.url);
    // The app's own files (packages like dotenv/config load .env, which tests don't)
    const own = [...SERVER.matchAll(/^import\s+(?:[^'"]*?\s+from\s+)?['"](\.[^'"]+)['"]/gm)].map(m => m[1]);
    assert.ok(own.includes('./server/app.js') && own.includes('./server/scheduler.js'), own.join(', '));
    for (const spec of own) {
        assert.doesNotThrow(() => require(fileURLToPath(new URL(`../${spec}`, import.meta.url))), spec);
    }
});

test('server.js itself has no top-level await', () => {
    // Its only awaits would be inside functions, indented
    assert.doesNotMatch(SERVER, /^(?:[\w{}\s,]*=\s*)?await\b/m);
    assert.doesNotMatch(SERVER, /^\S.*\bawait\b/m);
});
