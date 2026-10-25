// What every browser test shares. Import { test, expect } from here, not from
// @playwright/test, and each test gets:
//   - a fixed clock: Wednesday 21 October 2026, 12:00 in Athens, running from
//     there (test.use({ now: '…' }) for another moment, now: null for the real one)
//   - a fake location service (test.use({ location: { … } }), below)
//   - a failure if the page throws or logs an error
// and the helpers axe(page), keyboardWalk(page) and onlyOn(...projects).
import { test as base, expect } from '@playwright/test';
import { readFileSync } from 'fs';
import { createRequire } from 'module';

export { expect };

const AXE = readFileSync(createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8');
// WCAG 2.2 A and AA, and axe's best practices
const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'];

export const SYNTAGMA = { lat: 37.9755, lng: 23.7348 };
export const OMONIA = { lat: 37.9842, lng: 23.7281 };

// The location service the pages see, in place of the browser's:
//   permission: what navigator.permissions says: 'granted', 'prompt' or 'denied'
//   answer:     what asking gives: 'position' (at `at`), 'deny' or 'never' (no signal)
// window.__geo counts the calls to it on the current page, so tests can tell
// whether a page asked.
const LOCATION = { permission: 'granted', answer: 'position', at: SYNTAGMA };

function fakeLocation(settings) {
    const geo = { ...settings };
    window.__geo = 0;
    // Tests change it mid-way with page.evaluate(s => window.__setLocation(s), {...})
    window.__setLocation = changes => Object.assign(geo, changes);
    const answer = (ok, fail) => {
        window.__geo++;
        if (geo.answer === 'position') {
            const at = geo.at;
            setTimeout(() => {
                if (geo.permission === 'prompt') geo.permission = 'granted';
                ok({ coords: { latitude: at.lat, longitude: at.lng, accuracy: 20 }, timestamp: Date.now() });
            }, 50);
        } else if (geo.answer === 'deny') {
            setTimeout(() => { geo.permission = 'denied'; fail?.({ code: 1, message: 'User denied Geolocation' }); }, 50);
        }
        // 'never': no answer at all, like a phone without a signal
    };
    let ids = 0;
    const location = {
        getCurrentPosition: (ok, fail) => answer(ok, fail),
        watchPosition: (ok, fail) => { answer(ok, fail); return ++ids; },
        clearWatch: () => {},
    };
    Object.defineProperty(Navigator.prototype, 'geolocation', { get: () => location, configurable: true });
    const query = navigator.permissions?.query.bind(navigator.permissions);
    if (query) {
        navigator.permissions.query = descriptor => descriptor?.name === 'geolocation'
            ? Promise.resolve({ state: geo.permission, onchange: null, addEventListener() {}, removeEventListener() {} })
            : query(descriptor);
    }
}

export const test = base.extend({
    now: ['2026-10-21T12:00:00+03:00', { option: true }],
    location: [LOCATION, { option: true }],
    // The normal site, or one where something goes wrong: test.use({ scenario:
    // 'oasa-down' }) (the list is in server.js); setScenario() switches mid-test
    scenario: ['normal', { option: true }],
    // Console errors a test expects, like a 503 it set up: [/status of 503/]
    allowErrors: [[], { option: true }],

    page: async ({ page, now, location, scenario, allowErrors }, use, testInfo) => {
        await setScenario(page, scenario);
        if (now) await page.clock.install({ time: new Date(now) });
        await page.addInitScript(fakeLocation, { ...LOCATION, ...location });
        const errors = [];
        // A page that answers 404 (the not-found page) is logged as an error;
        // browsers name its address differently, so any 404 document counts
        let notFoundPage = false;
        page.on('response', r => { if (r.status() === 404 && r.request().resourceType() === 'document') notFoundPage = true; });
        page.on('pageerror', e => errors.push(`${page.url()}: ${e.message}`));
        page.on('console', m => {
            if (m.type() !== 'error' || (notFoundPage && /^Failed to load resource: .*404/.test(m.text()))) return;
            if (allowErrors.some(pattern => pattern.test(m.text()))) return;
            errors.push(`${page.url()}: console: ${m.text()}`);
        });
        await use(page);
        if (testInfo.status === testInfo.expectedStatus) expect(errors, 'no script errors').toEqual([]);
    },
});

// For tests that behave the same in every browser (their logic is tested in
// Node too): run them on these projects only. In a describe() or a file:
//   test.beforeEach(onlyOn('phone'));
export const onlyOn = (...projects) => ({}, { project }) =>
    test.skip(!projects.includes(project.name), `the same everywhere: runs on ${projects.join(', ')} only`);

// Open a section of the accordion (or a part inside one) with a tap, and wait
// until it has opened, as a person would before tapping something in it.
// While it slides open it clips what's inside: to show a button there, the
// browser scrolls the clipped box, which unscrolls as the box grows, and the
// tap lands above the button.
export async function openSection(page, toggle) {
    const button = page.locator(toggle);
    await button.click();
    await expect(page.locator(String(await button.getAttribute('data-bs-target')))).toHaveClass(/\bshow\b/);
}

// axe-core's violations on the page as it is now: ["rule-id (nodes): selector", …]
export async function axe(page) {
    // Through the devtools, not a <script> element, which the Content-Security-Policy blocks
    if (!(await page.evaluate(() => 'axe' in window))) await page.evaluate(AXE);
    return page.evaluate(async tags => {
        // Colours halfway through a fade aren't what anyone reads
        await Promise.all(document.getAnimations().map(a => a.finished.catch(() => {})));
        const { violations } = await window.axe.run(document, { runOnly: tags });
        return violations.map(v => `${v.id} (${v.nodes.length}): ${v.nodes[0].target.join(' ')}`);
    }, AXE_TAGS);
}

// Tab through the page from the top, as someone using a keyboard would.
// → { stops: ['a "Home"', …], problems: [...] }. A problem is a stop that's
// hidden, has no visible focus indicator, or is behind the fixed navigation;
// or focus that never moves or never comes back round (a trap).
export async function keyboardWalk(page, { max = 120 } = {}) {
    await page.evaluate(() => { document.activeElement?.blur(); window.scrollTo(0, 0); window.__walk = new WeakMap(); });
    const stops = [], problems = [];
    let previous = null;
    for (let i = 0; i < max; i++) {
        await page.keyboard.press('Tab');
        const stop = await page.evaluate(async () => {
            const el = document.activeElement;
            if (!el || el === document.body) return null;
            const seen = window.__walk.has(el);
            if (!seen) window.__walk.set(el, true);
            // Let it finish sliding or fading in (a skip link), as a person would see it
            await Promise.all(document.getAnimations().map(a => a.finished.catch(() => {})));
            const name = `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''} "${(el.getAttribute('aria-label') || el.textContent || el.value || '').replace(/\s+/g, ' ').trim().slice(0, 40)}"`;
            const r = el.getBoundingClientRect();
            const style = getComputedStyle(el);
            const outline = style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) > 0;
            const ring = style.boxShadow !== 'none';
            // Covered by something else (the fixed bottom bar, a header) at its centre
            const x = Math.min(Math.max(r.left + r.width / 2, 0), innerWidth - 1), y = Math.min(Math.max(r.top + r.height / 2, 0), innerHeight - 1);
            const top = document.elementFromPoint(x, y);
            return {
                seen,
                same: el === window.__walkLast,
                name,
                visible: r.width > 0 && r.height > 0 && style.visibility !== 'hidden',
                indicator: outline || ring,
                covered: Boolean(top) && top !== el && !el.contains(top) && !top.contains(el),
                _: (window.__walkLast = el, 0),
            };
        }).catch(() => null);
        if (!stop) { if (stops.length) break; continue; }
        if (stop.same) { problems.push(`focus stuck on ${stop.name}`); break; }
        // Back at an element already visited: round the page once
        if (stop.seen) break;
        stops.push(stop.name);
        if (!stop.visible) problems.push(`${stop.name}: focused but not visible`);
        else if (!stop.indicator) problems.push(`${stop.name}: no visible focus indicator`);
        else if (stop.covered) problems.push(`${stop.name}: hidden behind something else`);
        if (i === max - 1) problems.push(`focus never came back round after ${max} Tabs (a trap?)`);
        previous = stop;
    }
    if (!stops.length) problems.push('Tab reaches nothing');
    return { stops, problems, last: previous?.name };
}

// Which copy of the site this page's requests go to (server.js SCENARIOS),
// e.g. setScenario(page, 'normal') when OASA comes back
export async function setScenario(page, scenario) {
    await page.context().addCookies([{ name: 'scenario', value: scenario, url: test.info().project.use.baseURL }]);
}
