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
                    { name: 'Δουκίσσης Πλακεντίας', engName: 'Doukissis Plakentias',    positions: ['center-back'] },
                    { name: 'Χαλάνδρι',             engName: 'Chalandri',               positions: ['center-back'] },
                    { name: 'Αγία Παρασκευή',       engName: 'Agia Paraskevi',          positions: ['center-back'] },
                    { name: 'Νομισματοκοπείο',      engName: 'Nomismatokopio',          positions: ['center-back'] },
                    { name: 'Χολαργός',             engName: 'Cholargos',               positions: ['center-back'] },
                    { name: 'Εθνική Άμυνα',         engName: 'Ethniki Amyna',           positions: ['center'] },
                    { name: 'Κατεχάκη',             engName: 'Katechaki',               positions: ['center'] },
                    { name: 'Πανόρμου',             engName: 'Panormou',                positions: ['center-front'] },
                    { name: 'Αμπελόκηποι',          engName: 'Ampelokipoi',             positions: ['center-front'] },
                    { name: 'Μέγαρο Μουσικής',      engName: 'Megaro Mousikis',         positions: ['center-front'] },
                    { name: 'Ευαγγελισμός',         engName: 'Evangelismos',            positions: ['center-back'] },
                    { name: 'Σύνταγμα',             engName: 'Syntagma',                positions: ['back', 'front'], note: 'Αλλαγή M2 → Ανθούπολη: κέντρο | Αλλαγή M2 → Ελληνικό: μπροστά' },
                    { name: 'Μοναστηράκι',          engName: 'Monastiraki',             positions: ['center-back'],   note: 'Κόμβος αλλαγών M1/M2/M3' },
                    { name: 'Κεραμεικός',           engName: 'Kerameikos',              positions: ['center-back', 'front'] },
                    { name: 'Ελαιώνας',             engName: 'Elaionas',                positions: ['center-back', 'front'] },
                    { name: 'Αιγάλεω',              engName: 'Aigaleo',                 positions: ['center-back', 'front'] },
                    { name: 'Αγία Μαρίνα',          engName: 'Agia Marina',             positions: ['center'] },
                    { name: 'Αγία Βαρβάρα',         engName: 'Agia Varvara',            positions: ['center-back', 'center'] },
                    { name: 'Κορυδαλλός',           engName: 'Korydallos',              positions: ['center-front'] },
                    { name: 'Νίκαια',               engName: 'Nikaia',                  positions: ['center-back', 'center'] },
                    { name: 'Μανιάτικα',            engName: 'Maniatika',               positions: ['center-back'] },
                    { name: 'Πειραιάς',             engName: 'Piraeus',                 positions: ['front', 'back'] },
                    { name: 'Δημοτικό Θέατρο',      engName: 'Dimotiko Theatro',        positions: ['back', 'front'] },
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

// Flat lookup: Greek or English stop name (lowercase) → array of { line, direction, stop }
export const stopIndex = (() => {
    const index = new Map();
    for (const line of lines) {
        for (const direction of line.directions) {
            for (const stop of direction.stops) {
                for (const key of [stop.name, stop.engName].filter(Boolean).map(n => n.toLowerCase())) {
                    if (!index.has(key)) index.set(key, []);
                    index.get(key).push({ line, direction, stop });
                }
            }
        }
    }
    return index;
})();

// All unique stops as { name, engName } objects (for autocomplete)
export const allStops = [...new Map(
    lines.flatMap(l => l.directions.flatMap(d =>
        d.stops.map(s => [s.name, { name: s.name, engName: s.engName }])
    ))
).values()].sort((a, b) => a.name.localeCompare(b.name, 'el'));
