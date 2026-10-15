// Where each station sits on the schematic metro map, in grid units (x to the
// right, y down; Syntagma is 0,0). Lines run horizontally, vertically or at
// 45°, and only meet at interchanges; test/subway-map.test.js checks both.
// The layout loosely follows STASY's official map.
//
// Each entry is [x, y, label side]. The side is a compass direction from the
// station: n, s, e, w, ne, nw, se or sw.

export const STATIONS = {
    // Centre
    'syntagma':             [0, 0, 'se'],
    'panepistimio':         [-1, -1, 'ne'],
    'omonia':               [-2, -2, 'e'],
    'monastiraki':          [-2, 0, 'nw'],

    // M1 south
    'thiseio':              [-3, 1, 'se'],
    'petralona':            [-4, 2, 'nw'],
    'tavros':               [-5, 3, 'nw'],
    'kallithea':            [-6, 4, 'nw'],
    'moschato':             [-7, 5, 'nw'],
    'faliro':               [-8, 6, 's'],
    'piraeus':              [-9.5, 6, 'w'],

    // M1 north
    'victoria':             [-2, -3, 'e'],
    'attiki':               [-3, -5, 'ne'],
    'agios-nikolaos':       [-3, -6, 'w'],
    'kato-patisia':         [-3, -7, 'w'],
    'agios-eleftherios':    [-3, -8, 'w'],
    'ano-patisia':          [-2, -9, 'e'],
    'perissos':             [-1, -10, 'e'],
    'pefkakia':             [0, -11, 'e'],
    'nea-ionia':            [1, -12, 'nw'],
    'irakleio':             [3, -12, 's'],
    'eirini':               [5, -12, 's'],
    'nerantziotissa':       [7, -12, 's'],
    'marousi':              [8, -13, 'e'],
    'kat':                  [9, -14, 'e'],
    'kifisia':              [10, -15, 'e'],

    // M2 north
    'metaxourghio':         [-3, -3, 'w'],
    'larissa-station':      [-3, -4, 'w'],
    'sepolia':              [-4, -5, 'n'],
    'agios-antonios':       [-5, -6, 'sw'],
    'peristeri':            [-6, -7, 'sw'],
    'anthoupoli':           [-7, -8, 'sw'],

    // M2 south
    'acropolis':            [-1, 1, 'e'],
    'syggrou-fix':          [-1, 2, 'e'],
    'neos-kosmos':          [-1, 3, 'w'],
    'agios-ioannis':        [0, 4, 'e'],
    'dafni':                [0, 5, 'e'],
    'agios-dimitrios':      [0, 6, 'e'],
    'ilioupoli':            [0, 7, 'e'],
    'alimos':               [0, 8, 'e'],
    'argiroupoli':          [0, 9, 'e'],
    'elliniko':             [0, 10, 'e'],

    // M3 east and the airport branch
    'evangelismos':         [2, 0, 'n'],
    'megaro-mousikis':      [4, 0, 's'],
    'ampelokipoi':          [5, -1, 'se'],
    'panormou':             [6, -2, 'nw'],
    'katechaki':            [7.5, -2, 'n'],
    'ethniki-amyna':        [9, -2, 's'],
    'cholargos':            [10, -3, 'se'],
    'nomismatokopio':       [11, -4, 'se'],
    'agia-paraskevi':       [12, -5, 'se'],
    'chalandri':            [13, -6, 'se'],
    'doukissis-plakentias': [14, -7, 'n'],
    'pallini':              [15, -6, 'e'],
    'paiania-kantza':       [15, -4.5, 'e'],
    'koropi':               [15, -3, 'e'],
    'airport':              [15, -1.5, 'e'],

    // M3 west
    'kerameikos':           [-3.5, 0, 's'],
    'elaionas':             [-4.5, -1, 'sw'],
    'aigaleo':              [-5.5, -2, 'sw'],
    'agia-marina':          [-6.5, -3, 'n'],
    'agia-varvara':         [-8, -1.5, 'nw'],
    'korydallos':           [-9.5, 0, 'w'],
    'nikaia':               [-9.5, 2, 'e'],
    'maniatika':            [-9.5, 4, 'e'],
    'dimotiko-theatro':     [-8.5, 7, 'e'],
};

// Corners between two neighbouring stations, keyed "a>b" in either order
export const BENDS = {
    'victoria>attiki': [[-2, -4]],
};

// Parts of a line drawn dashed: the airport branch runs every 36 minutes
export const DASHED = {
    M3: ['doukissis-plakentias', 'airport'],
};
