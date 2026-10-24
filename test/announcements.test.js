import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { createAnnouncements, decode, isDisruption, parseOasaFeed, parseStasyDate, parseStasyList } from '../server/info/announcements.js';
import { browserModule } from './support/browser-modules.js';
import { announcementChecks } from '../server/diagnostics.js';

// Trimmed copies of the real OASA feed and STASY pages
const rssItem = (title, date, categories) => `<item>
    <title>${title}</title>
    <link>https://www.oasa.gr/blog/${encodeURIComponent(title)}/</link>
    <pubDate>${date}</pubDate>
    ${categories.map(c => `<category><![CDATA[${c}]]></category>`).join('')}
</item>`;
const feed = (...items) => `<?xml version="1.0"?><rss><channel><title>OASA</title>${items.join('')}</channel></rss>`;

const stasyArticle = (id, slug, title) => `<article id="post-${id}" class="clearfix">
    <a href="https://www.stasy.gr/${slug}/" class="gem-slider-blog-link"></a>
    <div class="post-title"><h5 class="entry-title"><span class="entry-title-date"></span><span class="light">${title}</span></h5></div>
</article>`;
const stasyPost = date => `<meta property="article:published_time" content="${date}" />`;

test('decode handles CDATA, entities and tags', () => {
    assert.equal(decode('<![CDATA[Γραμμή <b>Χ20</b>]]>'), 'Γραμμή Χ20');
    assert.equal(decode('Χ20 &#8220;ΑΜΠΕΛΟΚΗΠΟΙ&#8221; &amp; &#x3a9;'), 'Χ20 “ΑΜΠΕΛΟΚΗΠΟΙ” & Ω');
});

test('the OASA feed keeps passenger notices and drops tenders', () => {
    const items = parseOasaFeed(feed(
        rssItem('Τροποποίηση γραμμής 418', 'Wed, 14 Oct 2026 03:00:23 +0000', ['Ανακοινώσεις', 'Alerts']),
        rssItem('Διαγωνισμός προμήθειας', 'Tue, 13 Oct 2026 10:00:00 +0000', ['Διαγωνισμοί']),
        rssItem('Temporary line X24', 'Fri, 09 Oct 2026 05:00:18 +0000', ['Announcements']),
    ));
    assert.deepEqual(items.map(i => i.title), ['Τροποποίηση γραμμής 418', 'Temporary line X24']);
    assert.equal(items[0].date, '2026-10-14T03:00:23.000Z');
});

test('the STASY list drops job ads and duplicate links', () => {
    const posts = parseStasyList(
        stasyArticle(1, 'l3', 'Κυκλοφοριακές ρυθμίσεις στη Γραμμή 3')
        + stasyArticle(2, 'job', 'ΠΡΟΚΗΡΥΞΗ ΓΙΑ ΤΗΝ ΚΑΛΥΨΗ ΜΙΑΣ (1) ΘΕΣΗΣ')
        + stasyArticle(3, 'agm', 'Πρόσκληση Ετήσιας Τακτικής Γενικής Συνέλευσης')
        + stasyArticle(4, 'l3', 'Κυκλοφοριακές ρυθμίσεις στη Γραμμή 3'),
    );
    assert.deepEqual(posts, [{ title: 'Κυκλοφοριακές ρυθμίσεις στη Γραμμή 3', link: 'https://www.stasy.gr/l3/' }]);
    assert.equal(parseStasyDate(stasyPost('2026-10-10T10:00:00+03:00')), '2026-10-10T07:00:00.000Z');
    assert.equal(parseStasyDate('<html></html>'), null);
});

test('strikes and closures count as disruptions, in either language and any case', () => {
    assert.ok(isDisruption('Στάση εργασίας στα λεωφορεία την Πέμπτη'));
    assert.ok(isDisruption('ΑΠΕΡΓΙΑ ΣΤΟ ΜΕΤΡΟ'));
    assert.ok(isDisruption('οι σταθμοί θα κλείνουν στις 21:40'));
    assert.ok(isDisruption('24-hour strike on Thursday'));
    assert.ok(!isDisruption('Τροποποίηση της γραμμής 418'));
});

// A fake web with the three sources; records each URL fetched
function fakeWeb(pages) {
    const calls = [];
    const fetch = async url => {
        calls.push(url);
        const body = typeof pages[url] === 'function' ? pages[url]() : pages[url];
        if (body === undefined || body instanceof Error) throw body ?? new Error('not found');
        return { ok: true, text: async () => body };
    };
    return { fetch, calls };
}

