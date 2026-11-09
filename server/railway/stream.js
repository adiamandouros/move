// One look at railway.gov.gr's live train stream (decision 42): every train
// with a GPS unit, its next station and where it is, sent as server-sent
// events, 10 seconds late. A look connects, reads the first positions
// message, and hangs up: about 250 KB, most of it the trains' last 20
// points sent first (trainHistory), which is skipped as it comes rather than
// kept, so a look takes no more memory than the positions themselves.

export const STREAM_URL = 'https://railway.gov.gr/api/train-stream';
// The positions come within a second or two of connecting
const LOOK_TIMEOUT_MS = 10_000;
const POSITIONS = 'trainPositionsUx';

/**
 * Reads the stream until its first positions message.
 * → { positions, bytes }: each train's position as railway.gov.gr sends it,
 * and how many bytes came. Throws when there's none within `timeoutMs`, or
 * on an HTTP error; the bytes read before are on the error (`bytes`)
 * @param {{ fetch?: typeof globalThis.fetch, userAgent?: string, timeoutMs?: number }} [options]
 * @returns {Promise<{ positions: any[], bytes: number }>}
 */
export async function look({ fetch = globalThis.fetch, userAgent = 'Wayhop', timeoutMs = LOOK_TIMEOUT_MS } = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error(`no positions within ${timeoutMs / 1000} s`)), timeoutMs);
    const reader = eventReader(POSITIONS);
    let bytes = 0;
    try {
        const response = await fetch(STREAM_URL, { headers: { 'User-Agent': userAgent, Accept: 'text/event-stream' }, signal: controller.signal });
        if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}`);
        const decoder = new TextDecoder();
        const chunks = response.body.getReader();
        // The time running out ends the reading, whatever the fetch does then
        controller.signal.addEventListener('abort', () => { chunks.cancel().catch(() => {}); }, { once: true });
        for (;;) {
            const { done, value: chunk } = await chunks.read();
            if (done) break;
            bytes += chunk.length;
            const data = reader(decoder.decode(chunk, { stream: true }));
            if (data === null) continue;
            const positions = JSON.parse(data)?.positions;
            if (!Array.isArray(positions)) throw new Error('its positions message has no positions');
            return { positions, bytes };
        }
        throw new Error('the stream ended before any positions');
    } catch (err) {
        throw Object.assign(controller.signal.aborted && controller.signal.reason instanceof Error ? controller.signal.reason : err, { bytes });
    } finally {
        clearTimeout(timer);
        // Hangs up, whether the positions came or not
        controller.abort();
    }
}

/**
 * Server-sent events, a piece of text at a time → the data of the first
 * event of type `wanted` once it's whole, or null until then. Other events'
 * data lines are dropped as they come, however long, without being kept
 * (held(): how many characters it holds, for the tests)
 * @param {string} wanted
 */
export function eventReader(wanted) {
    let type = 'message';
    const data = [];
    // The line so far, and whether it's being dropped
    let line = '';
    let dropping = false;
    let found = null;
    const ended = text => {
        const at = text.indexOf(':');
        const field = at < 0 ? text : text.slice(0, at);
        const value = at < 0 ? '' : text.slice(at + 1).replace(/^ /, '');
        if (text === '') {
            if (type === wanted && data.length) found = data.join('\n');
            type = 'message';
            data.length = 0;
        } else if (field === 'event') type = value;
        else if (field === 'data' && type === wanted) data.push(value);
    };
    const read = text => {
        let start = 0;
        for (let end = text.indexOf('\n', start); end >= 0 && found === null; end = text.indexOf('\n', start)) {
            if (!dropping) ended((line + text.slice(start, end)).replace(/\r$/, ''));
            line = '';
            dropping = false;
            start = end + 1;
        }
        if (found !== null) return found;
        if (!dropping) line += text.slice(start);
        // Another event's data: dropped from here to the end of its line
        if (!dropping && type !== wanted && line.startsWith('data:')) {
            dropping = true;
            line = '';
        }
        return null;
    };
    return Object.assign(read, { held: () => line.length + data.reduce((sum, part) => sum + part.length, 0) });
}
