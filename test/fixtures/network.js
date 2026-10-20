// A fake of OASA's live API, answering the calls the data build makes for the
// bus network (server/data/oasa-network.js), as OASA writes its answers:
//   - the 040 (code 938): `stops` stops there (route 3922), back (3923), and a
//     night variant there (3924, "[22:00-06:00]", fewer stops)
//   - the Α10: its own code (1020: both ways, both "[ΠΡΟΣΩΡΙΝΗ ΛΟΓΩ ΕΡΓΩΝ]")
//     and a short working's (1446: one route)
//   - the 830 (1648): circular, one route, with a stop whose code the live
//     times can't use ("-2"), and no English route name
//   - line 999: no routes today (OASA answers null)
// webGetStops answers in reverse, as only RouteStopOrder says the order.
//   oasa.request(act, p1)  → like server/oasa/client.js's request()
//   oasa.calls             → every [act, p1] asked
//   oasa.divert(n): the 040 is diverted, as OASA does it: new routes (6100
//     there, 6101 back) with n stops each, and no night variant
//   oasa.down(true|false), oasa.broken(true|false) (an error message instead of a list)
//   oasa.fail(act, p1, { times, message }): that request fails `times` times
//     (every time by default) with `message`, as the client reports it
export function fakeOasa({ stops = 1000 } = {}) {
    const size = stops;
    let isDown = false;
    let isBroken = false;
    const failing = new Map();
    const calls = [];
    const stop = (i, order) => ({
        StopCode: String(10000 + i), StopID: String(10000 + i), StopDescr: `ΣΤΑΣΗ  ${i}`, StopDescrEng: `STOP ${i}`,
        StopLat: (37.9 + i * 1e-4).toFixed(7), StopLng: '23.7000000', RouteStopOrder: String(order),
    });
    const along = codes => codes.map((i, n) => stop(i, n + 1)).reverse();
    const all = () => Array.from({ length: size }, (_, i) => i);
    const route = (RouteCode, LineCode, RouteType, RouteDescr, RouteDescrEng) => ({ RouteCode, LineCode, RouteType, RouteDescr, RouteDescrEng, RouteDistance: '1000' });

    const lines = [
        { LineCode: '938', LineID: '040', LineDescr: 'ΠΕΙΡΑΙΑΣ - ΣΥΝΤΑΓΜΑ', LineDescrEng: 'PEIRAIAS - SYNTAGMA' },
        { LineCode: '1020', LineID: 'Α10', LineDescr: 'ΣΤΑΘΜΟΣ ΛΑΡΙΣΗΣ - ΑΧΑΡΝΑΙ', LineDescrEng: 'ST. LARISIS - ACHARNAI' },
        { LineCode: '1446', LineID: 'Α10', LineDescr: 'ΣΤΑΘΜΟΣ ΛΑΡΙΣΗΣ - ΑΧΑΡΝΑΙ (ΑΠΟ ΣΤΑΣΗ ΚΑΡΑΒΟΣ)', LineDescrEng: 'ST. LARISIS - ACHARNAI (FROM KARABOS)' },
        { LineCode: '1648', LineID: '830', LineDescr: 'ΑΓ. ΒΑΡΒΑΡΑ - ΣΤ. ΚΟΡΥΔΑΛΛΟΣ (ΚΥΚΛΙΚΗ)', LineDescrEng: 'AG. VARVARA - ST. KORYDALLOS' },
        { LineCode: '999', LineID: '999', LineDescr: 'ΚΑΜΙΑ ΔΙΑΔΡΟΜΗ', LineDescrEng: 'NO ROUTE' },
    ];
    const routes = {
        938: [
            route('3922', '938', '1', 'ΠΕΙΡΑΙΑΣ - ΣΥΝΤΑΓΜΑ', 'PEIRAIAS - SYNTAGMA'),
            route('3923', '938', '2', 'ΣΥΝΤΑΓΜΑ - ΠΕΙΡΑΙΑΣ', 'SYNTAGMA - PEIRAIAS'),
            route('3924', '938', '1', 'ΠΕΙΡΑΙΑΣ - ΣΥΝΤΑΓΜΑ [22:00-06:00]', 'PEIRAIAS - SYNTAGMA [22:00-06:00]'),
        ],
        1020: [
            route('6051', '1020', '2', 'ΑΧΑΡΝΑΙ - ΣΤ. ΛΑΡΙΣΗΣ [ΠΡΟΣΩΡΙΝΗ ΛΟΓΩ ΕΡΓΩΝ]', 'ACHARNAI - ST. LARISIS [TEMPORARY DETOUR DUE TO ROADWORKS]'),
            route('6052', '1020', '1', 'ΣΤ. ΛΑΡΙΣΗΣ - ΑΧΑΡΝΑΙ [ΠΡΟΣΩΡΙΝΗ ΛΟΓΩ ΕΡΓΩΝ]', 'ST. LARISIS - ACHARNAI [TEMPORARY DETOUR DUE TO ROADWORKS]'),
        ],
        1446: [route('3690', '1446', '2', 'ΑΧΑΡΝΑΙ - ΣΤ. ΛΑΡΙΣΗΣ [ΑΠΟ ΣΤΑΣΗ ΚΑΡΑΒΟΣ]', 'ACHARNAI - ST. LARISIS [FROM KARABOS STOP]')],
        1648: [route('6038', '1648', '1', 'ΑΓ. ΒΑΡΒΑΡΑ - ΣΤ. ΚΟΡΥΔΑΛΛΟΣ', null)],
        999: null,
    };
    const routeStops = {
        3922: () => along(all()),
        3923: () => along(all().reverse()),
        3924: () => along([0, 2, size - 1]),
        6051: () => along([5, 6, 7]),
        6052: () => along([7, 6, 5]),
        3690: () => along([6, 7, 8]),
        6038: () => [...along([8, 9, 8]), { ...stop(9, 4), StopCode: '-2', StopDescr: 'ΓΡΑΜΜΑΤΙΚΟ' }],
    };

    return {
        calls,
        divert(n) {
            const range = Array.from({ length: n }, (_, i) => i);
            routes[938] = [route('6100', '938', '1', 'ΠΕΙΡΑΙΑΣ - ΣΥΝΤΑΓΜΑ [ΠΡΟΣΩΡΙΝΗ ΛΟΓΩ ΕΡΓΩΝ]', 'PEIRAIAS - SYNTAGMA [TEMPORARY]'), route('6101', '938', '2', 'ΣΥΝΤΑΓΜΑ - ΠΕΙΡΑΙΑΣ [ΠΡΟΣΩΡΙΝΗ ΛΟΓΩ ΕΡΓΩΝ]', 'SYNTAGMA - PEIRAIAS [TEMPORARY]')];
            routeStops[6100] = () => along(range);
            routeStops[6101] = () => along([...range].reverse());
        },
        down: (value = true) => { isDown = value; },
        broken: (value = true) => { isBroken = value; },
        fail: (act, p1, { times = Infinity, message = 'HTTP 502' } = {}) => { failing.set(`${act} ${p1}`, { times, message }); },
        async request(act, p1) {
            calls.push([act, p1]);
            if (isDown) throw new Error('fake OASA: down');
            const failure = failing.get(`${act} ${p1}`);
            if (failure?.times > 0) {
                failure.times--;
                throw new Error(failure.message);
            }
            if (isBroken && act === 'webGetStops') return { error: 'Something went wrong' };
            if (act === 'webGetLines') return lines;
            if (act === 'webGetRoutes') return routes[p1] === undefined ? null : routes[p1];
            if (act === 'webGetStops') return routeStops[p1]?.() ?? null;
            throw new Error(`fake OASA: no ${act}`);
        },
    };
}
