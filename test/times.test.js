import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { loadTools, stringTables } from '../server/pages/registry.js';
import { aboutTime, countBadges, epochAt, minutesBadge, minutesLeft, minutesMark, minutesWords, soonTier, timeBadge } from '../public/js/core/times.js';
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

test('a clock time that\'s a guess: "~12:06" on screen, "about 12:06" for screen readers (decision 11)', () => {
    assert.equal(String(aboutTime('12:06', tEn)), '<span aria-hidden="true">~12:06</span><span class="sr-only">about 12:06</span>');
    assert.equal(String(aboutTime('12:06', tEl)), '<span aria-hidden="true">~12:06</span><span class="sr-only">περίπου 12:06</span>');
});

test('more words for screen readers go after the minutes', () => {
    assert.equal(String(minutesMark(2, tEn, { then: ' (Last train),' })), '<span aria-hidden="true">2\'</span><span class="sr-only">2 minutes (Last train),</span>');
});

test('screen readers can hear the minutes in a sentence: "next in 19 minutes", a bus due "next in 2 minutes, arriving soon"', () => {
    assert.equal(String(minutesMark(19, tEn, { said: 'next in {minutes}' })), '<span aria-hidden="true">19\'</span><span class="sr-only">next in 19 minutes</span>');
    assert.equal(String(minutesBadge(2, tEl, { said: 'το επόμενο σε {minutes}' })), '<span class="time-badge time-due"><span aria-hidden="true">2\'</span><span class="sr-only">το επόμενο σε 2 λεπτά, φτάνει σύντομα</span></span>');
});

test('a bus coming: its minutes in a badge of how soon, "arriving soon" when it\'s due', () => {
    assert.equal(String(minutesBadge(3, tEn)), '<span class="time-badge time-due"><span aria-hidden="true">3\'</span><span class="sr-only">3 minutes, arriving soon</span></span>');
    assert.equal(String(minutesBadge(4, tEl)), '<span class="time-badge time-close"><span aria-hidden="true">4\'</span><span class="sr-only">4 λεπτά</span></span>');
    assert.equal(String(minutesBadge(12, tEn)), '<span class="time-badge time-later"><span aria-hidden="true">12\'</span><span class="sr-only">12 minutes</span></span>');
});

// Every time counts down by itself (decision 61)

test('a timetable\'s time to the second: 4\'30" reads 4\', 0\' in its last minute, gone as it leaves', () => {
    const at = 1000;
    assert.deepEqual([at - 270, at - 60, at - 59, at - 1, at, at + 1].map(now => minutesLeft(at, now, true)), [4, 1, 0, 0, 0, null]);
});

test('OASA\'s whole minutes: "2\'" reads 0\' for the minute after its time, then it\'s gone, as the Buses page counts', () => {
    const at = 1000;
    assert.deepEqual([at - 120, at - 61, at - 60, at - 1, at, at + 59, at + 60].map(now => minutesLeft(at, now)), [2, 2, 1, 1, 0, 0, null]);
    assert.ok(Object.is(minutesLeft(at, at + 30), 0), 'never -0');
});

test('a time from midnight as seconds since 1970, only with the moment\'s epoch', () => {
    assert.equal(epochAt(12 * 3600 + 90, { seconds: 12 * 3600, epoch: 1_800_000_000 }), 1_800_000_090);
    assert.equal(epochAt(12 * 3600 + 90, { seconds: 12 * 3600 }), null);
});

test('a badge with its time keeps how it was drawn; without, it\'s as before', () => {
    assert.equal(String(minutesBadge(5, tEn, { at: 1_800_000_300 })), '<span class="time-badge time-close" data-at="1800000300" data-minutes="5"><span aria-hidden="true">5\'</span><span class="sr-only">5 minutes</span></span>');
    assert.equal(String(minutesBadge(5, tEn, { said: 'next in {minutes}', at: 1_800_000_300, exact: true })),
        '<span class="time-badge time-close" data-at="1800000300" data-minutes="5" data-exact data-said="next in {minutes}"><span aria-hidden="true">5\'</span><span class="sr-only">next in 5 minutes</span></span>');
});

