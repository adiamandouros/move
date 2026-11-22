// Names: comparing what someone typed with them, in Greek or Latin letters,
// and a stop's name in Latin letters

// Lowercase, without accents, with σ for the final ς and single spaces:
// 'ΠΕΙΡΑΙΆΣ', 'Πειραιάς' and ' πειραιας ' are all 'πειραιασ'
/** @param {string} text */
export function normalise(text) {
    return text.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ς/g, 'σ').replace(/\s+/g, ' ').trim();
}

// The u of ου is held as 'U' until the end, so the αου of Μενελάου isn't
// taken for the αυ of Παύλου ('av')
const GREEK_PAIRS = [['ου', 'U'], ['αι', 'e'], ['ει', 'i'], ['οι', 'i'], ['υι', 'i'], ['ευ', 'ev'], ['αυ', 'av'], ['ηυ', 'iv'],
    ['μπ', 'b'], ['ντ', 'd'], ['γκ', 'g'], ['γγ', 'g'], ['γχ', 'h']];
/** @type {Record<string, string>} */
const GREEK = { α: 'a', β: 'v', γ: 'g', δ: 'd', ε: 'e', ζ: 'z', η: 'i', θ: 'th', ι: 'i', κ: 'k', λ: 'l', μ: 'm', ν: 'n', ξ: 'ks', ο: 'o', π: 'p', ρ: 'r', σ: 's', τ: 't', υ: 'i', φ: 'f', χ: 'h', ψ: 'ps', ω: 'o' };
const LATIN_PAIRS = [['ph', 'f'], ['ch', 'h'], ['kh', 'h'], ['dh', 'd'], ['gh', 'g'], ['ou', 'U'], ['oy', 'U'], ['ai', 'e'], ['ei', 'i'], ['oi', 'i'],
    ['eu', 'ev'], ['au', 'av'], ['ef', 'ev'], ['af', 'av'], ['mp', 'b'], ['nt', 'd'], ['gk', 'g'], ['ng', 'g'], ['gg', 'g'],
    ['x', 'ks'], ['y', 'i'], ['w', 'o'], ['c', 'k'], ['j', 'g']];

// Small letters, no accents
/** @param {string} text */
export const plain = text => text.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ς/g, 'σ');

// Greek and Latin spellings of a word end up the same, for address search
// (server/places/search.js, decision 22) and the Trip page's recent places:
// 'Μενελάου', 'Menelaou' and 'menelaoy' are all 'menelau'
/** @param {string} text */
export function fold(text) {
    let s = plain(text);
    s = s.replace(/(\d+)(?:ησ|ασ|ου|οσ|η|α|ο|th|st|nd|rd)(?![\p{L}])/gu, '$1');
    for (const [a, b] of GREEK_PAIRS) s = s.replaceAll(a, b);
    s = s.replace(/[α-ω]/g, c => GREEK[c]);
    for (const [a, b] of LATIN_PAIRS) s = s.replaceAll(a, b);
    return s.replaceAll('U', 'u').replace(/([a-z])\1/g, '$1').replace(/[^a-z0-9]+/g, ' ').trim();
}

// A stop's name in Latin letters, as OASA writes most of them: letter for
// letter, with Θ TH, Ξ and Χ X, Ψ PS, and ordinals in English:
// 'ΓΕΦΥΡΑ ΑΤΤΙΚΗΣ ΟΔΟΥ' → 'GEFYRA ATTIKHS ODOY', '14η ΦΥΛΗΣ' → '14th FYLHS'.
// bus-stops.json keeps OASA's English only where it's something else
// (server/data/build-bus.js), and the browser works out the rest with this.
/** @type {Record<string, string>} */
const LATIN = { Α: 'A', Β: 'B', Γ: 'G', Δ: 'D', Ε: 'E', Ζ: 'Z', Η: 'H', Θ: 'TH', Ι: 'I', Κ: 'K', Λ: 'L', Μ: 'M', Ν: 'N', Ξ: 'X', Ο: 'O', Π: 'P', Ρ: 'R', Σ: 'S', Τ: 'T', Υ: 'Y', Φ: 'F', Χ: 'X', Ψ: 'PS', Ω: 'O' };
/** @type {Record<number, string>} */
const ORDINALS = { 1: 'st', 2: 'nd', 3: 'rd' };
/** @param {number} n */
const ordinal = n => (n % 100 >= 11 && n % 100 <= 13) ? 'th' : (ORDINALS[n % 10] ?? 'th');
/** @param {string} greek */
export function latinName(greek) {
    return greek
        .replace(/(\d+)(?:ης|ας|ου|ος|η|α|ο)(?!\p{L})/gu, (_, /** @type {string} */ n) => n + ordinal(Number(n)))
        .normalize('NFD').replace(/[̀-ͯ]/g, '')
        .replace(/[Α-Ω]/g, c => LATIN[c] ?? c);
}
