// ── Position constants ──────────────────────────────────────────────────────
// "front"        = μπροστά (absolute front of train)
// "center-front" = κέντρο-μπροστά
// "center"       = κέντρο
// "center-back"  = κέντρο-πίσω
// "back"         = πίσω (absolute back of train)
//
// Each stop has:
//   name      {string}   Stop name (Greek)
//   positions {string[]} Where to stand — one or more of the constants above
//   note      {string?}  Optional extra info (transfers, multiple exits, etc.)

export const lines = [
    {
        id: 'M1',
        name: 'M1',
        color: '#4caf50',
        directions: [
            { id: 'M1_kifisia',  toward: 'Κηφισιά', stops: [] },
            { id: 'M1_piraeus',  toward: 'Πειραιάς', stops: [] },
        ],
    },
    {
        id: 'M2',
        name: 'M2',
        color: '#cc0000',
        directions: [
            { id: 'M2_anthoupoli', toward: 'Ανθούπολη', stops: [] },
            { id: 'M2_elliniko',   toward: 'Ελληνικό',  stops: [] },
        ],
    },
    {
        id: 'M3',
        name: 'M3',
        color: '#0057b8',
        directions: [
            {
                id: 'M3_dimotiko',
                toward: 'Δημοτικό Θέατρο',
                stops: [
                    { name: 'Δουκίσσης Πλακεντίας', positions: ['back'] },
                    { name: 'Χαλάνδρι',              positions: ['back'] },
                    { name: 'Αγία Παρασκευή',         positions: ['back'] },
                    { name: 'Νομισματοκοπείο',        positions: ['center-back'] },
                    { name: 'Χολαργός',               positions: ['back'] },
                    { name: 'Εθνική Άμυνα',           positions: ['center'] },
                    { name: 'Κατεχάκη',               positions: ['center'] },
                    { name: 'Πανόρμου',               positions: ['front'] },
                    { name: 'Αμπελόκηποι',            positions: ['front'] },
                    { name: 'Μέγαρο Μουσικής',        positions: ['front'] },
                    { name: 'Ευαγγελισμός',           positions: ['back'] },
                    { name: 'Σύνταγμα',               positions: ['back', 'front'], note: 'Αλλαγή M2 → Ανθούπολη: κέντρο | Αλλαγή M2 → Ελληνικό: μπροστά' },
                    { name: 'Μοναστηράκι',            positions: ['center-back'],   note: 'Κόμβος αλλαγών M1/M2/M3' },
                    { name: 'Κεραμεικός',             positions: ['back', 'front'] },
                    { name: 'Ελαιώνας',               positions: ['back', 'front'] },
                    { name: 'Αιγάλεω',                positions: ['back', 'front'] },
                    { name: 'Αγία Μαρίνα',            positions: ['center'] },
                    { name: 'Αγία Βαρβάρα',           positions: ['back', 'center'] },
                    { name: 'Κορυδαλλός',             positions: ['front'] },
                    { name: 'Νίκαια',                 positions: ['back', 'center'] },
                    { name: 'Μανιάτικα',              positions: ['back'] },
                    { name: 'Πειραιάς',               positions: ['front', 'back'] },
                    { name: 'Δημοτικό Θέατρο',        positions: ['back', 'front'] },
                ],
            },
            {
                id: 'M3_doukissis',
                toward: 'Δουκίσσης / Αεροδρόμιο',
                stops: [],
            },
        ],
    },
];

// Flat lookup: stopName (lowercase) → array of { line, direction, stop }
// Used for search across all lines/directions
export const stopIndex = (() => {
    const index = new Map();
    for (const line of lines) {
        for (const direction of line.directions) {
            for (const stop of direction.stops) {
                const key = stop.name.toLowerCase();
                if (!index.has(key)) index.set(key, []);
                index.get(key).push({ line, direction, stop });
            }
        }
    }
    return index;
})();

// All unique stop names (for search autocomplete)
export const allStopNames = [...new Set(
    lines.flatMap(l => l.directions.flatMap(d => d.stops.map(s => s.name)))
)].sort((a, b) => a.localeCompare(b, 'el'));
