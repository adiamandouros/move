// Comparing what someone typed with names, in Greek or Latin letters

// Lowercase, without accents, with σ for the final ς and single spaces:
// 'ΠΕΙΡΑΙΆΣ', 'Πειραιάς' and ' πειραιας ' are all 'πειραιασ'
export function normalise(text) {
    return text.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ς/g, 'σ').replace(/\s+/g, ' ').trim();
}
