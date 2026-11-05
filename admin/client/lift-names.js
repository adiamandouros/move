// Which of STASY's names for a station's lifts say they reach a platform: the
// lift "Προς Πειραιά" or "Προς Γραμμή 1 Πειραιά" goes to the platform toward
// Piraeus, and "Προς Αεροδρόμιο και Ανθούπολη" to the two that go there. The
// editor fills them in for a platform whose elevators are listed, so only
// where each is is left to choose. No DOM, so it's tested in Node.

// A text's words, without accents and a last ς: "Πειραιάς" and "Πειραιά" are one
const words = text => text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
    .split(/[^\p{L}\d]+/u).filter(Boolean).map(word => word.replace(/ς$/, ''));
const TOWARD = 'προ';

/**
 * The names of `names` that say they go toward `toward` (a direction's end in
 * Greek, "Δουκίσσης / Αεροδρόμιο" for either), each once. Only after "προς":
 * an exit to Kifisias Avenue isn't the way to the platform toward Kifisia.
 * @param {string[]} names @param {string} toward @returns {string[]}
 */
export function namesToward(names, toward) {
    const ends = toward.split('/').map(words).filter(end => end.length);
    return [...new Set(names)].filter(name => {
        const said = words(name);
        const after = said.slice(said.indexOf(TOWARD) + 1);
        return said.includes(TOWARD) && ends.some(end => end.every(word => after.includes(word)));
    });
}
