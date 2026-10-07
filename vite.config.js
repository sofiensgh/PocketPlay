import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';

const IGNORED_NIC = /vEthernet|WSL|Hyper-V|Loopback|Teredo|isatap|Bluetooth/i;

function lanCandidates() {
    const out = [];
    for (const [name, addrs] of Object.entries(os.networkInterfaces())) {
        if (IGNORED_NIC.test(name)) continue;
        for (const addr of addrs || []) {
            if (addr.family === 'IPv4' && !addr.internal) out.push(addr.address);
        }
    }
    return out;
}

function lanUrlPlugin() {
    const handler = (server) => (req, res, next) => {
        if (req.url !== '/__lan') return next();
        const addr = server.httpServer && server.httpServer.address();
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Cache-Control', 'no-store');
        res.end(JSON.stringify({ candidates: lanCandidates(), port: (addr && addr.port) || 8080 }));
    };
    return {
        name: 'pocketplay:lan-url',
        configureServer(server) {
            server.middlewares.use(handler(server));
        },
        configurePreviewServer(server) {
            server.middlewares.use(handler(server));
        },
    };
}

const DIAG_LOG = path.join(os.tmpdir(), 'pocketplay-diag.log');

function diagPlugin() {
    const handler = (req, res, next) => {
        if (req.url !== '/__diag' || req.method !== 'POST') return next();
        let body = '';
        req.on('data', (chunk) => { body += chunk; });
        req.on('end', () => {
            const line = `${new Date().toISOString()} ${body}\n`;
            fs.appendFile(DIAG_LOG, line, () => {});
            console.log(`[diag] ${body}`);
            res.statusCode = 204;
            res.end();
        });
    };
    return {
        name: 'pocketplay:diag',
        configureServer(server) {
            server.middlewares.use(handler);
        },
        configurePreviewServer(server) {
            server.middlewares.use(handler);
        },
    };
}

export default defineConfig({
    plugins: [lanUrlPlugin(), diagPlugin()],
    server: {
        host: '0.0.0.0',
        port: 8080,
        strictPort: false,
        hmr: {
            clientPort: 8080,
        },
    },
    build: {
        rollupOptions: {
            input: {
                main: fileURLToPath(new URL('./index.html', import.meta.url)),
                controller: fileURLToPath(new URL('./controller.html', import.meta.url)),
            },
        },
    },
});
