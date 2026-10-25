// Names: comparing what someone typed with them, in Greek or Latin letters,
// and a stop's name in Latin letters

// Lowercase, without accents, with σ for the final ς and single spaces:
// 'ΠΕΙΡΑΙΆΣ', 'Πειραιάς' and ' πειραιας ' are all 'πειραιασ'
export function normalise(text) {
    return text.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ς/g, 'σ').replace(/\s+/g, ' ').trim();
}

// A stop's name in Latin letters, as OASA writes most of them: letter for
// letter, with Θ TH, Ξ and Χ X, Ψ PS, and ordinals in English:
// 'ΓΕΦΥΡΑ ΑΤΤΙΚΗΣ ΟΔΟΥ' → 'GEFYRA ATTIKHS ODOY', '14η ΦΥΛΗΣ' → '14th FYLHS'.
// bus-stops.json keeps OASA's English only where it's something else
// (server/data/build-bus.js), and the browser works out the rest with this.
const LATIN = { Α: 'A', Β: 'B', Γ: 'G', Δ: 'D', Ε: 'E', Ζ: 'Z', Η: 'H', Θ: 'TH', Ι: 'I', Κ: 'K', Λ: 'L', Μ: 'M', Ν: 'N', Ξ: 'X', Ο: 'O', Π: 'P', Ρ: 'R', Σ: 'S', Τ: 'T', Υ: 'Y', Φ: 'F', Χ: 'X', Ψ: 'PS', Ω: 'O' };
const ordinal = n => (n % 100 >= 11 && n % 100 <= 13) ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] ?? 'th');
export function latinName(greek) {
    return greek
        .replace(/(\d+)(?:ης|ας|ου|ος|η|α|ο)(?!\p{L})/gu, (_, n) => n + ordinal(Number(n)))
        .normalize('NFD').replace(/[̀-ͯ]/g, '')
        .replace(/[Α-Ω]/g, c => LATIN[c] ?? c);
}
