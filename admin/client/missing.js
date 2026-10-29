// What a platform still needs recorded, for the station editor: the station
// list marks it after each name, the form lists it above the fields.
// `entry`: the platform's entry, as positions.json has it.

// A platform reached by a ramp or on the level needs no elevator (a surface
// station's), so not knowing whether it has one isn't missing
const NO_ELEVATOR_NEEDED = ['ramp', 'level'];

/** @returns {string[]} */
export function missing(entry) {
    const elevators = entry.elevators;
    return [
        !entry.exits?.length && 'exits',
        elevators !== 'none' && !elevators?.length && !NO_ELEVATOR_NEEDED.includes(entry.stepFree) && 'elevators',
        // (an elevator from before they had names is a plain position)
        Array.isArray(elevators) && elevators.some(lift => !lift?.name) && 'elevator names',
    ].filter(Boolean);
}

// What a station still needs recorded, from whichever line and direction it's
// seen: `street` its entry in street.json, `stasy` STASY's names for its lifts,
// `platforms` the entries of all its platforms
/** @returns {string[]} */
export function missingAtStation(street, stasy, platforms) {
    const exits = street?.exits ?? [];
    const lifts = street?.lifts ?? [];
    return [
        !exits.length && 'street exits',
        exits.some(exit => !exit.name?.el || !exit.coords || !exit.way?.length) && 'exit details',
        lifts.some(lift => !lift.name) && 'elevator names',
        lifts.some(lift => !lift.coords) && 'elevator locations',
        unplaced(stasy, lifts, platforms).length > 0 && 'unplaced elevators',
    ].filter(Boolean);
}

// STASY's lifts at a station that aren't recorded yet, on any of its
// platforms or on the street; a name STASY gives two lifts needs two
export function unplaced(stasy, lifts, platforms) {
    const count = (names, name) => names.filter(n => n === name).length;
    const named = list => Array.isArray(list) ? list.map(lift => lift?.name) : [];
    const recorded = name => Math.max(count(named(lifts), name), ...platforms.map(p => count(named(p.elevators), name)));
    const seen = new Map();
    return stasy.filter(name => {
        seen.set(name, (seen.get(name) ?? 0) + 1);
        return seen.get(name) > recorded(name);
    });
}
