// Sending answers

// An answer browsers may keep but must check with us each time (no-cache):
// pages, the service workers, the manifest, robots.txt, the sitemap
/** @param {import('express').Response} res @param {string} type @param {string} body */
export function sendFresh(res, type, body) {
    return res.set('Cache-Control', 'no-cache').type(type).send(body);
}