// Let a background refresh finish (the fake fetches answer at once)
const settle = () => new Promise(resolve => setImmediate(resolve));

const NOW = Date.parse('2026-10-14T12:00:00Z');
const OASA_EL = 'https://www.oasa.gr/feed/';
const OASA_EN = 'https://www.oasa.gr/en/feed/';
const STASY = 'https://www.stasy.gr/%ce%bd%ce%ad%ce%b1-%ce%b1%ce%bd%ce%b1%ce%ba%ce%bf%ce%b9%ce%bd%cf%8e%cf%83%ce%b5%ce%b9%cf%82/';

function sources() {
    return {
        [OASA_EL]: feed(
            rssItem('Στάση εργασίας στα λεωφορεία', 'Tue, 13 Oct 2026 08:00:00 +0000', ['Ανακοινώσεις']),
            rssItem('Παλιά ανακοίνωση', 'Mon, 01 Jun 2026 08:00:00 +0000', ['Ανακοινώσεις']),
        ),
        [OASA_EN]: feed(rssItem('Temporary line X24', 'Fri, 09 Oct 2026 05:00:18 +0000', ['Announcements'])),
        [STASY]: stasyArticle(1, 'l3', 'Οι σταθμοί θα κλείνουν στις 21:40') + stasyArticle(2, 'train', 'Νέος συρμός στη Γραμμή 1'),
        'https://www.stasy.gr/l3/': stasyPost('2026-10-10T10:00:00+03:00'),
        'https://www.stasy.gr/train/': stasyPost('2026-10-12T10:00:00+03:00'),
    };
}

test('announcements are fetched once per 15 minutes, newest first, recent only', async () => {
    let t = NOW;
    const web = fakeWeb(sources());
    const ann = createAnnouncements({ fetch: web.fetch, now: () => t, log: () => {} });

    const first = await ann.current();
    assert.deepEqual(first.rail.map(i => [i.title, i.disruption]), [
        ['Νέος συρμός στη Γραμμή 1', false],
        ['Οι σταθμοί θα κλείνουν στις 21:40', true],
    ]);
    assert.deepEqual(first.bus.el.map(i => [i.title, i.disruption]), [['Στάση εργασίας στα λεωφορεία', true]]);
    assert.deepEqual(first.bus.en.map(i => i.title), ['Temporary line X24']);
    assert.equal(web.calls.length, 5);

    // Within 15 minutes: served from memory
    t += 10 * 60_000;
    await ann.current();
    assert.equal(web.calls.length, 5);

    // After that: the list pages again, but known STASY posts aren't fetched again
    t += 10 * 60_000;
    await ann.current();
    await settle();
    assert.deepEqual(web.calls.slice(5).sort(), [OASA_EN, OASA_EL, STASY].sort());

    // A week later the disruption banner is over, but the item stays listed
    t = NOW + 8 * 86_400_000;
    const later = await ann.current();
    assert.deepEqual(later.bus.el.map(i => i.disruption), [false]);
});

test('concurrent requests share one refresh', async () => {
    const web = fakeWeb(sources());
    const ann = createAnnouncements({ fetch: web.fetch, now: () => NOW, log: () => {} });
    await Promise.all([ann.current(), ann.current(), ann.current()]);
    assert.equal(web.calls.length, 5);
});

test('once there is a copy, a refresh happens behind it instead of holding up the answer', async () => {
    let t = NOW;
    let release;
    const pages = sources();
    const web = fakeWeb(pages);
    const ann = createAnnouncements({ fetch: web.fetch, now: () => t, log: () => {} });
    await ann.current();

    // The next refresh hangs on the STASY page; the old copy is served meanwhile
    pages[STASY] = () => new Promise(resolve => { release = resolve; });
    t += 20 * 60_000;
    const answer = await Promise.race([ann.current(), new Promise(resolve => setTimeout(() => resolve('timeout'), 100))]);
    assert.notEqual(answer, 'timeout');
    assert.equal(answer.rail.length, 2);
    release(sources()[STASY]);
    await settle();
});

