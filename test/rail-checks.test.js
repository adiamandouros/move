import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkRail, readFrequencies } from '../server/data/rail-checks.js';
import { rail as fixture } from './fixtures/rail.js';

// The station-page network (test/fixtures/rail.js): L1 a → x → b and back,
// every 30 minutes, without STASY's times; L2 x → c hourly, with STASY's,
// all night from Saturday into Sunday
const H = 3600;
const rail = () => structuredClone(fixture);

test('problems: stops trains leave from without STASY\'s first and last trains, on a line STASY has or not', () => {
    assert.deepEqual(checkRail(rail()).problems, ['L1: no first and last trains from STASY at any stop, so its depot runs aren\'t left out']);
    const r = rail();
    const everyDay = Array(7).fill(6 * H);
    r.lines.L1.directions.east.stops[0].hours = [{ to: 'b', first: everyDay, last: everyDay }];
    assert.deepEqual(checkRail(r).problems, [
        'L1/east: no first and last trains from STASY at Cross, so depot runs aren\'t left out there',
        'L1/west: no first and last trains from STASY at Beta, Cross, so depot runs aren\'t left out there',
    ]);
    // Without STASY's copy at all, nothing to say (its own health check says why)
    delete r.hours;
    assert.deepEqual(checkRail(r).problems, []);
});

test('notes: a first or last train over 5 minutes off STASY\'s means the GTFS misses trains', () => {
    const r = rail();
    assert.deepEqual(checkRail(r).notes, []);
    // STASY's last train from Cross is 01:00 except on Saturdays (all night); the timetable's is 00:00
    const [hours] = r.lines.L2.directions.east.stops[0].hours;
    hours.last = hours.last.map(t => t === null ? null : 25 * H);
    hours.first = hours.first.map(t => t === null ? null : 5 * H + 240);
    assert.deepEqual(checkRail(r).notes, ['L2/east: the last train to Gamma from Cross is 00:00 in the GTFS, 01:00 in STASY\'s table (sun, mon, tue, wed, thu, fri): the GTFS misses trains']);
    // No trains at all where STASY has some
    r.lines.L2.directions.east.timetable.patterns = [[], []];
    assert.match(checkRail(r).notes.join('\n'), /the first train to Gamma from Cross is none in the GTFS, 05:04 in STASY's table \(mon, tue, wed, thu, fri, sat\)/);
});

test('readFrequencies: STASY\'s periods, hours and gaps, after midnight too', () => {
    assert.deepEqual(readFrequencies([
        ['ΠΕΡΙΟΔΟΣ', 'ΩΡΑ', 'ΣΥΧΝΟΤΗΤΑ ΔΙΕΛΕΥΣΗΣ'],
        ['ΔΕΥΤΕΡΑ - ΠΑΡΑΣΚΕΥΗ', '05:00 - 05:30', '15\' 00"'],
        ['', '23:30 - 01:30', '15\''],
        ['Σάββατο', '22:00 - 00:20', '9′ 00″'],
        ['', '00:20 - 05:30', '15′', '36\''],
    ]), [
        { days: [1, 2, 3, 4, 5], from: 5 * H, to: 5.5 * H, every: 900 },
        { days: [1, 2, 3, 4, 5], from: 23.5 * H, to: 25.5 * H, every: 900 },
        { days: [6], from: 22 * H, to: 24 * H + 1200, every: 540 },
        // That night's, after midnight
        { days: [6], from: 24 * H + 1200, to: 29.5 * H, every: 900 },
    ]);
    assert.throws(() => readFrequencies([['Γιορτές', '05:00 - 06:00', '15\'']]), /unknown days "Γιορτές"/);
    assert.throws(() => readFrequencies([['Δευτέρα', '05:00 - 06:00', 'συχνά']]), /unknown frequency "συχνά"/);
    assert.throws(() => readFrequencies([['ΗΜΕΡΑ', 'ΩΡΑ']]), /no rows with hours/);
});

test('notes: how often trains run, against STASY\'s table, where most trains call', () => {
    // L1 runs every 30 minutes: STASY says 20 on weekdays, 30 at weekends
    const frequencies = { L1: [['ΔΕΥΤΕΡΑ - ΠΑΡΑΣΚΕΥΗ', '06:00 - 10:00', '20\' 00"'], ['', '10:00 - 10:30', '5\''], ['ΣΑΒΒΑΤΟ - ΚΥΡΙΑΚΗ', '06:00 - 10:00', '31\' 00"']] };
    assert.deepEqual(checkRail(rail(), { frequencies }).notes, [
        'L1 toward Beta, mon, tue, wed, thu, fri 06:00–10:00: a train every 30\'00" in the GTFS, 20\'00" in STASY\'s table (at Cross)',
        'L1 toward Alpha, mon, tue, wed, thu, fri 06:00–10:00: a train every 30\'00" in the GTFS, 20\'00" in STASY\'s table (at Cross)',
    ]);
    // A table that can't be read is said, not compared; lines the timetable doesn't have are left alone
    assert.deepEqual(checkRail(rail(), { frequencies: { L1: [['Γιορτές', '06:00 - 10:00', '5\'']], M7: frequencies.L1 } }).notes,
        ['L1: STASY\'s frequency table couldn\'t be read (unknown days "Γιορτές"), so it isn\'t compared']);
});

test('notes: the dates with trains of their own, and the build\'s', () => {
    const r = rail();
    r.lines.L2.directions.east.timetable.dates = { '2026-10-28': 0 };
    r.lines.L1.directions.west.timetable.dates = { '2026-10-28': 0, '2026-12-25': 0 };
    assert.deepEqual(checkRail(r, { notes: ['from the build'] }).notes, [
        '2026-10-28: L1, L2 run trains of their own that day (a holiday?), from the GTFS',
        '2026-12-25: L1 runs trains of their own that day (a holiday?), from the GTFS',
        'from the build',
    ]);
});
