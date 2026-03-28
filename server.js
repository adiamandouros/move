import express from 'express';
import { createProxyMiddleware } from 'http-proxy-middleware';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;

// Proxy API requests to the OASA API server
const OASA_API_URL = process.env.OASA_API_URL || 'http://localhost:3001';
app.use('/api', createProxyMiddleware({
    target: OASA_API_URL,
    changeOrigin: true,
    pathRewrite: { '^/api': '' },
}));

// Serve static frontend files
app.use(express.static(path.join(__dirname, 'public')));

// Fallback: serve index.html for all other routes (SPA support)
app.get('*splat', (_req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
    console.log(`Move app running at http://localhost:${PORT}`);
    console.log(`Proxying API requests to ${OASA_API_URL}`);
});
