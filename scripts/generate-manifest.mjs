#!/usr/bin/env node
// Memindai folder models/ dan menulis models/manifest.json.
// Jalankan ulang script ini (`node scripts/generate-manifest.mjs`) setiap kali
// menambah/menghapus file splat di folder models/.

import { readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const MODELS_DIR = join(ROOT, 'models');
const MANIFEST_PATH = join(MODELS_DIR, 'manifest.json');

const SUPPORTED_EXT = new Set(['.ply', '.splat', '.sog']);

function titleFromFilename(filename) {
    const base = filename.slice(0, -extname(filename).length);
    return base
        .replace(/[-_]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .replace(/\b\w/g, c => c.toUpperCase());
}

function slugFromFilename(filename) {
    return filename.slice(0, -extname(filename).length)
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
}

const entries = readdirSync(MODELS_DIR)
    .filter(name => SUPPORTED_EXT.has(extname(name).toLowerCase()))
    .map(filename => {
        const stat = statSync(join(MODELS_DIR, filename));
        return {
            id: slugFromFilename(filename),
            title: titleFromFilename(filename),
            file: filename,
            format: extname(filename).slice(1),
            sizeMB: Math.round((stat.size / (1024 * 1024)) * 10) / 10
        };
    })
    .sort((a, b) => a.title.localeCompare(b.title));

writeFileSync(MANIFEST_PATH, JSON.stringify(entries, null, 4) + '\n');
console.log(`Ditulis ${entries.length} model ke ${MANIFEST_PATH}`);
entries.forEach(e => console.log(`  - ${e.title} (${e.file}, ${e.sizeMB} MB)`));
