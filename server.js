import 'dotenv/config';
import express from 'express';
import { createProxyMiddleware } from 'http-proxy-middleware';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;

const OASA_API_URL = process.env.OASA_API_URL;
if (!OASA_API_URL) {
    console.error('ERROR: OASA_API_URL is not set. Create a .env file with OASA_API_URL=https://your-api-url');
    process.exit(1);
}

app.use('/api', createProxyMiddleware({
    target: OASA_API_URL,
    changeOrigin: true,
    pathRewrite: { '^/api': '' },
}));

app.use(express.static(path.join(__dirname, 'public')));

app.get('*splat', (_req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
    console.log(`Move app running at http://localhost:${PORT}`);
    console.log(`Proxying API requests to ${OASA_API_URL}`);
});
