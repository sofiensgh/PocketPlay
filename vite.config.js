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

// Room code -> hostPeerId map so controller.html?room=XXXX (manual entry)
// can resolve the host without a QR code. One server instance, one lobby.
const roomRegistry = new Map();

function lobbyPlugin() {
    const handler = (req, res, next) => {
        if (req.url !== '/__lobby' || req.method !== 'POST') return next();
        let body = '';
        req.on('data', (chunk) => { body += chunk; });
        req.on('end', () => {
            try {
                const { room, hostPeerId } = JSON.parse(body);
                if (room && hostPeerId) roomRegistry.set(room.toUpperCase(), hostPeerId);
            } catch (err) {
                console.warn('[lobby] bad register', err);
            }
            res.statusCode = 204;
            res.end();
        });
    };
    const resolver = (req, res, next) => {
        const url = new URL(req.url, 'http://localhost');
        if (url.pathname !== '/__lobby' || req.method !== 'GET') return next();
        const room = (url.searchParams.get('room') || '').toUpperCase();
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Cache-Control', 'no-store');
        res.end(JSON.stringify({ hostPeerId: roomRegistry.get(room) || null }));
    };
    return {
        name: 'pocketplay:lobby',
        configureServer(server) {
            server.middlewares.use(handler);
            server.middlewares.use(resolver);
        },
        configurePreviewServer(server) {
            server.middlewares.use(handler);
            server.middlewares.use(resolver);
        },
    };
}

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
    plugins: [lanUrlPlugin(), diagPlugin(), lobbyPlugin()],
    server: {
        host: '0.0.0.0',
        port: 8081,
        strictPort: true,
        hmr: {
            clientPort: 8081,
            // Don't paint the full-screen "server connection lost" overlay over the
            // page: it blocks every click until the dev server recovers.
            overlay: false,
        },
    },
    build: {
        rollupOptions: {
            input: {
                main: fileURLToPath(new URL('./index.html', import.meta.url)),
                screen: fileURLToPath(new URL('./screen.html', import.meta.url)),
                controller: fileURLToPath(new URL('./controller.html', import.meta.url)),
            },
        },
    },
});
