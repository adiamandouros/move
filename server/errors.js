import { STATUS_CODES } from 'http';

// The last stop for a request whose answer failed (a bug, or data that can't
// be drawn): the error is logged, and the visitor gets the site's error page,
// or from an API a JSON error, without its details. Express's own handler
// shows the stack trace, with the server's paths, unless NODE_ENV is
// production. Errors that carry a 4xx status (a body that's too big or isn't
// JSON) keep it and aren't logged. A 503 (data that isn't there yet) is
// expected too: not logged, and it says when to come back (err.retryAfter,
// in seconds).
//   page(path) → the error page for that address, in its language
//   log        where failures are logged
/** @param {{ page: (path: string) => string, log?: (message: string) => void }} options @returns {import('express').ErrorRequestHandler} */
export function errorHandler({ page, log = console.error }) {
    return (err, req, res, next) => {
        // Halfway through an answer: Express can only cut it off
        if (res.headersSent) return next(err);
        const status = err?.status === 503 || (err?.status >= 400 && err.status < 500) ? err.status : 500;
        if (status === 500) log(`[server] ${req.method} ${req.originalUrl} failed: ${err?.stack ?? err}`);
        res.status(status).set('Cache-Control', 'no-store');
        if (status === 503 && err.retryAfter) res.set('Retry-After', String(err.retryAfter));
        if (/^\/(admin\/)?api\//.test(req.path)) return res.json({ error: STATUS_CODES[status] });
        let html = null;
        try { html = page(req.path); } catch { /* the page itself can't be drawn: plain text */ }
        if (html) res.type('html').send(html);
        else res.type('text').send(STATUS_CODES[status]);
    };
}