test('a failing source keeps its last good copy, and the copy survives a restart', async () => {
    let t = NOW;
    const pages = sources();
    const web = fakeWeb(pages);
    const cacheFile = join(mkdtempSync(join(tmpdir(), 'move-ann-')), 'announcements.json');
    const ann = createAnnouncements({ fetch: web.fetch, now: () => t, log: () => {}, cacheFile });
    await ann.current();

    pages[STASY] = new Error('ECONNRESET');
    t += 20 * 60_000;
    await ann.current();
    await settle();
    const after = await ann.current();
    assert.equal(after.rail.length, 2);

    // A new process with every source down still has something to show
    const offline = createAnnouncements({ fetch: async () => { throw new Error('down'); }, now: () => t, log: () => {}, cacheFile });
    const restored = await offline.current();
    assert.equal(restored.rail.length, 2);
    assert.equal(restored.bus.el.length, 1);
    assert.ok(JSON.parse(readFileSync(cacheFile, 'utf8')).dates['https://www.stasy.gr/l3/']);
});

// ── STASY through the relays ────────────────────────────────────────────────

const RELAY = { name: 'home relay', url: 'https://relay.example:2087/', key: 'k' };
const relayUrl = path => `${RELAY.url}?act=stasyPage&path=${encodeURIComponent(path)}`;
const STASY_PATH = STASY.replace('https://www.stasy.gr/', '').replace(/\/$/, '');

// Like the live server: STASY refuses it directly (403), the relay gets through
function blockedWeb({ relayKnowsStasy = true } = {}) {
    const pages = sources();
    for (const url of [STASY, 'https://www.stasy.gr/l3/', 'https://www.stasy.gr/train/']) {
        const path = url.replace('https://www.stasy.gr/', '').replace(/\/$/, '');
        pages[relayUrl(path)] = relayKnowsStasy ? pages[url] : undefined;
        pages[url] = undefined;
    }
    const calls = [];
    const fetch = async (url, init) => {
        calls.push(url);
        if (url.startsWith('https://www.stasy.gr/')) return { ok: false, status: 403, text: async () => 'Forbidden' };
        if (url.startsWith(RELAY.url)) {
            assert.equal(init.headers['X-Relay-Key'], 'k');
            if (!pages[url]) return { ok: false, status: 400, text: async () => 'Bad request' };
        }
        if (pages[url] === undefined) throw new Error('not found');
        return { ok: true, text: async () => pages[url] };
    };
    return { fetch, calls };
}

test('when STASY refuses the server, its pages come through the relay, and direct access rests for a day', async () => {
    let t = NOW;
    const web = blockedWeb();
    const ann = createAnnouncements({ fetch: web.fetch, now: () => t, log: () => {}, relays: [RELAY] });
    const first = await ann.current();
    assert.equal(first.rail.length, 2);
    assert.ok(web.calls.includes(relayUrl(STASY_PATH)));
    assert.ok(web.calls.includes(relayUrl('l3')));
    assert.deepEqual(ann.status().stasy, { ok: true, at: t, route: 'home relay', items: 2, updated: new Date(t).toISOString() });

    // The next refresh goes straight to the relay
    web.calls.length = 0;
    t += 20 * 60_000;
    await ann.refreshNow();
    assert.ok(!web.calls.some(url => url.startsWith('https://www.stasy.gr/')), 'direct access is resting');
    assert.ok(web.calls.includes(relayUrl(STASY_PATH)));

    // A day later, direct access is tried again
    web.calls.length = 0;
    t += 25 * 3_600_000;
    await ann.refreshNow();
    assert.ok(web.calls.includes(STASY));
});

test('a relay that predates STASY support is reported, and diagnostics say how to update it', async () => {
    const web = blockedWeb({ relayKnowsStasy: false });
    const ann = createAnnouncements({ fetch: web.fetch, now: () => NOW, log: () => {}, relays: [RELAY] });
    await ann.refreshNow();
    const stasy = ann.status().stasy;
    assert.equal(stasy.ok, false);
    assert.match(stasy.error, /direct: HTTP 403; home relay: HTTP 400/);
    const [check] = announcementChecks({ stasy }, () => NOW);
    assert.equal(check.status, 'fail');
    assert.match(check.hint, /sudo git -C \/opt\/move pull && sudo systemctl restart move-relay/);
});

test('without relays, a refusal is reported and direct access is retried next time', async () => {
    let t = NOW;
    const web = blockedWeb();
    const ann = createAnnouncements({ fetch: web.fetch, now: () => t, log: () => {} });
    await ann.refreshNow();
    const [check] = announcementChecks({ stasy: ann.status().stasy }, () => t);
    assert.match(check.hint, /home relay/);
    web.calls.length = 0;
    t += 20 * 60_000;
    await ann.refreshNow();
    assert.ok(web.calls.includes(STASY));
});

