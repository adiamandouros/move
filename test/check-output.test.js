import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import { checkOutput, shrinkage } from '../server/data/check-output.js';

// The checks a build's files pass before the site serves them
// (server/data/check-output.js). The browser tests' copies of the real files
// are the reference: they must pass, and breaking any one thing must not.

const real = name => JSON.parse(readFileSync(new URL(`./browser/data/${name}`, import.meta.url), 'utf8'));
const rail = () => real('rail.json');
const bus = () => real('bus-stops.json');

test('the real rail.json and bus-stops.json pass', () => {
    assert.deepEqual(checkOutput('rail.json', rail()), []);
    assert.deepEqual(checkOutput('bus-stops.json', bus()), []);
});

const broken = {
    'rail.json': [
        ['no schema', r => { delete r.schema; }, /no schema number/],
        ['dates the wrong way round', r => { r.feed.validFrom = '2027-01-01'; }, /validFrom 2027-01-01 is after validTo/],
        ['a weekday missing from the week', r => { delete r.feed.week.sat; }, /feed\.week\.sat/],
        ['other positions', r => { r.positions = ['front', 'back']; }, /positions must be/],
        ['no stations', r => { r.stations = {}; }, /no stations/],
        ['a station without its Greek name', r => { r.stations.syntagma.name.el = ''; }, /station syntagma: needs a name/],
        ['a station at 0,0', r => { r.stations.syntagma.coords = [0, 0]; }, /station syntagma: coordinates \[0,0\] aren't in Attica/],
        ['a station on an unknown line', r => { r.stations.syntagma.lines.push('M9'); }, /station syntagma: unknown line M9/],
        ['a line without a colour', r => { r.lines.M1.color = 'green'; }, /line M1: needs a name and a #rgb or #rrggbb colour/],
        ['a stop at an unknown station', r => { Object.values(r.lines.M2.directions)[0].stops[0].station = 'nowhere'; }, /unknown station nowhere/],
        ['an unknown exit position', r => { Object.values(r.lines.M2.directions)[0].stops[0].exits = ['middle']; }, /unknown position middle/],
        ['a week of six days', r => { Object.values(r.lines.M3.directions)[0].timetable.days.pop(); }, /a pattern for each of the 7 days/],
        ['a profile pointing past the last stop', r => { Object.values(r.lines.M1.directions)[0].timetable.profiles[0].stops[0] = 999; }, /points at a stop that doesn't exist/],
        ['a profile going back in time', r => { Object.values(r.lines.M1.directions)[0].timetable.profiles[0].offsets.reverse(); }, /goes back in time/],
        ['no trips at all', r => { const t = Object.values(r.lines.M1.directions)[0].timetable; t.patterns = t.patterns.map(() => []); }, /no trips on any day/],
    ],
    'bus-stops.json': [
        ['other fields', b => { b.fields = ['code', 'lat', 'lng']; }, /fields must be/],
        ['no stops', b => { b.stops = []; }, /no stops/],
        ['a code the live times can\'t use', b => { b.stops[0][0] = '-2'; }, /the code must be numeric/],
        ['a stop listed twice', b => { b.stops.push([...b.stops[0]]); }, /listed twice/],
        ['a stop outside Attica', b => { b.stops[0][1] = 40.6; }, /aren't in Attica/],
        ['a stop without its Greek name', b => { b.stops[0][3] = ''; }, /no Greek name/],
        ['a stop without lines', b => { b.stops[0][5] = []; }, /needs its line numbers/],
    ],
};
for (const [name, cases] of Object.entries(broken)) {
    for (const [what, breakIt, expected] of cases) {
        test(`${name} fails with ${what}`, () => {
            const data = name === 'rail.json' ? rail() : bus();
            breakIt(data);
            const problems = checkOutput(name, data);
            assert.ok(problems.some(p => expected.test(p)), `${expected} in ${JSON.stringify(problems)}`);
        });
    }
}

test('a short colour is fine, as in CSS', () => {
    const r = rail();
    r.lines.M1.color = '#0a0';
    assert.deepEqual(checkOutput('rail.json', r), []);
});

test('at most ten problems are listed, then how many more', () => {
    const b = bus();
    for (const row of b.stops) row[3] = '';
    const problems = checkOutput('bus-stops.json', b);
    assert.equal(problems.length, 11);
    assert.match(problems[10], new RegExp(`… and ${b.stops.length - 10} more`));
});

test('a file with under 80% of the last good one\'s stations or stops is held back', () => {
    const before = bus();
    const after = bus();
    after.stops = after.stops.slice(0, Math.floor(before.stops.length * 0.79));
    assert.match(shrinkage('bus-stops.json', after, before)[0], /has \d+ stops, the last good build had \d+; if that's right, rebuild with --force/);
    after.stops = bus().stops.slice(0, Math.ceil(before.stops.length * 0.8));
    assert.deepEqual(shrinkage('bus-stops.json', after, before), []);

    const smaller = rail();
    for (const id of Object.keys(smaller.stations).slice(0, 20)) delete smaller.stations[id];
    assert.match(shrinkage('rail.json', smaller, rail())[0], /has 46 stations, the last good build had 66/);
    // No previous build: nothing to compare with
    assert.deepEqual(shrinkage('rail.json', smaller, null), []);
});
