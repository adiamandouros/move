import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { errorHandler } from '../server/errors.js';

// What a visitor gets when answering a request fails (server/errors.js): the
// error page, or JSON from an API, never the error's details, which only go
// to the log. The whole server's cases are in server.test.js.

const boom = () => { throw new Error('boom at /home/someone/server.js'); };

async function serve(options) {
    const app = express();
    app.get('/page', boom);
    app.get('/el/page', boom);
    app.get('/api/thing', boom);
    app.get('/admin/api/thing', boom);
    app.get('/too-big', () => { throw Object.assign(new Error('request entity too large'), { status: 413 }); });
    app.get('/half', (_req, res) => { res.write('half'); throw new Error('mid-answer'); });
    app.use(errorHandler(options));
    const server = await new Promise(resolve => { const s = app.listen(0, () => resolve(s)); });
    after(() => server.close());
    return path => fetch(`http://localhost:${server.address().port}${path}`);
}

const logged = [];
const get = await serve({ page: path => `<p>error page for ${path}</p>`, log: message => logged.push(message) });

test('a failed page: the error page for its address, logged with its details, not shown', async () => {
    logged.length = 0;
    for (const path of ['/page', '/el/page']) {
        const res = await get(path);
        assert.equal(res.status, 500);
        assert.equal(res.headers.get('cache-control'), 'no-store');
        assert.equal(res.headers.get('content-type'), 'text/html; charset=utf-8');
        const body = await res.text();
        assert.equal(body, `<p>error page for ${path}</p>`);
        assert.doesNotMatch(body, /boom|\/home\//);
    }
    assert.equal(logged.length, 2);
    assert.match(logged[0], /^\[server\] GET \/page failed: Error: boom/);
    assert.match(logged[0], /errors\.test\.js/, 'with the stack');
});

test('a failed API answer: a JSON error without details', async () => {
    for (const path of ['/api/thing', '/admin/api/thing']) {
        const res = await get(path);
        assert.equal(res.status, 500, path);
        assert.deepEqual(await res.json(), { error: 'Internal Server Error' }, path);
    }
});

test('an error with a 4xx status keeps it, and isn\'t logged', async () => {
    logged.length = 0;
    const res = await get('/too-big');
    assert.equal(res.status, 413);
    assert.equal(await res.text(), '<p>error page for /too-big</p>');
    assert.deepEqual(logged, []);
});

test('when the error page itself fails, plain text', async () => {
    const plain = await serve({ page: boom, log: () => {} });
    const res = await plain('/page');
    assert.equal(res.status, 500);
    assert.equal(res.headers.get('content-type'), 'text/plain; charset=utf-8');
    assert.equal(await res.text(), 'Internal Server Error');
});

test('halfway through an answer, it\'s cut off rather than mixed with the error page', async () => {
    await assert.rejects(async () => (await get('/half')).text());
});
