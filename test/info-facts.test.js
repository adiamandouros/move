import { test } from 'node:test';
import assert from 'node:assert/strict';
import { safeUrl } from '../public/js/core/html.js';
import { factsChecks, FACTS_MAX_AGE_DAYS } from '../server/diagnostics.js';
import { renderPages } from '../server/pages/index.js';
import { checkedFacts, loadTools } from '../server/pages/registry.js';

// Facts written on the pages by hand (the Info page's closing times, prices,
// airport and night buses), and when they were last checked: the dates are in
// tools/info/data.json, shown on the page, and /admin/diagnostics warns when
// they're old (so does the nightly live check, test/live/)

const tools = loadTools();
const info = tools.find(t => t.id === 'info');

test('each section of the Info page says when it was checked, and where', () => {
    const sections = Object.entries(info.data.checked);
    assert.deepEqual(sections.map(([name]) => name), ['hours', 'tickets', 'airport', 'night']);
    for (const [name, { date, sources }] of sections) {
        assert.match(date, /^\d{4}-\d\d-\d\d$/, name);
        assert.ok(Date.parse(date) <= Date.now(), `${name}: ${date} is in the future`);
        assert.ok(sources.length, name);
        for (const source of sources) assert.ok(source.name && safeUrl(source.url), `${name}: ${JSON.stringify(source)}`);
    }
});

test('the dates on the page come from data.json, in both languages', () => {
    const { pages } = renderPages(tools);
    assert.match(pages['/info'], /Checked on 14\/10\/2026 at <a href="https:\/\/www\.stasy\.gr\/en\/timetables\/"/);
    assert.match(pages['/el/info'], /Ελέγχθηκε στις 14\/10\/2026 στο <a href/);
    assert.equal((pages['/info'].match(/<p class="info-source">Checked on/g) ?? []).length, 4);
    // A new date shows where its section is
    const changed = tools.map(t => t.id === 'info' ? { ...t, data: { ...t.data, checked: { ...t.data.checked, night: { ...t.data.checked.night, date: '2027-01-05' } } } } : t);
    assert.match(renderPages(changed).pages['/info'], /Checked on 05\/01\/2027 at <a href="https:\/\/www\.osy\.gr\/"/);
});

test('diagnostics name each section, and warn once it\'s over 90 days old', () => {
    const facts = checkedFacts(tools);
    assert.deepEqual(facts.map(f => f.what), ['Info: Closing times', 'Info: Tickets', 'Info: Getting to the airport', 'Info: Night buses']);
    assert.equal(FACTS_MAX_AGE_DAYS, 90);
    const at = date => () => Date.parse(date);
    const [fresh] = factsChecks([{ what: 'Info: Tickets', date: '2026-10-14' }], at('2027-01-12T12:00:00Z'));
    assert.deepEqual([fresh.status, fresh.detail], ['ok', 'Checked on 2026-10-14 (90 days ago)']);
    const [old] = factsChecks([{ what: 'Info: Tickets', date: '2026-10-14' }], at('2027-01-13T12:00:00Z'));
    assert.deepEqual([old.group, old.title, old.status, old.detail], ['Facts checked by hand', 'Info: Tickets', 'warn', 'Last checked on 2026-10-14, 91 days ago']);
    assert.match(old.hint, /tools\/<id>\/data\.json/);
});
