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
