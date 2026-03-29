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
            {
                id: 'M1_kifisia', 
                toward: 'Κηφισιά',
                stops: [
                    { name: 'Πειραιάς',         engName: 'Piraeus',             positions: ['back'] },
                    { name: 'Φάληρο',           engName: 'Faliro',              positions: ['center-back', 'center'] },
                    { name: 'Μοσχάτο',          engName: 'Moschato',            positions: [] },
                    { name: 'Καλλιθέα',         engName: 'Kallithea',           positions: [] },
                    { name: 'Ταύρος',           engName: 'Tavros',              positions: ['center'] },
                    { name: 'Πετράλωνα',        engName: 'Petralona',           positions: ['back'] },
                    { name: 'Θησείο',           engName: 'Thiseio',             positions: ['center'] },
                    { name: 'Μοναστηράκι',      engName: 'Monastiraki',         positions: ['back', 'center'], note: 'Αλλαγές M3 → Δημοτικό θέατρο: κέντρο | Αλλαγή M3 → Αεροδρόμιο: κέντρο' },
                    { name: 'Ομόνοια',          engName: 'Omonia',              positions: ['center-back', 'center-front'], note: 'Αλλαγές M2 → Ανθούπολη: πίσω/μπροστά | Αλλαγή M2 → Ελληνικό: πίσω/μπροστά' },
                    { name: 'Βικτώρια',         engName: 'Victoria',            positions: ['center'] },
                    { name: 'Αττική',           engName: 'Attiki',              positions: ['back', 'center', 'front'] },
                    { name: 'Άγιος Νικόλαος',   engName: 'Agios Nikolaos',      positions: ['back'] },
                    { name: 'Κάτω Πατήσια',     engName: 'Kato Patisia',        positions: ['center'] },
                    { name: 'Άγιος Ελευθέριος', engName: 'Agios Eleftherios',   positions: ['center-back', 'center'] },
                    { name: 'Άνω Πατήσια',      engName: 'Ano Patisia',         positions: ['center'] },
                    { name: 'Περισσός',         engName: 'Perissos',            positions: ['center'] },
                    { name: 'Πευκάκια',         engName: 'Pefkakia',            positions: ['center'] },
                    { name: 'Νέα Ιωνία',        engName: 'Nea Ionia',           positions: ['front'] },
                    { name: 'Ηράκλειο',         engName: 'Irakleio',            positions: ['center'] },
                    { name: 'Ειρήνη',           engName: 'Eirini',              positions: ['center-back', 'center-front'] },
                    { name: 'Νεραντζιώτισσα',   engName: 'Nerantziotissa',      positions: ['center-back', 'center'] },
                    { name: 'Μαρούσι',          engName: 'Marousi',             positions: ['center-front', 'center-back'] },
                    { name: 'ΚΑΤ',              engName: 'KAT',                 positions: ['back'] },
                    { name: 'Κηφισιά',          engName: 'Kifisia',             positions: ['front'] },
                ]
            },
            {
                id: 'M1_piraeus',
                toward: 'Πειραιάς',
                stops: [
                    { name: 'Κηφισιά',          engName: 'Kifisia',             positions: ['back'] },
                    { name: 'ΚΑΤ',              engName: 'KAT',                 positions: ['front'] },
                    { name: 'Μαρούσι',          engName: 'Marousi',             positions: ['center-back'] },
                    { name: 'Νεραντζιώτισσα',   engName: 'Nerantziotissa',      positions: ['center-back', 'center'] },
                    { name: 'Ειρήνη',           engName: 'Eirini',              positions: ['center-back', 'center-front'] },
                    { name: 'Ηράκλειο',         engName: 'Irakleio',            positions: ['center'] },
                    { name: 'Νέα Ιωνία',        engName: 'Nea Ionia',           positions: ['back'] },
                    { name: 'Πευκάκια',         engName: 'Pefkakia',            positions: ['center'] },
                    { name: 'Περισσός',         engName: 'Perissos',            positions: ['center'] },
                    { name: 'Άνω Πατήσια',      engName: 'Ano Patisia',         positions: ['center'] },
                    { name: 'Άγιος Ελευθέριος', engName: 'Agios Eleftherios',   positions: ['center'] },
                    { name: 'Κάτω Πατήσια',     engName: 'Kato Patisia',        positions: ['center'] },
                    { name: 'Άγιος Νικόλαος',   engName: 'Agios Nikolaos',      positions: ['center-back', 'center-front'] },
                    { name: 'Αττική',           engName: 'Attiki',              positions: ['center-back', 'center-front'] },
                    { name: 'Βικτώρια',         engName: 'Victoria',            positions: ['center'] },
                    { name: 'Ομόνοια',          engName: 'Omonia',              positions: ['center-back', 'center-front'], note: 'Αλλαγές M2 → Ανθούπολη: κέντρο | Αλλαγή M2 → Ελληνικό: κέντρο' },
                    { name: 'Μοναστηράκι',      engName: 'Monastiraki',         positions: ['center'], note: 'Αλλαγές M3 → Δημοτικό θέατρο: πίσω | Αλλαγή M3 → Αεροδρόμιο: πίσω' },
                    { name: 'Θησείο',           engName: 'Thiseio',             positions: [] },
                    { name: 'Πετράλωνα',        engName: 'Petralona',           positions: ['front'] },
                    { name: 'Ταύρος',           engName: 'Tavros',              positions: ['center'] },
                    { name: 'Καλλιθέα',         engName: 'Kallithea',           positions: [] },
                    { name: 'Μοσχάτο',          engName: 'Moschato',            positions: [] },
                    { name: 'Φάληρο',           engName: 'Faliro',              positions: [] },
                    { name: 'Πειραιάς',         engName: 'Piraeus',             positions: ['front'] },
                ]
            },
        ],
    },
    {
        id: 'M2',
        name: 'M2',
        color: '#cc0000',
        directions: [
            {
                id: 'M2_anthoupoli',
                toward: 'Ανθούπολη',
                stops: [
                    { name: 'Ελληνικό',         engName: 'Elliniko',        positions: ['back'] },
                    { name: 'Αργυρούπολη',      engName: 'Argiroupoli',     positions: ['center-front'] },
                    { name: 'Άλιμος',           engName: 'Alimos',          positions: ['center-front'] },
                    { name: 'Ηλιούπολη',        engName: 'Ilioupoli',       positions: ['center-front'] },
                    { name: 'Άγιος Δημήτριος',  engName: 'Agios Dimitrios', positions: ['center-back', 'center-front'] },
                    { name: 'Δάφνη',            engName: 'Dafni',           positions: ['center'] },
                    { name: 'Άγιος Ιωάννης',    engName: 'Agios Ioannis',   positions: ['center-front'] },
                    { name: 'Νέος Κόσμος',      engName: 'Neos Kosmos',     positions: ['center-front'] },
                    { name: 'Συγγρού Φιξ',      engName: 'Syggrou Fix',     positions: ['center-front'] },
                    { name: 'Ακρόπολη',         engName: 'Acropolis',       positions: ['center-front'] },
                    { name: 'Σύνταγμα',         engName: 'Syntagma',        positions: ['center-back'], note:['Αλλαγές M3 → Δημοτικό θέατρο: μπροστά | Αλλαγή M3 → Αεροδρόμιο: πίσω'] },
                    { name: 'Πανεπιστήμιο',     engName: 'Panepistimio',    positions: ['center'] },
                    { name: 'Ομόνοια',          engName: 'Omonia',          positions: [] },
                    { name: 'Μεταξουργείο',     engName: 'Metaxourghio',    positions: [] },
                    { name: 'Σταθμός Λαρίσσης', engName: 'Larissa Station', positions: ['center-front'] },
                    { name: 'Αττική',           engName: 'Attiki',          positions: ['center-back'], note:['Αλλαγές σε Μ1 → πίσω'] },
                    { name: 'Σεπόλια',          engName: 'Sepolia',         positions: ['center-front'] },
                    { name: 'Άγιος Αντώνιος',   engName: 'Agios Antonios',  positions: ['center'] },
                    { name: 'Περιστέρι',        engName: 'Peristeri',       positions: ['center-back'] },
                    { name: 'Ανθούπολη',        engName: 'Anthoupoli',      positions: ['center'] }
                ]
            },
            {
                id: 'M2_elliniko',
                toward: 'Ελληνικό',
                stops: [
                    { name: 'Ανθούπολη',        engName: 'Anthoupoli',      positions: [] },
                    { name: 'Περιστέρι',        engName: 'Peristeri',       positions: ['center-back'] },
                    { name: 'Άγιος Αντώνιος',   engName: 'Agios Antonios',  positions: ['center-back'] },
                    { name: 'Σεπόλια',          engName: 'Sepolia',         positions: ['center-front'] },
                    { name: 'Αττική',           engName: 'Attiki',          positions: ['center-back'], note:['Αλλαγές σε Μ1 → μπροστά'] },
                    { name: 'Σταθμός Λαρίσσης', engName: 'Larissa Station', positions: ['back'] },
                    { name: 'Μεταξουργείο',     engName: 'Metaxourghio',    positions: ['center-front'] },
                    { name: 'Ομόνοια',          engName: 'Omonia',          positions: [] },
                    { name: 'Πανεπιστήμιο',     engName: 'Panepistimio',    positions: ['center'] },
                    { name: 'Σύνταγμα',         engName: 'Syntagma',        positions: ['center-back'], note:['Αλλαγές M3 → Δημοτικό θέατρο: μπροστά | Αλλαγή M3 → Αεροδρόμιο: πίσω'] },
                    { name: 'Ακρόπολη',         engName: 'Acropolis',       positions: ['center-front'] },
                    { name: 'Συγγρού Φιξ',      engName: 'Syggrou Fix',     positions: ['center-front'] },
                    { name: 'Νέος Κόσμος',      engName: 'Neos Kosmos',     positions: ['center-front'] },
                    { name: 'Άγιος Ιωάννης',    engName: 'Agios Ioannis',   positions: ['center-front'] },
                    { name: 'Δάφνη',            engName: 'Dafni',           positions: ['center'] },
                    { name: 'Άγιος Δημήτριος',  engName: 'Agios Dimitrios', positions: ['center-back', 'center-front'] },
                    { name: 'Ηλιούπολη',        engName: 'Ilioupoli',       positions: ['center-front'] },
                    { name: 'Άλιμος',           engName: 'Alimos',          positions: ['center-front'] },
                    { name: 'Αργυρούπολη',      engName: 'Argiroupoli',     positions: ['center-front'] },
                    { name: 'Ελληνικό',         engName: 'Elliniko',        positions: ['back'] }
                ]
            },
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
                    { name: 'Αεροδρόμιο',           engName: 'Airport',                 positions: [] },
                    { name: 'Κορωπί',               engName: 'Koropi',                  positions: [] },
                    { name: 'Παιανία-Κάντζα',       engName: 'Paiania-Kantza',          positions: [] },
                    { name: 'Παλλήνη',              engName: 'Pallini',                 positions: [] },
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
                    { name: 'Δημοτικό Θέατρο',      engName: 'Dimotiko Theatro',        positions: ['back', 'front'] }
                ],
            },
            {
                id: 'M3_doukissis',
                toward: 'Δουκίσσης / Αεροδρόμιο',
                stops: [
                    { name: 'Δημοτικό Θέατρο',      engName: 'Dimotiko Theatro',        positions: ['back', 'front'] },
                    { name: 'Πειραιάς',             engName: 'Piraeus',                 positions: ['front', 'back'] },
                    { name: 'Μανιάτικα',            engName: 'Maniatika',               positions: ['center-back'] },
                    { name: 'Νίκαια',               engName: 'Nikaia',                  positions: ['center-back', 'center'] },
                    { name: 'Κορυδαλλός',           engName: 'Korydallos',              positions: ['center-front'] },
                    { name: 'Αγία Βαρβάρα',         engName: 'Agia Varvara',            positions: ['center-back', 'center'] },
                    { name: 'Αγία Μαρίνα',          engName: 'Agia Marina',             positions: ['center'] },
                    { name: 'Αιγάλεω',              engName: 'Aigaleo',                 positions: ['center-back', 'front'] },
                    { name: 'Ελαιώνας',             engName: 'Elaionas',                positions: ['center-back', 'front'] },
                    { name: 'Κεραμεικός',           engName: 'Kerameikos',              positions: ['center-back', 'front'] },
                    { name: 'Μοναστηράκι',          engName: 'Monastiraki',             positions: ['center-back'],   note: 'Κόμβος αλλαγών M1/M2/M3' },
                    { name: 'Σύνταγμα',             engName: 'Syntagma',                positions: ['back', 'front'], note: 'Αλλαγή M2 → Ανθούπολη: κέντρο | Αλλαγή M2 → Ελληνικό: μπροστά' },
                    { name: 'Ευαγγελισμός',         engName: 'Evangelismos',            positions: ['center-back'] },
                    { name: 'Μέγαρο Μουσικής',      engName: 'Megaro Mousikis',         positions: ['center-front'] },
                    { name: 'Αμπελόκηποι',          engName: 'Ampelokipoi',             positions: ['center-front'] },
                    { name: 'Πανόρμου',             engName: 'Panormou',                positions: ['center-front'] },
                    { name: 'Κατεχάκη',             engName: 'Katechaki',               positions: ['center'] },
                    { name: 'Εθνική Άμυνα',         engName: 'Ethniki Amyna',           positions: ['center'] },
                    { name: 'Χολαργός',             engName: 'Cholargos',               positions: ['center-back'] },
                    { name: 'Νομισματοκοπείο',      engName: 'Nomismatokopio',          positions: ['center-back'] },
                    { name: 'Αγία Παρασκευή',       engName: 'Agia Paraskevi',          positions: ['center-back'] },
                    { name: 'Χαλάνδρι',             engName: 'Chalandri',               positions: ['center-back'] },
                    { name: 'Δουκίσσης Πλακεντίας', engName: 'Doukissis Plakentias',    positions: ['center-back'] },
                    { name: 'Παλλήνη',              engName: 'Pallini',                 positions: [] },
                    { name: 'Παιανία-Κάντζα',       engName: 'Paiania-Kantza',          positions: [] },
                    { name: 'Κορωπί',               engName: 'Κορωπί',                  positions: [] },
                    { name: 'Αεροδρόμιο',           engName: 'Airport',                 positions: [] },
                ],
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