// A page's badges, as countBadges sees them: their data, title, and what
// replaced or removed them
function badgesIn(...drawn) {
    const page = drawn.map(view => {
        const [, attributes] = String(view).match(/^<span ([^>]*)>/);
        const dataset = Object.fromEntries([...attributes.matchAll(/data-([a-z]+)(?:="([^"]*)")?/g)].map(([, name, value = '']) => [name, value.replaceAll('&#x3D;', '=')]));
        const badge = { dataset, title: attributes.match(/title="([^"]*)"/)?.[1] ?? '', now: String(view), closest: () => null, remove() { badge.now = null; } };
        Object.defineProperty(badge, 'outerHTML', { set(view) { badge.now = view; } });
        return badge;
    });
    return { querySelectorAll: () => page, page };
}

test('counting badges: each drawn again as its minute changes, the same way; gone at -1\'; the others left as they are', () => {
    const epoch = 1_800_000_000;
    const root = badgesIn(
        minutesBadge(9, tEn, { at: epoch + 9 * 60 }),
        minutesBadge(5, tEn, { said: 'next in {minutes}', at: epoch + 5 * 60 + 30, exact: true }),
        minutesBadge(1, tEn, { at: epoch + 60 }),
        minutesBadge(2, tEn, { then: ' (Last train),', tier: 'last', soon: false, title: 'Last train', at: epoch + 150, exact: true }),
    );
    const before = root.page.map(badge => badge.now);
    assert.equal(countBadges(root, tEn, epoch + 30), false, 'nothing gone yet');
    assert.deepEqual(root.page.map(badge => badge.now), before, 'nor any minute changed: nothing drawn again');
    assert.equal(countBadges(root, tEn, epoch + 6 * 60 + 1), true, 'one gone');
    const [nine, five, one, last] = root.page.map(badge => badge.now);
    assert.equal(nine, String(minutesBadge(3, tEn, { at: epoch + 9 * 60 })), 'OASA\'s 9\', 6 minutes on: 3\', and due now');
    assert.equal(five, null, '5\'30" by the timetable, 6 minutes on: gone');
    assert.equal(one, null);
    assert.equal(last, null);
    const kept = badgesIn(minutesBadge(2, tEn, { then: ' (Last train),', tier: 'last', soon: false, title: 'Last train', at: epoch + 150, exact: true }));
    countBadges(kept, tEn, epoch + 61);
    assert.equal(kept.page[0].now, String(minutesBadge(1, tEn, { then: ' (Last train),', tier: 'last', soon: false, title: 'Last train', at: epoch + 150, exact: true })), 'the last train stays red, its words kept');
});

// Road · 18: the Subway and Trip pages' "In:" goes with its last train,
// while the answer is held too
test('counting badges: the last badge of a holder marked data-badges takes all it holds with it', () => {
    const epoch = 1_800_000_000;
    const holder = { emptied: false, badges: [], querySelector: () => holder.badges.find(b => b.now) ?? null, replaceChildren() { holder.emptied = true; } };
    const root = badgesIn(minutesBadge(1, tEn, { at: epoch + 60, exact: true }), minutesBadge(5, tEn, { at: epoch + 5 * 60, exact: true }));
    holder.badges = root.page;
    for (const badge of root.page) badge.closest = () => holder;
    countBadges(root, tEn, epoch + 61);
    assert.equal(holder.emptied, false, 'one train still to come: the label stays');
    countBadges(root, tEn, epoch + 5 * 60 + 1);
    assert.equal(holder.emptied, true, 'none left: label and all');
    // A badge in no such holder: only itself, as before
    const alone = badgesIn(minutesBadge(1, tEn, { at: epoch + 60, exact: true }));
    assert.equal(countBadges(alone, tEn, epoch + 61), true);
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
