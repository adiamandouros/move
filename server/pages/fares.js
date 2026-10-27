// The Info page's ticket and pass prices (tools/info/page.hbs), from the info
// tool's data.json "fares", so each price is typed once: the tables, the text
// and how many trips make a pass pay off all come from there.
//   single, day, fiveDays, tourist   { price, reduced? }   one ticket
//   packs     [{ trips, price, reduced }]                  packs of 90-minute tickets
//   passes    [{ days, price, reduced, withAirport }]      the same pass including the airport
// becomes, for the page in `lang`:
//   single, day, fiveDays, tourist   { price: '€1.20', reduced: '€0.50' | '–' }
//   packs     { price: '€2.30 / €5.70 / €12.00', reduced: '€1.00 / …' }
//   passes    [{ days, price, reduced, trips, reducedTrips }]
//   withAirport  '€45 / €129 / …'
// trips: how many 90-minute tickets (or bank card taps) cost at least as much
// as the pass, at the full and the reduced fare: from there, the pass pays off.

/** A price as each language writes it: €1.20, €1,20; `cents` false drops ".00" */
export function euro(amount, lang, cents = true) {
    const text = cents || !Number.isInteger(amount) ? amount.toFixed(2) : String(amount);
    return `€${lang === 'el' ? text.replace('.', ',') : text}`;
}

// The fewest trips at `fare` that cost at least `price` (in cents, so 27 / 1.20 isn't 22.4999…)
export function tripsFor(price, fare) {
    return Math.ceil(Math.round(price * 100) / Math.round(fare * 100));
}

/** @param {Record<string, any>} fares data.json "fares" @param {string} lang */
export function fares(fares, lang) {
    const one = ({ price, reduced }) => ({ price: euro(price, lang), reduced: reduced === undefined ? '–' : euro(reduced, lang) });
    const list = (items, key, cents = true) => items.map(item => euro(item[key], lang, cents)).join(' / ');
    const { single } = fares;
    return {
        single: one(single),
        day: one(fares.day),
        fiveDays: one(fares.fiveDays),
        tourist: one(fares.tourist),
        packs: { price: list(fares.packs, 'price'), reduced: list(fares.packs, 'reduced') },
        passes: fares.passes.map(pass => ({
            days: pass.days,
            price: euro(pass.price, lang),
            reduced: euro(pass.reduced, lang),
            trips: tripsFor(pass.price, single.price),
            reducedTrips: tripsFor(pass.reduced, single.reduced),
        })),
        withAirport: list(fares.passes, 'withAirport', false),
    };
}
