// The Content-Security-Policy in a real browser (server/csp.js). Every other
// browser test runs with it enforced and fails on any console error, so
// those show the site's own scripts are allowed; these show that what
// someone might inject isn't.
import { expect, test } from './fixtures.js';

test.use({ allowErrors: [/Content Security Policy|Refused to (execute|load)|status of 404/] });

for (const path of ['/', '/subway?from=syntagma&to=airport', '/el/buses', '/subway/stations/omonia']) {
    test(`${path}: injected scripts don't run`, async ({ page }) => {
        await page.goto(path);
        await expect(page.locator('h1').first()).toBeAttached();
        const ran = await page.evaluate(async () => {
            const w = /** @type {any} */ (window);
            w.ran = [];
            // An inline script, an event handler attribute, and a script from elsewhere
            const inline = document.createElement('script');
            inline.textContent = 'window.ran.push("inline")';
            document.head.append(inline);
            const html = document.createElement('div');
            html.innerHTML = '<img src="/nope.png" onerror="window.ran.push(\'onerror\')">';
            document.body.append(html);
            const remote = document.createElement('script');
            // A real script on another origin (127.0.0.1 isn't localhost to the browser)
            remote.src = `${location.protocol}//127.0.0.1:${location.port}/vendor/bootstrap/js/bootstrap.min.js`;
            remote.onload = () => w.ran.push('remote');
            document.head.append(remote);
            await new Promise(resolve => setTimeout(resolve, 500));
            return w.ran;
        });
        expect(ran).toEqual([]);
    });
}

test('the policy is enforced, and says where to report', async ({ page }) => {
    const response = await page.goto('/');
    const headers = response.headers();
    expect(headers['content-security-policy']).toMatch(/script-src 'self' 'sha256-/);
    expect(headers['content-security-policy-report-only']).toBeUndefined();
    expect(headers['reporting-endpoints']).toBe('csp="/api/csp-report"');
});
