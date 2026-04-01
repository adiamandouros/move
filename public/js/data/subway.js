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
//   exits     {string[]}  Where to stand to EXIT this stop
//   elevators {string[]?} Where the elevator is located
//   note      {string?}   Optional free-text info
//   transfers {object[]?} Where to stand to TRANSFER to another line/direction
//     Each transfer entry:
//       lineId    {string}   e.g. 'M1', 'M2', 'M3'
//       toward    {string}   Matches direction.toward exactly
//       exits     {string[]} Where to stand on THIS train to reach that platform

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
                    { name: 'Πειραιάς',         engName: 'Piraeus',             exits: ['back'], transfers: [
                        {lineId: 'M3', toward: 'Δημοτικό Θέατρο',       exits: ['back']},
                        {lineId: 'M3', toward: 'Δουκίσσης / Αεροδρόμιο', exits: ['back']}
                    ] },
                    { name: 'Φάληρο',           engName: 'Faliro',              exits: ['center-back', 'center'] },
                    { name: 'Μοσχάτο',          engName: 'Moschato',            exits: [] },
                    { name: 'Καλλιθέα',         engName: 'Kallithea',           exits: [] },
                    { name: 'Ταύρος',           engName: 'Tavros',              exits: ['center'], central: true },
                    { name: 'Πετράλωνα',        engName: 'Petralona',           exits: ['back'] },
                    { name: 'Θησείο',           engName: 'Thiseio',             exits: ['center'] },
                    { name: 'Μοναστηράκι',      engName: 'Monastiraki',         exits: ['center-back', 'center-front'], elevators: ['center-front'], transfers: [
                        {lineId: 'M3', toward: 'Δημοτικό Θέατρο',       exits: ['center-back']},
                        {lineId: 'M3', toward: 'Δουκίσσης / Αεροδρόμιο', exits: ['center-back']}
                    ], note: 'Regular steps - no escalators' },
                    { name: 'Ομόνοια',          engName: 'Omonia',              exits: ['back', 'front'], elevators: ['center-back'], transfers: [
                        {lineId: 'M2', toward: 'Ανθούπολη', exits: ['center-front']},
                        {lineId: 'M2', toward: 'Ελληνικό', exits: ['center-front']}
                    ], note: 'Regular steps - no escalators' },
                    { name: 'Βικτώρια',         engName: 'Victoria',            exits: ['center'] },
                    { name: 'Αττική',           engName: 'Attiki',              exits: ['back', 'center', 'front'], transfers: [] },
                    { name: 'Άγιος Νικόλαος',   engName: 'Agios Nikolaos',      exits: ['back'] },
                    { name: 'Κάτω Πατήσια',     engName: 'Kato Patisia',        exits: ['center'] },
                    { name: 'Άγιος Ελευθέριος', engName: 'Agios Eleftherios',   exits: ['center-back', 'center'] },
                    { name: 'Άνω Πατήσια',      engName: 'Ano Patisia',         exits: ['center'] },
                    { name: 'Περισσός',         engName: 'Perissos',            exits: ['center'] },
                    { name: 'Πευκάκια',         engName: 'Pefkakia',            exits: ['center'] },
                    { name: 'Νέα Ιωνία',        engName: 'Nea Ionia',           exits: ['front'] },
                    { name: 'Ηράκλειο',         engName: 'Irakleio',            exits: ['center'] },
                    { name: 'Ειρήνη',           engName: 'Eirini',              exits: ['center-back', 'center-front'] },
                    { name: 'Νεραντζιώτισσα',   engName: 'Nerantziotissa',      exits: ['center-back', 'center'] },
                    { name: 'Μαρούσι',          engName: 'Marousi',             exits: ['center-front', 'center-back'] },
                    { name: 'ΚΑΤ',              engName: 'KAT',                 exits: ['back'] },
                    { name: 'Κηφισιά',          engName: 'Kifisia',             exits: ['front'] },
                ]
            },
            {
                id: 'M1_piraeus',
                toward: 'Πειραιάς',
                stops: [
                    { name: 'Κηφισιά',          engName: 'Kifisia',             exits: ['back'] },
                    { name: 'ΚΑΤ',              engName: 'KAT',                 exits: ['front'] },
                    { name: 'Μαρούσι',          engName: 'Marousi',             exits: ['center-back'] },
                    { name: 'Νεραντζιώτισσα',   engName: 'Nerantziotissa',      exits: ['center-back', 'center'] },
                    { name: 'Ειρήνη',           engName: 'Eirini',              exits: ['center-back', 'center-front'] },
                    { name: 'Ηράκλειο',         engName: 'Irakleio',            exits: ['center'] },
                    { name: 'Νέα Ιωνία',        engName: 'Nea Ionia',           exits: ['back'] },
                    { name: 'Πευκάκια',         engName: 'Pefkakia',            exits: ['center'] },
                    { name: 'Περισσός',         engName: 'Perissos',            exits: ['center'] },
                    { name: 'Άνω Πατήσια',      engName: 'Ano Patisia',         exits: ['center'] },
                    { name: 'Άγιος Ελευθέριος', engName: 'Agios Eleftherios',   exits: ['center'] },
                    { name: 'Κάτω Πατήσια',     engName: 'Kato Patisia',        exits: ['center'] },
                    { name: 'Άγιος Νικόλαος',   engName: 'Agios Nikolaos',      exits: ['center-back', 'center-front'] },
                    { name: 'Αττική',           engName: 'Attiki',              exits: ['center-back', 'center-front'], transfers: [] },
                    { name: 'Βικτώρια',         engName: 'Victoria',            exits: ['center'] },
                    { name: 'Ομόνοια',          engName: 'Omonia',              exits: ['back', 'front'], elevators:['center-front'], transfers: [
                        {lineId: 'M2', toward: 'Ανθούπολη', exits: ['center-back']},
                        {lineId: 'M2', toward: 'Ελληνικό', exits: ['center-back']}
                    ], note: 'Regular steps - no escalators'},
                    { name: 'Μοναστηράκι',      engName: 'Monastiraki',         exits: ['center-front'], elevators:['back'], transfers: [
                        {lineId: 'M3', toward: 'Δημοτικό Θέατρο',       exits: ['center-back']},
                        {lineId: 'M3', toward: 'Δουκίσσης / Αεροδρόμιο', exits: ['center-back']}
                    ], note: 'Regular steps - no escalators' },
                    { name: 'Θησείο',           engName: 'Thiseio',             exits: [] , note: 'No data yet!'},
                    { name: 'Πετράλωνα',        engName: 'Petralona',           exits: ['front'] },
                    { name: 'Ταύρος',           engName: 'Tavros',              exits: ['center'], central: true },
                    { name: 'Καλλιθέα',         engName: 'Kallithea',           exits: [] , note: 'No data yet!'},
                    { name: 'Μοσχάτο',          engName: 'Moschato',            exits: [] , note: 'No data yet!'},
                    { name: 'Φάληρο',           engName: 'Faliro',              exits: [] , note: 'No data yet!'},
                    { name: 'Πειραιάς',         engName: 'Piraeus',             exits: ['front'], transfers: [
                        {lineId: 'M3', toward: 'Δημοτικό Θέατρο',       exits: ['front']},
                        {lineId: 'M3', toward: 'Δουκίσσης / Αεροδρόμιο', exits: ['front']}
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
                    { name: 'Ελληνικό',         engName: 'Elliniko',        exits: ['back'] },
                    { name: 'Αργυρούπολη',      engName: 'Argiroupoli',     exits: ['center-front'] },
                    { name: 'Άλιμος',           engName: 'Alimos',          exits: ['center-front'] },
                    { name: 'Ηλιούπολη',        engName: 'Ilioupoli',       exits: ['center-front'] },
                    { name: 'Άγιος Δημήτριος',  engName: 'Agios Dimitrios', exits: ['back', 'front'], elevators:['center-back'], central: true},
                    { name: 'Δάφνη',            engName: 'Dafni',           exits: ['center'] },
                    { name: 'Άγιος Ιωάννης',    engName: 'Agios Ioannis',   exits: ['center-front'] },
                    { name: 'Νέος Κόσμος',      engName: 'Neos Kosmos',     exits: ['center-front'] },
                    { name: 'Συγγρού Φιξ',      engName: 'Syggrou Fix',     exits: ['center-front'] },
                    { name: 'Ακρόπολη',         engName: 'Acropolis',       exits: ['center-back'], elevators: ['center'] },
                    { name: 'Σύνταγμα',         engName: 'Syntagma',        exits: ['center'], transfers: [
                        {lineId: 'M3', toward: 'Δημοτικό Θέατρο',       exits: ['center-front']},
                        {lineId: 'M3', toward: 'Δουκίσσης / Αεροδρόμιο', exits: ['center-back']}
                    ], note: 'Usually really crowded' },
                    { name: 'Πανεπιστήμιο',     engName: 'Panepistimio',    exits: ['center-back'], elevators:['center'] },
                    { name: 'Ομόνοια',          engName: 'Omonia',          exits: ['back', 'center-front'], elevators:['center-back'], transfers: [], central: true },
                    { name: 'Μεταξουργείο',     engName: 'Metaxourghio',    exits: [] },
                    { name: 'Σταθμός Λαρίσσης', engName: 'Larissa Station', exits: ['center-front'] },
                    { name: 'Αττική',           engName: 'Attiki',          exits: ['center-back'], transfers: [
                        {lineId: 'M1', toward: 'Κηφισιά', exits: ['center-back']},
                        {lineId: 'M1', toward: 'Πειραιάς', exits: ['center-back']}
                    ], note: 'Αλλαγές σε Μ1 → πίσω' },
                    { name: 'Σεπόλια',          engName: 'Sepolia',         exits: ['center-front'] },
                    { name: 'Άγιος Αντώνιος',   engName: 'Agios Antonios',  exits: ['center'] },
                    { name: 'Περιστέρι',        engName: 'Peristeri',       exits: ['center-back'] },
                    { name: 'Ανθούπολη',        engName: 'Anthoupoli',      exits: ['center'] }
                ]
            },
            {
                id: 'M2_elliniko',
                toward: 'Ελληνικό',
                stops: [
                    { name: 'Ανθούπολη',        engName: 'Anthoupoli',      exits: [] },
                    { name: 'Περιστέρι',        engName: 'Peristeri',       exits: ['center-back'] },
                    { name: 'Άγιος Αντώνιος',   engName: 'Agios Antonios',  exits: ['center-back'] },
                    { name: 'Σεπόλια',          engName: 'Sepolia',         exits: ['center-front'] },
                    { name: 'Αττική',           engName: 'Attiki',          exits: ['center-front'], transfers: []},
                    { name: 'Σταθμός Λαρίσσης', engName: 'Larissa Station', exits: ['back'] },
                    { name: 'Μεταξουργείο',     engName: 'Metaxourghio',    exits: ['center-front'] },
                    { name: 'Ομόνοια',          engName: 'Omonia',          exits: ['center-back', 'front'], transfers: [], central: true },
                    { name: 'Πανεπιστήμιο',     engName: 'Panepistimio',    exits: ['center-back', 'center-front'] },
                    { name: 'Σύνταγμα',         engName: 'Syntagma',        exits: ['center', 'center-front'], transfers: [
                        {lineId: 'M3', toward: 'Δημοτικό Θέατρο', exits: ['center-back']},
                        {lineId: 'M3', toward: 'Δουκίσσης / Αεροδρόμιο', exits: ['front']}
                    ], note: 'Usually really crowded' },
                    { name: 'Ακρόπολη',         engName: 'Acropolis',       exits: ['center-back'] },
                    { name: 'Συγγρού Φιξ',      engName: 'Syggrou Fix',     exits: ['center-front'] },
                    { name: 'Νέος Κόσμος',      engName: 'Neos Kosmos',     exits: ['center'] },
                    { name: 'Άγιος Ιωάννης',    engName: 'Agios Ioannis',   exits: ['center-back', 'center'] },
                    { name: 'Δάφνη',            engName: 'Dafni',           exits: ['center-back'] },
                    { name: 'Άγιος Δημήτριος',  engName: 'Agios Dimitrios', exits: ['center-front'] , central: true},
                    { name: 'Ηλιούπολη',        engName: 'Ilioupoli',       exits: ['center-back'] },
                    { name: 'Άλιμος',           engName: 'Alimos',          exits: ['center-back'] },
                    { name: 'Αργυρούπολη',      engName: 'Argiroupoli',     exits: ['center-front'] },
                    { name: 'Ελληνικό',         engName: 'Elliniko',        exits: ['center-back', 'center-front'] }
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
                    { name: 'Αεροδρόμιο',           engName: 'Airport',                 exits: [] , note: 'No data yet!'},
                    { name: 'Κορωπί',               engName: 'Koropi',                  exits: [] , note: 'No data yet!'},
                    { name: 'Παιανία-Κάντζα',       engName: 'Paiania-Kantza',          exits: [] , note: 'No data yet!'},
                    { name: 'Παλλήνη',              engName: 'Pallini',                 exits: [] , note: 'No data yet!', central: true },
                    { name: 'Δουκίσσης Πλακεντίας', engName: 'Doukissis Plakentias',    exits: ['center-back'] },
                    { name: 'Χαλάνδρι',             engName: 'Chalandri',               exits: ['center-back'] },
                    { name: 'Αγία Παρασκευή',       engName: 'Agia Paraskevi',          exits: ['center-back'] },
                    { name: 'Νομισματοκοπείο',      engName: 'Nomismatokopio',          exits: ['center-back'] },
                    { name: 'Χολαργός',             engName: 'Cholargos',               exits: ['center-back'] },
                    { name: 'Εθνική Άμυνα',         engName: 'Ethniki Amyna',           exits: ['center'], central: true },
                    { name: 'Κατεχάκη',             engName: 'Katechaki',               exits: ['center'] },
                    { name: 'Πανόρμου',             engName: 'Panormou',                exits: ['center-front'] },
                    { name: 'Αμπελόκηποι',          engName: 'Ampelokipoi',             exits: ['center-front'] },
                    { name: 'Μέγαρο Μουσικής',      engName: 'Megaro Mousikis',         exits: ['center-front'] },
                    { name: 'Ευαγγελισμός',         engName: 'Evangelismos',            exits: ['center-back'] },
                    { name: 'Σύνταγμα',             engName: 'Syntagma',                exits: ['back', 'front'], transfers: [
                        {lineId: 'M2', toward: 'Ανθούπολη', exits: ['center'] },
                        {lineId: 'M2', toward: 'Ελληνικό', exits: ['center-front'] }
                    ], note: 'Usually crowded' },
                    { name: 'Μοναστηράκι',          engName: 'Monastiraki',             exits: ['back', 'center-front'],        elevators:['center'],  transfers: [
                        {lineId: 'M1', toward: 'Πειραιάς', exits: ['back', 'center-front'] },
                        {lineId: 'M1', toward: 'Κηφισιά', exits: ['back', 'center-front'] }
                    ], central: true },
                    { name: 'Κεραμεικός',           engName: 'Kerameikos',              exits: ['back', 'center-front'],        elevators: ['center-back'] },
                    { name: 'Ελαιώνας',             engName: 'Elaionas',                exits: ['back', 'center-front'],        elevators: ['center-back'] },
                    { name: 'Αιγάλεω',              engName: 'Aigaleo',                 exits: ['center-back', 'center-front'], elevators: ['center'], central: true },
                    { name: 'Αγία Μαρίνα',          engName: 'Agia Marina',             exits: ['center'] },
                    { name: 'Αγία Βαρβάρα',         engName: 'Agia Varvara',            exits: ['center-back', 'center'] },
                    { name: 'Κορυδαλλός',           engName: 'Korydallos',              exits: ['center-front'],                elevators: ['center'] },
                    { name: 'Νίκαια',               engName: 'Nikaia',                  exits: ['center-back', 'center'] },
                    { name: 'Μανιάτικα',            engName: 'Maniatika',               exits: ['center-back'] },
                    { name: 'Πειραιάς',             engName: 'Piraeus',                 exits: ['front', 'back'], transfers: [
                        {lineId: 'M1', toward: 'Πειραιάς', exits: ['back'] },
                        {lineId: 'M1', toward: 'Κηφισιά', exits: ['back'] }
                    ] },
                    { name: 'Δημοτικό Θέατρο',      engName: 'Dimotiko Theatro',        exits: ['back', 'front'] }
                ],
            },
            {
                id: 'M3_doukissis',
                toward: 'Δουκίσσης / Αεροδρόμιο',
                stops: [
                    { name: 'Δημοτικό Θέατρο',      engName: 'Dimotiko Theatro',        exits: ['back', 'front'] },
                    { name: 'Πειραιάς',             engName: 'Piraeus',                 exits: ['front', 'back'], transfers: [
                        {lineId: 'M1', toward: 'Πειραιάς', exits: ['back'] },
                        {lineId: 'M1', toward: 'Κηφισιά', exits: ['back'] }
                    ]},
                    { name: 'Μανιάτικα',            engName: 'Maniatika',               exits: ['center-back'] },
                    { name: 'Νίκαια',               engName: 'Nikaia',                  exits: ['center-back', 'center'] },
                    { name: 'Κορυδαλλός',           engName: 'Korydallos',              exits: ['center-front'],                elevators: ['center'] },
                    { name: 'Αγία Βαρβάρα',         engName: 'Agia Varvara',            exits: ['center-front'],                elevators: ['center'] },
                    { name: 'Αγία Μαρίνα',          engName: 'Agia Marina',             exits: ['center-front'],                elevators: ['center'] },
                    { name: 'Αιγάλεω',              engName: 'Aigaleo',                 exits: ['center-back', 'center-front'], elevators: ['center'], central: true },
                    { name: 'Ελαιώνας',             engName: 'Elaionas',                exits: ['back', 'center-front'],        elevators: ['center-back'] },
                    { name: 'Κεραμεικός',           engName: 'Kerameikos',              exits: ['center-back', 'front'],        elevators: ['center-front'] },
                    { name: 'Μοναστηράκι',          engName: 'Monastiraki',             exits: ['back', 'center'],              elevators: ['center-back'], transfers: [
                        {lineId: 'M1', toward: 'Πειραιάς', exits: ['back', 'center'] },
                        {lineId: 'M1', toward: 'Κηφισιά', exits: ['back', 'center'] }
                    ], central: true },
                    { name: 'Σύνταγμα',             engName: 'Syntagma',                exits: ['back', 'front'], transfers: [
                        {lineId: 'M2', toward: 'Ανθούπολη', exits: ['center'] },
                        {lineId: 'M2', toward: 'Ελληνικό', exits: ['center-back'] }
                    ], note: 'Usually really crowded' },
                    { name: 'Ευαγγελισμός',         engName: 'Evangelismos',            exits: ['center-back'] },
                    { name: 'Μέγαρο Μουσικής',      engName: 'Megaro Mousikis',         exits: ['center-front'] },
                    { name: 'Αμπελόκηποι',          engName: 'Ampelokipoi',             exits: ['center-front'] },
                    { name: 'Πανόρμου',             engName: 'Panormou',                exits: ['center-front'] },
                    { name: 'Κατεχάκη',             engName: 'Katechaki',               exits: ['center'] },
                    { name: 'Εθνική Άμυνα',         engName: 'Ethniki Amyna',           exits: ['center'], central: true },
                    { name: 'Χολαργός',             engName: 'Cholargos',               exits: ['center-back'] },
                    { name: 'Νομισματοκοπείο',      engName: 'Nomismatokopio',          exits: ['center-back'] },
                    { name: 'Αγία Παρασκευή',       engName: 'Agia Paraskevi',          exits: ['center-back'] },
                    { name: 'Χαλάνδρι',             engName: 'Chalandri',               exits: ['center-back'] },
                    { name: 'Δουκίσσης Πλακεντίας', engName: 'Doukissis Plakentias',    exits: ['center-back'] },
                    { name: 'Παλλήνη',              engName: 'Pallini',                 exits: [] , note: 'No data yet!', central: true },
                    { name: 'Παιανία-Κάντζα',       engName: 'Paiania-Kantza',          exits: [] },
                    { name: 'Κορωπί',               engName: 'Koropi',                  exits: [] },
                    { name: 'Αεροδρόμιο',           engName: 'Airport',                 exits: [] },
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
