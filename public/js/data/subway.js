// ── Position constants ──────────────────────────────────────────────────────
// "front"        = μπροστά (absolute front of train)
// "center-front" = κέντρο-μπροστά
// "center"       = κέντρο
// "center-back"  = κέντρο-πίσω
// "back"         = πίσω (absolute back of train)
//
// Each stop has:
//   name      {string}    Stop name (Greek)
//   engName   {string}    Stop name (English)
//   positions {string[]}  Where to stand to EXIT this stop
//   note      {string?}   Optional free-text info
//   transfers {object[]?} Where to stand to TRANSFER to another line/direction
//     Each transfer entry:
//       lineId    {string}   e.g. 'M1', 'M2', 'M3'
//       toward    {string}   Matches direction.toward exactly
//       positions {string[]} Where to stand on THIS train to reach that platform

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
                    { name: 'Πειραιάς',         engName: 'Piraeus',             positions: ['back'], transfers: [
                        {lineId: 'M3', toward: 'Δημοτικό Θέατρο',       positions: ['back']},
                        {lineId: 'M3', toward: 'Δουκίσσης / Αεροδρόμιο', positions: ['back']}
                    ] },
                    { name: 'Φάληρο',           engName: 'Faliro',              positions: ['center-back', 'center'] },
                    { name: 'Μοσχάτο',          engName: 'Moschato',            positions: [] },
                    { name: 'Καλλιθέα',         engName: 'Kallithea',           positions: [] },
                    { name: 'Ταύρος',           engName: 'Tavros',              positions: ['center'] },
                    { name: 'Πετράλωνα',        engName: 'Petralona',           positions: ['back'] },
                    { name: 'Θησείο',           engName: 'Thiseio',             positions: ['center'] },
                    { name: 'Μοναστηράκι',      engName: 'Monastiraki',         positions: ['back', 'center'], transfers: [
                        {lineId: 'M3', toward: 'Δημοτικό Θέατρο',       positions: ['center']},
                        {lineId: 'M3', toward: 'Δουκίσσης / Αεροδρόμιο', positions: ['center']}
                    ], note: 'Αλλαγές M3 → Δημοτικό θέατρο: κέντρο | Αλλαγή M3 → Αεροδρόμιο: κέντρο' },
                    { name: 'Ομόνοια',          engName: 'Omonia',              positions: ['center-back', 'center-front'], transfers: [
                        {lineId: 'M2', toward: 'Ανθούπολη', positions: ['center-back', 'center-front']},
                        {lineId: 'M2', toward: 'Ελληνικό', positions: ['center-front', 'center-front']}
                    ], note: 'Αλλαγές M2 → Ανθούπολη: πίσω/μπροστά | Αλλαγή M2 → Ελληνικό: πίσω/μπροστά' },
                    { name: 'Βικτώρια',         engName: 'Victoria',            positions: ['center'] },
                    { name: 'Αττική',           engName: 'Attiki',              positions: ['back', 'center', 'front'], transfers: [] },
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
                    { name: 'Αττική',           engName: 'Attiki',              positions: ['center-back', 'center-front'], transfers: [] },
                    { name: 'Βικτώρια',         engName: 'Victoria',            positions: ['center'] },
                    { name: 'Ομόνοια',          engName: 'Omonia',              positions: ['center-back', 'center-front'], transfers: [
                        {lineId: 'M2', toward: 'Ανθούπολη', positions: ['center']},
                        {lineId: 'M2', toward: 'Ελληνικό', positions: ['center']}
                    ]},
                    { name: 'Μοναστηράκι',      engName: 'Monastiraki',         positions: ['center'], transfers: [
                        {lineId: 'M3', toward: 'Δημοτικό Θέατρο',       positions: ['center-back']},
                        {lineId: 'M3', toward: 'Δουκίσσης / Αεροδρόμιο', positions: ['center-back']}
                    ], note: 'Αλλαγές M3 → Δημοτικό θέατρο: πίσω | Αλλαγή M3 → Αεροδρόμιο: πίσω' },
                    { name: 'Θησείο',           engName: 'Thiseio',             positions: [] , note: 'No data yet!'},
                    { name: 'Πετράλωνα',        engName: 'Petralona',           positions: ['front'] },
                    { name: 'Ταύρος',           engName: 'Tavros',              positions: ['center'] },
                    { name: 'Καλλιθέα',         engName: 'Kallithea',           positions: [] , note: 'No data yet!'},
                    { name: 'Μοσχάτο',          engName: 'Moschato',            positions: [] , note: 'No data yet!'},
                    { name: 'Φάληρο',           engName: 'Faliro',              positions: [] , note: 'No data yet!'},
                    { name: 'Πειραιάς',         engName: 'Piraeus',             positions: ['front'], transfers: [
                        {lineId: 'M3', toward: 'Δημοτικό Θέατρο',       positions: ['front']},
                        {lineId: 'M3', toward: 'Δουκίσσης / Αεροδρόμιο', positions: ['front']}
                    ] },
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
                    { name: 'Σύνταγμα',         engName: 'Syntagma',        positions: ['center-back'], transfers: [
                        {lineId: 'M3', toward: 'Δημοτικό Θέατρο',       positions: ['center-front']},
                        {lineId: 'M3', toward: 'Δουκίσσης / Αεροδρόμιο', positions: ['center-back']}
                    ], note: 'Usually really crowded' },
                    { name: 'Πανεπιστήμιο',     engName: 'Panepistimio',    positions: ['center'] },
                    { name: 'Ομόνοια',          engName: 'Omonia',          positions: [], transfers: [] },
                    { name: 'Μεταξουργείο',     engName: 'Metaxourghio',    positions: [] },
                    { name: 'Σταθμός Λαρίσσης', engName: 'Larissa Station', positions: ['center-front'] },
                    { name: 'Αττική',           engName: 'Attiki',          positions: ['center-back'], transfers: [
                        {lineId: 'M1', toward: 'Κηφισιά', positions: ['center-back']},
                        {lineId: 'M1', toward: 'Πειραιάς', positions: ['center-back']}
                    ], note: 'Αλλαγές σε Μ1 → πίσω' },
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
                    { name: 'Αττική',           engName: 'Attiki',          positions: ['center-front'], transfers: []},
                    { name: 'Σταθμός Λαρίσσης', engName: 'Larissa Station', positions: ['back'] },
                    { name: 'Μεταξουργείο',     engName: 'Metaxourghio',    positions: ['center-front'] },
                    { name: 'Ομόνοια',          engName: 'Omonia',          positions: ['center-back', 'front'], transfers: [
                        {lineId: 'M1', toward: 'Κηφισιά', positions: ['center-back', 'front']},
                        {lineId: 'M1', toward: 'Πειραιάς', positions: ['center-back', 'front']}
                    ] },
                    { name: 'Πανεπιστήμιο',     engName: 'Panepistimio',    positions: ['center-back', 'center-front'] },
                    { name: 'Σύνταγμα',         engName: 'Syntagma',        positions: ['center', 'center-front'], transfers: [
                        {lineId: 'M3', toward: 'Δημοτικό Θέατρο', positions: ['center-back']},
                        {lineId: 'M3', toward: 'Δουκίσσης / Αεροδρόμιο', positions: ['front']}
                    ], note: 'Usually really crowded' },
                    { name: 'Ακρόπολη',         engName: 'Acropolis',       positions: ['center-back'] },
                    { name: 'Συγγρού Φιξ',      engName: 'Syggrou Fix',     positions: ['center-front'] },
                    { name: 'Νέος Κόσμος',      engName: 'Neos Kosmos',     positions: ['center'] },
                    { name: 'Άγιος Ιωάννης',    engName: 'Agios Ioannis',   positions: ['center-back', 'center'] },
                    { name: 'Δάφνη',            engName: 'Dafni',           positions: ['center-back'] },
                    { name: 'Άγιος Δημήτριος',  engName: 'Agios Dimitrios', positions: ['center-front'] },
                    { name: 'Ηλιούπολη',        engName: 'Ilioupoli',       positions: ['center-back'] },
                    { name: 'Άλιμος',           engName: 'Alimos',          positions: ['center-back'] },
                    { name: 'Αργυρούπολη',      engName: 'Argiroupoli',     positions: ['center-front'] },
                    { name: 'Ελληνικό',         engName: 'Elliniko',        positions: ['center-back', 'center-front'] }
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
                    { name: 'Αεροδρόμιο',           engName: 'Airport',                 positions: [] , note: 'No data yet!'},
                    { name: 'Κορωπί',               engName: 'Koropi',                  positions: [] , note: 'No data yet!'},
                    { name: 'Παιανία-Κάντζα',       engName: 'Paiania-Kantza',          positions: [] , note: 'No data yet!'},
                    { name: 'Παλλήνη',              engName: 'Pallini',                 positions: [] , note: 'No data yet!'},
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
                    { name: 'Σύνταγμα',             engName: 'Syntagma',                positions: ['back', 'front'], transfers: [
                        {lineId: 'M2', toward: 'Ανθούπολη', positions: ['center'] },
                        {lineId: 'M2', toward: 'Ελληνικό', positions: ['center-front'] }
                    ], note: 'Usually crowded' },
                    { name: 'Μοναστηράκι',          engName: 'Monastiraki',             positions: ['center-back'],   transfers: [
                        {lineId: 'M1', toward: 'Πειραιάς', positions: ['center-back'] },
                        {lineId: 'M1', toward: 'Κηφισιά', positions: [] }
                    ] },
                    { name: 'Κεραμεικός',           engName: 'Kerameikos',              positions: ['center-back', 'front'] },
                    { name: 'Ελαιώνας',             engName: 'Elaionas',                positions: ['center-back', 'front'] },
                    { name: 'Αιγάλεω',              engName: 'Aigaleo',                 positions: ['center-back', 'front'] },
                    { name: 'Αγία Μαρίνα',          engName: 'Agia Marina',             positions: ['center'] },
                    { name: 'Αγία Βαρβάρα',         engName: 'Agia Varvara',            positions: ['center-back', 'center'] },
                    { name: 'Κορυδαλλός',           engName: 'Korydallos',              positions: ['center-front'] },
                    { name: 'Νίκαια',               engName: 'Nikaia',                  positions: ['center-back', 'center'] },
                    { name: 'Μανιάτικα',            engName: 'Maniatika',               positions: ['center-back'] },
                    { name: 'Πειραιάς',             engName: 'Piraeus',                 positions: ['front', 'back'], transfers: [
                        {lineId: 'M1', toward: 'Πειραιάς', positions: ['back'] },
                        {lineId: 'M1', toward: 'Κηφισιά', positions: ['back'] }
                    ] },
                    { name: 'Δημοτικό Θέατρο',      engName: 'Dimotiko Theatro',        positions: ['back', 'front'] }
                ],
            },
            {
                id: 'M3_doukissis',
                toward: 'Δουκίσσης / Αεροδρόμιο',
                stops: [
                    { name: 'Δημοτικό Θέατρο',      engName: 'Dimotiko Theatro',        positions: ['back', 'front'] },
                    { name: 'Πειραιάς',             engName: 'Piraeus',                 positions: ['front', 'back'], transfers: [
                        {lineId: 'M1', toward: 'Πειραιάς', positions: ['back'] },
                        {lineId: 'M1', toward: 'Κηφισιά', positions: ['back'] }
                    ]},
                    { name: 'Μανιάτικα',            engName: 'Maniatika',               positions: ['center-back'] },
                    { name: 'Νίκαια',               engName: 'Nikaia',                  positions: ['center-back', 'center'] },
                    { name: 'Κορυδαλλός',           engName: 'Korydallos',              positions: ['center-front'] },
                    { name: 'Αγία Βαρβάρα',         engName: 'Agia Varvara',            positions: ['center-back', 'center'] },
                    { name: 'Αγία Μαρίνα',          engName: 'Agia Marina',             positions: ['center'] },
                    { name: 'Αιγάλεω',              engName: 'Aigaleo',                 positions: ['center-back', 'front'] },
                    { name: 'Ελαιώνας',             engName: 'Elaionas',                positions: ['center-back', 'front'] },
                    { name: 'Κεραμεικός',           engName: 'Kerameikos',              positions: ['center-back', 'front'] },
                    { name: 'Μοναστηράκι',          engName: 'Monastiraki',             positions: ['center-back'],   transfers: [
                        {lineId: 'M1', toward: 'Πειραιάς', positions: ['back'] },
                        {lineId: 'M1', toward: 'Κηφισιά', positions: ['back'] }
                    ], note: 'Κόμβος αλλαγών M1/M2/M3' },
                    { name: 'Σύνταγμα',             engName: 'Syntagma',                positions: ['back', 'front'], transfers: [

                    ], note: 'Usually really crowded' },
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
                    { name: 'Παλλήνη',              engName: 'Pallini',                 positions: [] , note: 'No data yet!'},
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

// Geographic coordinates for each station (for nearest-stop detection)
export const stopCoordinates = {
    // M1
    'Πειραιάς':         { lat: 37.9462, lng: 23.6448 },
    'Φάληρο':           { lat: 37.9427, lng: 23.6706 },
    'Μοσχάτο':          { lat: 37.9498, lng: 23.6882 },
    'Καλλιθέα':         { lat: 37.9558, lng: 23.7008 },
    'Ταύρος':           { lat: 37.9630, lng: 23.7067 },
    'Πετράλωνα':        { lat: 37.9726, lng: 23.7127 },
    'Θησείο':           { lat: 37.9761, lng: 23.7211 },
    'Μοναστηράκι':      { lat: 37.9759, lng: 23.7254 },
    'Ομόνοια':          { lat: 37.9810, lng: 23.7285 },
    'Βικτώρια':         { lat: 37.9870, lng: 23.7275 },
    'Αττική':           { lat: 37.9922, lng: 23.7226 },
    'Άγιος Νικόλαος':   { lat: 37.9957, lng: 23.7217 },
    'Κάτω Πατήσια':     { lat: 37.9992, lng: 23.7261 },
    'Άγιος Ελευθέριος': { lat: 38.0055, lng: 23.7325 },
    'Άνω Πατήσια':      { lat: 38.0085, lng: 23.7374 },
    'Περισσός':         { lat: 38.0152, lng: 23.7443 },
    'Πευκάκια':         { lat: 38.0215, lng: 23.7530 },
    'Νέα Ιωνία':        { lat: 38.0261, lng: 23.7577 },
    'Ηράκλειο':         { lat: 38.0374, lng: 23.7668 },
    'Ειρήνη':           { lat: 38.0458, lng: 23.7726 },
    'Νεραντζιώτισσα':   { lat: 38.0590, lng: 23.7858 },
    'Μαρούσι':          { lat: 38.0604, lng: 23.8025 },
    'ΚΑΤ':              { lat: 38.0748, lng: 23.8088 },
    'Κηφισιά':          { lat: 38.0751, lng: 23.8140 },
    // M2 (unique stops)
    'Ελληνικό':         { lat: 37.9145, lng: 23.7495 },
    'Αργυρούπολη':      { lat: 37.9200, lng: 23.7512 },
    'Άλιμος':           { lat: 37.9243, lng: 23.7460 },
    'Ηλιούπολη':        { lat: 37.9305, lng: 23.7513 },
    'Άγιος Δημήτριος':  { lat: 37.9322, lng: 23.7363 },
    'Δάφνη':            { lat: 37.9398, lng: 23.7332 },
    'Άγιος Ιωάννης':    { lat: 37.9437, lng: 23.7245 },
    'Νέος Κόσμος':      { lat: 37.9534, lng: 23.7268 },
    'Συγγρού Φιξ':      { lat: 37.9637, lng: 23.7289 },
    'Ακρόπολη':         { lat: 37.9693, lng: 23.7319 },
    'Σύνταγμα':         { lat: 37.9752, lng: 23.7353 },
    'Πανεπιστήμιο':     { lat: 37.9786, lng: 23.7327 },
    'Μεταξουργείο':     { lat: 37.9854, lng: 23.7224 },
    'Σταθμός Λαρίσσης': { lat: 37.9893, lng: 23.7206 },
    'Σεπόλια':          { lat: 38.0063, lng: 23.7187 },
    'Άγιος Αντώνιος':   { lat: 38.0126, lng: 23.7072 },
    'Περιστέρι':        { lat: 38.0190, lng: 23.6954 },
    'Ανθούπολη':        { lat: 38.0195, lng: 23.6831 },
    // M3 (unique stops)
    'Δημοτικό Θέατρο':      { lat: 37.9436, lng: 23.6477 },
    'Μανιάτικα':            { lat: 37.9466, lng: 23.6594 },
    'Νίκαια':               { lat: 37.9491, lng: 23.6673 },
    'Κορυδαλλός':           { lat: 37.9580, lng: 23.6768 },
    'Αγία Βαρβάρα':         { lat: 37.9669, lng: 23.6878 },
    'Αγία Μαρίνα':          { lat: 37.9762, lng: 23.6924 },
    'Αιγάλεω':              { lat: 37.9865, lng: 23.6959 },
    'Ελαιώνας':             { lat: 37.9909, lng: 23.7044 },
    'Κεραμεικός':           { lat: 37.9792, lng: 23.7144 },
    'Ευαγγελισμός':         { lat: 37.9761, lng: 23.7465 },
    'Μέγαρο Μουσικής':      { lat: 37.9779, lng: 23.7594 },
    'Αμπελόκηποι':          { lat: 37.9827, lng: 23.7640 },
    'Πανόρμου':             { lat: 37.9875, lng: 23.7644 },
    'Κατεχάκη':             { lat: 37.9922, lng: 23.7679 },
    'Εθνική Άμυνα':         { lat: 38.0013, lng: 23.7707 },
    'Χολαργός':             { lat: 38.0068, lng: 23.7757 },
    'Νομισματοκοπείο':      { lat: 38.0171, lng: 23.7871 },
    'Αγία Παρασκευή':       { lat: 38.0201, lng: 23.8013 },
    'Χαλάνδρι':             { lat: 38.0208, lng: 23.8141 },
    'Δουκίσσης Πλακεντίας': { lat: 38.0281, lng: 23.8364 },
    'Παλλήνη':              { lat: 37.9999, lng: 23.8794 },
    'Παιανία-Κάντζα':       { lat: 37.9799, lng: 23.9129 },
    'Κορωπί':               { lat: 37.9280, lng: 23.9133 },
    'Αεροδρόμιο':           { lat: 37.9365, lng: 23.9445 },
};

// All unique stops as { name, engName } objects (for autocomplete)
export const allStops = [...new Map(
    lines.flatMap(l => l.directions.flatMap(d =>
        d.stops.map(s => [s.name, { name: s.name, engName: s.engName }])
    ))
).values()].sort((a, b) => a.name.localeCompare(b.name, 'el'));
