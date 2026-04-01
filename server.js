import 'dotenv/config';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { startScheduler } from './server/scheduler.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;

const OASA_API_URL = process.env.OASA_API_URL;
if (!OASA_API_URL) {
    console.error('ERROR: OASA_API_URL is not set. Create a .env file with OASA_API_URL=https://your-api-url');
    process.exit(1);
}

// Forward /api/* requests to the OASA API
app.use('/api', async (req, res) => {
    const target = OASA_API_URL.replace(/\/$/, '') + req.url;
    try {
        const apiRes = await fetch(target, {
            method: req.method,
            headers: { 'Content-Type': 'application/json' },
        });
        const data = await apiRes.text();
        res.status(apiRes.status)
           .set('Content-Type', apiRes.headers.get('content-type') || 'application/json')
           .send(data);
    } catch (err) {
        console.error('Proxy error:', err.message);
        res.status(502).json({ error: 'Failed to reach API', details: err.message });
    }
});

app.get('/sw.js', (_req, res) => {
    res.set('Cache-Control', 'no-cache');
    res.sendFile(path.join(__dirname, 'public', 'sw.js'));
});

app.use(express.static(path.join(__dirname, 'public')));

app.get('*splat', (_req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
    console.log(`Move app running at http://localhost:${PORT}`);
    console.log(`Proxying /api/* to ${OASA_API_URL}`);
    startScheduler();
});
