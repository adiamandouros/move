import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { loadTools, stringTables } from '../server/pages/registry.js';
import { minutesBadge, minutesMark, minutesWords, soonTier, timeBadge } from '../public/js/core/times.js';
import { strings } from './support/browser-modules.js';

// The time badge (public/js/core/times.js): how soon, on one scale for buses
// and trains; and minutes, written one way on every page

test('how soon: due up to 3 minutes, close up to 8, later after', () => {
    assert.deepEqual([0, 1, 3, 4, 8, 9, 60].map(soonTier), ['due', 'due', 'due', 'close', 'close', 'later', 'later']);
});

test('a badge is its tier\'s class around the content, with its words as the title', () => {
    assert.equal(String(timeBadge('due', '2')), '<span class="time-badge time-due">2</span>');
    assert.equal(String(timeBadge('last', '05:32', 'Last train')), '<span class="time-badge time-last" title="Last train">05:32</span>');
});

const en = strings('en');
const el = strings('el');
const tEn = key => en[key];
const tEl = key => el[key];

test('minutes: "7\'" on screen, "7 minutes" for screen readers; one minute is one', () => {
    assert.equal(String(minutesMark(7, tEn)), '<span aria-hidden="true">7\'</span><span class="sr-only">7 minutes</span>');
    assert.equal(String(minutesMark(1, tEn)), '<span aria-hidden="true">1\'</span><span class="sr-only">1 minute</span>');
    assert.equal(String(minutesMark(7, tEl)), '<span aria-hidden="true">7\'</span><span class="sr-only">7 λεπτά</span>');
    assert.equal(String(minutesMark(1, tEl)), '<span aria-hidden="true">1\'</span><span class="sr-only">1 λεπτό</span>');
    assert.equal(String(minutesMark(0, tEn)), '<span aria-hidden="true">0\'</span><span class="sr-only">0 minutes</span>');
});

test('minutes that are a guess: "~16\'", "about 16 minutes"; a range: "16–19\'", "16 to 19 minutes"', () => {
    assert.equal(String(minutesMark(16, tEn, { about: true })), '<span aria-hidden="true">~16\'</span><span class="sr-only">about 16 minutes</span>');
    assert.equal(String(minutesMark(16, tEl, { about: true })), '<span aria-hidden="true">~16\'</span><span class="sr-only">περίπου 16 λεπτά</span>');
    assert.equal(String(minutesMark([16, 19], tEn)), '<span aria-hidden="true">16–19\'</span><span class="sr-only">16 to 19 minutes</span>');
    assert.equal(String(minutesMark([16, 19], tEl)), '<span aria-hidden="true">16–19\'</span><span class="sr-only">16 έως 19 λεπτά</span>');
    // In words alone, for what's announced
    assert.equal(minutesWords(1, tEn, true), 'about 1 minute');
    assert.equal(minutesWords([3, 5], tEl), '3 έως 5 λεπτά');
});

test('more words for screen readers go after the minutes', () => {
    assert.equal(String(minutesMark(2, tEn, { then: ' (Last train),' })), '<span aria-hidden="true">2\'</span><span class="sr-only">2 minutes (Last train),</span>');
});

test('a bus coming: its minutes in a badge of how soon, "arriving soon" when it\'s due', () => {
    assert.equal(String(minutesBadge(3, tEn)), '<span class="time-badge time-due"><span aria-hidden="true">3\'</span><span class="sr-only">3 minutes, arriving soon</span></span>');
    assert.equal(String(minutesBadge(4, tEl)), '<span class="time-badge time-close"><span aria-hidden="true">4\'</span><span class="sr-only">4 λεπτά</span></span>');
    assert.equal(String(minutesBadge(12, tEn)), '<span class="time-badge time-later"><span aria-hidden="true">12\'</span><span class="sr-only">12 minutes</span></span>');
});

// DESIGN.md, "Type": minutes are written 7' everywhere, never ′ or "min",
// and screen readers hear the words. So no string writes minutes itself
// but the helpers' own, and no script draws the mark but times.js
test('no string writes minutes: no ′, no "min", no "{minutes} minutes"; the helpers fill {minutes}', () => {
    const OWN = new Set(['shell.minute', 'shell.minutes', 'shell.minutes-range']);
    const writesMinutes = /′|\bmin\b|(\{\w+\}|\d)\s*(minutes?|λεπτά|λεπτό)(?!\p{L})/u;
    for (const table of stringTables(loadTools())) {
        for (const [lang, texts] of Object.entries(table)) {
            for (const [key, text] of Object.entries(texts)) {
                if (!OWN.has(key)) assert.doesNotMatch(text, writesMinutes, `${lang} ${key}`);
            }
        }
    }
});

test('no script draws minutes but times.js: no ′, no "${n}\'" of its own', () => {
    const ROOT = new URL('..', import.meta.url).pathname;
    const dirs = ['public/js/core', ...loadTools().map(t => `tools/${t.id}/client`)];
    const files = dirs.flatMap(dir => readdirSync(join(ROOT, dir)).filter(f => f.endsWith('.js')).map(f => join(dir, f)));
    assert.ok(files.length > 30);
    for (const file of files.filter(f => f !== 'public/js/core/times.js')) {
        const code = readFileSync(join(ROOT, file), 'utf8');
        assert.doesNotMatch(code, /′|\}'<\/span>/, file);
    }
});
