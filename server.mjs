#!/usr/bin/env node
// Static file server + endpoint penyimpanan anotasi, tanpa dependency
// tambahan (cuma modul bawaan Node). Dipakai sebagai pengganti
// `python3 -m http.server` supaya anotasi bisa ditulis ke file JSON asli
// di models/annotations/, bukan cuma localStorage browser.
//
// Jalankan: node server.mjs [port]   (default port 8000)

import { createServer } from 'node:http';
import { readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { join, extname, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.argv[2]) || Number(process.env.PORT) || 8000;
const ANNOTATIONS_DIR = join(ROOT, 'models', 'annotations');

const MIME_TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.ply': 'application/octet-stream',
    '.splat': 'application/octet-stream',
    '.sog': 'application/octet-stream',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.svg': 'image/svg+xml'
};

// Hanya izinkan id model berformat slug (huruf kecil/angka/strip), sesuai
// yang dihasilkan scripts/generate-manifest.mjs, supaya tidak bisa dipakai
// untuk keluar dari folder models/annotations/ (path traversal).
const SAFE_MODEL_ID = /^[a-z0-9-]+$/;

async function handleSaveAnnotations(req, res, modelId) {
    if (!SAFE_MODEL_ID.test(modelId)) {
        res.writeHead(400, { 'Content-Type': 'text/plain' }).end('id model tidak valid');
        return;
    }
    if (req.method !== 'POST') {
        res.writeHead(405, { 'Content-Type': 'text/plain' }).end('method not allowed');
        return;
    }

    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = Buffer.concat(chunks).toString('utf-8');

    let list;
    try {
        list = JSON.parse(body);
    } catch {
        res.writeHead(400, { 'Content-Type': 'text/plain' }).end('body bukan JSON valid');
        return;
    }
    if (!Array.isArray(list)) {
        res.writeHead(400, { 'Content-Type': 'text/plain' }).end('body harus berupa array anotasi');
        return;
    }

    await mkdir(ANNOTATIONS_DIR, { recursive: true });
    await writeFile(join(ANNOTATIONS_DIR, `${modelId}.json`), JSON.stringify(list, null, 4) + '\n');
    res.writeHead(200, { 'Content-Type': 'application/json' }).end('{"ok":true}');
}

async function handleStaticFile(req, res, pathname) {
    if (pathname === '/') pathname = '/index.html';
    const filePath = normalize(join(ROOT, decodeURIComponent(pathname)));

    if (!filePath.startsWith(ROOT)) {
        res.writeHead(403, { 'Content-Type': 'text/plain' }).end('forbidden');
        return;
    }

    try {
        const st = await stat(filePath);
        if (st.isDirectory()) {
            res.writeHead(404, { 'Content-Type': 'text/plain' }).end('not found');
            return;
        }
        const data = await readFile(filePath);
        const mime = MIME_TYPES[extname(filePath).toLowerCase()] || 'application/octet-stream';
        res.writeHead(200, { 'Content-Type': mime }).end(data);
    } catch (e) {
        if (e.code === 'ENOENT') {
            res.writeHead(404, { 'Content-Type': 'text/plain' }).end('not found');
        } else {
            res.writeHead(500, { 'Content-Type': 'text/plain' }).end('server error');
        }
    }
}

const server = createServer(async (req, res) => {
    try {
        const url = new URL(req.url, `http://${req.headers.host}`);
        const apiMatch = url.pathname.match(/^\/api\/annotations\/([^/]+)$/);

        if (apiMatch) {
            await handleSaveAnnotations(req, res, apiMatch[1]);
        } else {
            await handleStaticFile(req, res, url.pathname);
        }
    } catch (e) {
        console.error(e);
        res.writeHead(500, { 'Content-Type': 'text/plain' }).end('server error');
    }
});

server.listen(PORT, () => {
    console.log(`Server jalan di http://localhost:${PORT}`);
    console.log(`Anotasi disimpan sebagai file JSON di ${ANNOTATIONS_DIR}`);
});
