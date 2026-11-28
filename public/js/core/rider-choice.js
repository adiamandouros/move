import { riderAnswer, setRiderAnswer } from './rider-times.js';

// The privacy page's switch for sending metro and tram times (decision 84):
// on for "Yes", off for "No thanks" or no answer yet; changed, it's the
// rider's answer, as the Trip page's question and switch give it. Shown
// only where this runs, as without it the switch would do nothing
const choice = document.getElementById('rider-times-choice');
const input = /** @type {HTMLInputElement | null} */ (document.getElementById('rider-times-send'));
if (choice && input) {
    input.checked = riderAnswer() === 'yes';
    input.addEventListener('change', () => setRiderAnswer(input.checked ? 'yes' : 'no'));
    choice.hidden = false;
}