test('diagnostics show each source, and which route STASY came through', () => {
    const checks = announcementChecks({
        oasaEl: { ok: true, at: NOW, route: 'direct', items: 8, updated: new Date(NOW).toISOString() },
        stasy: { ok: true, at: NOW, route: 'home relay', items: 5, updated: new Date(NOW).toISOString() },
        oasaEn: { ok: false, at: NOW, error: 'HTTP 500', items: 3, updated: new Date(NOW - 3_600_000).toISOString() },
    }, () => NOW);
    assert.deepEqual(checks.map(c => [c.title, c.status, c.detail]), [
        ['OASA (Greek)', 'ok', '8 current'],
        ['STASY (metro and tram)', 'ok', '5 current, through the home relay'],
        ['OASA (English)', 'warn', 'HTTP 500. Showing the copy from 60 min ago.'],
    ]);
});

test('only links to web addresses are kept: a javascript: link would run in the page', () => {
    const evil = rssItem('Τροποποίηση γραμμής 418', 'Wed, 14 Oct 2026 03:00:23 +0000', ['Ανακοινώσεις'])
        .replace(/<link>[^<]*<\/link>/, '<link>javascript:alert(1)</link>');
    const good = rssItem('Temporary line X24', 'Fri, 09 Oct 2026 05:00:18 +0000', ['Announcements']);
    assert.deepEqual(parseOasaFeed(feed(evil, good)).map(i => i.title), ['Temporary line X24']);

    const posts = parseStasyList(
        stasyArticle(1, 'l3', 'Κυκλοφοριακές ρυθμίσεις στη Γραμμή 3').replace('https://www.stasy.gr/l3/', 'javascript:alert(1)')
        + stasyArticle(2, 'l1', 'Κλειστός ο σταθμός Ομόνοια'),
    );
    assert.deepEqual(posts, [{ title: 'Κλειστός ο σταθμός Ομόνοια', link: 'https://www.stasy.gr/l1/' }]);
});

test('on the English pages, a STASY announcement carries an "Only available in Greek" badge', async () => {
    const { item } = await browserModule('public/js/core/announcements.js', 'en');
    const date = '2026-10-20T10:00:00.000Z';
    const greek = String(item({ title: 'Κλειστός σταθμός', link: 'https://www.stasy.gr/a/', date }, true));
    assert.match(greek, /<span class="in-greek-badge"><svg [^]*<\/svg>Only available in Greek<\/span>/);
    assert.doesNotMatch(String(item({ title: 'Closed', link: 'https://www.oasa.gr/a/', date }, false)), /in-greek-badge/);
});

test('the disruption box: the banner, "none" once every source the page reads answered, else nothing', async () => {
    const date = '2026-10-20T10:00:00.000Z';
    const plain = { title: 'Changes to line 040', link: 'https://www.oasa.gr/a/', date, disruption: false };
    const strike = { title: 'Στάση εργασίας', link: 'https://www.oasa.gr/b/', date, disruption: true };
    const all = ['stasy', 'oasaEl', 'oasaEn'];
    const data = (bus, available = all) => ({ rail: [], bus: { el: bus, en: [plain] }, available });

    const en = await browserModule('public/js/core/announcements.js', 'en');
    assert.match(String(en.disruptionView({ ...data([]), rail: [{ ...strike, title: 'Κλειστός σταθμός' }] })), /class="notice notice-warn disruption-banner mb-3"[^]*Service disruption[^]*<span lang="el">Κλειστός σταθμός/);
    assert.match(String(en.disruptionView(data([]))), /<div class="notice notice-ok no-disruptions mb-3"><svg [^]*<\/svg><div class="notice-body">No service disruption announcements\.<\/div><\/div>/);
    // The English page doesn't read OASA's Greek feed
    assert.match(String(en.disruptionView(data([], ['stasy', 'oasaEn']))), /no-disruptions/);
    assert.equal(String(en.disruptionView(data([], ['oasaEl', 'oasaEn']))), '');
    assert.equal(String(en.disruptionView(data([], ['stasy', 'oasaEl']))), '');

    const el = await browserModule('public/js/core/announcements.js', 'el');
    assert.match(String(el.disruptionView(data([strike]))), /Διακοπή λειτουργίας[^]*Στάση εργασίας/);
    assert.match(String(el.disruptionView(data([plain]))), /Καμία ανακοίνωση διακοπής λειτουργίας\./);
    assert.equal(String(el.disruptionView(data([], ['stasy', 'oasaEn']))), '');
});
