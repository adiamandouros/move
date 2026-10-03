// Date helpers for GTFS calendars. Dates are 'YYYYMMDD' strings throughout and
// all arithmetic is done in UTC so the server's timezone never matters.

export const DAY_NAMES = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

const WEEKDAY_COLUMNS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const MS_PER_DAY = 86_400_000;

function toUtc(yyyymmdd) {
    return Date.UTC(+yyyymmdd.slice(0, 4), +yyyymmdd.slice(4, 6) - 1, +yyyymmdd.slice(6, 8));
}

function fromUtc(ms) {
    return new Date(ms).toISOString().slice(0, 10).replaceAll('-', '');
}

export function weekday(yyyymmdd) {
    return new Date(toUtc(yyyymmdd)).getUTCDay();
}

export function isoDate(yyyymmdd) {
    return `${yyyymmdd.slice(0, 4)}-${yyyymmdd.slice(4, 6)}-${yyyymmdd.slice(6, 8)}`;
}

// Today's date in Athens as 'YYYYMMDD'.
export function athensToday(now = new Date()) {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Athens' }).format(now).replaceAll('-', '');
}

// 'HH:MM:SS' → seconds since midnight. GTFS allows hours ≥ 24 for trips that
// run past midnight; those are kept as-is (e.g. 25:03:00 → 90180).
export function toSeconds(hms) {
    const [h, m, s = '0'] = hms.split(':');
    return +h * 3600 + +m * 60 + +s;
}

// Expand calendar.txt + calendar_dates.txt into Map<date, Set<service_id>>.
export function serviceDates(calendar = [], calendarDates = []) {
    const map = new Map();
    const add = (date, svc) => { if (!map.has(date)) map.set(date, new Set()); map.get(date).add(svc); };

    for (const c of calendar) {
        for (let t = toUtc(c.start_date); t <= toUtc(c.end_date); t += MS_PER_DAY) {
            if (c[WEEKDAY_COLUMNS[new Date(t).getUTCDay()]] === '1') add(fromUtc(t), c.service_id);
        }
    }
    for (const cd of calendarDates) {
        if (cd.exception_type === '1') add(cd.date, cd.service_id);
        else if (cd.exception_type === '2') map.get(cd.date)?.delete(cd.service_id);
    }
    return map;
}

// Pick one representative date per weekday (index 0 = Sunday) so the app can
// show a weekly timetable even after the feed's calendar has expired.
//
// For each weekday, dates whose trip count is well below that weekday's median
// are treated as holidays and skipped. Among the rest, the next date on or
// after `today` wins; if the feed has expired, the latest one does.
export function pickWeek(dateServices, tripsPerService, today) {
    const byWeekday = Array.from({ length: 7 }, () => []);
    for (const [date, services] of dateServices) {
        let trips = 0;
        for (const s of services) trips += tripsPerService.get(s) ?? 0;
        if (trips > 0) byWeekday[weekday(date)].push({ date, trips });
    }

    return byWeekday.map((candidates, wd) => {
        if (!candidates.length) throw new Error(`Feed has no service on ${DAY_NAMES[wd]}`);
        const counts = candidates.map(c => c.trips).sort((a, b) => a - b);
        const median = counts[Math.floor(counts.length / 2)];
        const normal = candidates.filter(c => c.trips >= median * 0.85).map(c => c.date).sort();
        return normal.find(d => d >= today) ?? normal.at(-1);
    });
}
