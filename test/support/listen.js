// A test's own server, on a free port: listen(app) → { url, close }, for an
// Express app or a plain http server. close() also ends the connections
// fetch() keeps open to use again, which server.close() alone waits seconds
// for: each file that started a server took that long to end. Every test
// starts its servers here (fast.test.js checks).
export async function listen(app) {
    const server = await new Promise(resolve => { const s = app.listen(0, () => resolve(s)); });
    return {
        url: `http://localhost:${server.address().port}`,
        close: () => { server.closeAllConnections(); server.close(); },
    };
}
