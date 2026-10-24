// Lines' pills and buses' plates (/js/core/lines.js): their text sits dead
// centre, measured from the pixels the browser draws. Browsers put text on
// whole pixels, so "dead centre" is to within one pixel either way.
import { expect, test } from './fixtures.js';

const PILLS = ['s', 'm', 'l'].flatMap(size => [
    `<span class="line-pill pill-${size} line-m1">M1</span>`,
    `<span class="line-pill pill-${size} line-m3">M3</span>`,
    `<span class="line-pill pill-${size} line-t6">T6</span>`,
    `<span class="bus-plate pill-${size}">040</span>`,
]);

test('the text in every pill and plate is centred', async ({ page }) => {
    await page.goto('/subway/stations/syntagma');
    await page.evaluate(async pills => {
        const row = document.createElement('div');
        row.id = 'pills';
        row.style.cssText = 'position: fixed; inset: 0 auto auto 0; z-index: 9999; display: flex; flex-wrap: wrap; align-items: flex-start; gap: 8px; padding: 8px; background: #777';
        row.innerHTML = pills.join('');
        document.body.append(row);
        await document.fonts.ready;
    }, PILLS);
    const viewport = page.viewportSize();
    const shot = (await page.screenshot({ clip: { x: 0, y: 0, width: viewport.width, height: 160 } })).toString('base64');

    // Each pill's empty space around its text: [above, below, left, right] in CSS px
    const spaces = await page.evaluate(async png => {
        const img = new Image();
        img.src = `data:image/png;base64,${png}`;
        await img.decode();
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const context = canvas.getContext('2d');
        context.drawImage(img, 0, 0);
        const { data } = context.getImageData(0, 0, img.width, img.height);
        const scale = img.width / window.innerWidth;
        return [...document.querySelectorAll('#pills > span')].map(pill => {
            const box = pill.getBoundingClientRect();
            const ink = getComputedStyle(pill).color.match(/\d+/g).map(Number);
            let top = Infinity, bottom = -1, left = Infinity, right = -1;
            for (let y = Math.floor(box.top * scale); y < Math.ceil(box.bottom * scale); y++) {
                for (let x = Math.floor(box.left * scale); x < Math.ceil(box.right * scale); x++) {
                    const i = (y * img.width + x) * 4;
                    if (Math.abs(data[i] - ink[0]) + Math.abs(data[i + 1] - ink[1]) + Math.abs(data[i + 2] - ink[2]) > 90) continue;
                    top = Math.min(top, y); bottom = Math.max(bottom, y + 1); left = Math.min(left, x); right = Math.max(right, x + 1);
                }
            }
            return { pill: pill.outerHTML, space: [top / scale - box.top, box.bottom - bottom / scale, left / scale - box.left, box.right - right / scale] };
        });
    }, shot);

    expect(spaces).toHaveLength(PILLS.length);
    for (const { pill, space: [above, below, left, right] } of spaces) {
        expect(Math.abs(above - below), `${pill}: ${above.toFixed(2)} above, ${below.toFixed(2)} below`).toBeLessThanOrEqual(1);
        expect(Math.abs(left - right), `${pill}: ${left.toFixed(2)} left, ${right.toFixed(2)} right`).toBeLessThanOrEqual(1);
    }
});
