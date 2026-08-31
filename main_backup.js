import {
    Application, Asset, AssetListLoader, Entity,
    FILLMODE_FILL_WINDOW, RESOLUTION_AUTO, Vec3
} from 'playcanvas';

// ============================================================
// 1. GALERI: muat daftar model dari models/manifest.json
// ============================================================
// manifest.json dibuat otomatis oleh scripts/generate-manifest.mjs
// dengan memindai isi folder models/. Jalankan ulang script itu setiap
// kali menambah atau menghapus file splat.

const galleryEl = document.getElementById('gallery');
const gridEl = document.getElementById('model-grid');
const emptyEl = document.getElementById('gallery-empty');
const viewerEl = document.getElementById('viewer');
const backBtn = document.getElementById('back-to-gallery-btn');

const THUMB_ICONS = { ply: '🏯', splat: '✨', sog: '💎' };

async function loadManifest() {
    try {
        const res = await fetch('./models/manifest.json', { cache: 'no-store' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return await res.json();
    } catch (e) {
        console.error('Gagal memuat models/manifest.json:', e);
        return [];
    }
}

function renderGallery(models) {
    gridEl.innerHTML = '';

    if (models.length === 0) {
        emptyEl.style.display = 'block';
        return;
    }
    emptyEl.style.display = 'none';

    models.forEach(model => {
        const card = document.createElement('button');
        card.className = 'model-card';

        const thumb = document.createElement('div');
        thumb.className = 'model-card-thumb';
        thumb.textContent = THUMB_ICONS[model.format] || '📦';
        card.appendChild(thumb);

        const body = document.createElement('div');
        body.className = 'model-card-body';
        body.innerHTML = `
            <p class="model-card-title"></p>
            <p class="model-card-meta"></p>
        `;
        body.querySelector('.model-card-title').textContent = model.title;
        body.querySelector('.model-card-meta').textContent =
            `.${model.format} · ${model.sizeMB} MB`;
        card.appendChild(body);

        card.addEventListener('click', () => openModel(model));
        gridEl.appendChild(card);
    });
}

function showGallery() {
    galleryEl.classList.remove('hidden');
    viewerEl.classList.add('hidden');
}

function showViewer() {
    galleryEl.classList.add('hidden');
    viewerEl.classList.remove('hidden');
}

backBtn.addEventListener('click', () => {
    showGallery();
    destroyViewer();
});

const manifest = await loadManifest();
renderGallery(manifest);

// ============================================================
// 2. VIEWER: dibuat/dihancurkan setiap kali pindah model
// ============================================================

let currentApp = null;
let currentCanvas = null;

function destroyViewer() {
    if (currentApp) {
        currentApp.destroy();
        currentApp = null;
    }
    if (currentCanvas) {
        currentCanvas.remove();
        currentCanvas = null;
    }
    document.getElementById('annotation-overlay').innerHTML = '';
    const oldToggleBtn = document.getElementById('add-annotation-btn');
    if (oldToggleBtn) oldToggleBtn.remove();
}

async function openModel(model) {
    destroyViewer();
    showViewer();
    await startViewer(model);
}

async function startViewer(model) {
    const canvas = document.createElement('canvas');
    document.body.appendChild(canvas);
    currentCanvas = canvas;

    const app = new Application(canvas, {
        graphicsDeviceOptions: { antialias: false }
    });
    currentApp = app;

    app.setCanvasFillMode(FILLMODE_FILL_WINDOW);
    app.setCanvasResolution(RESOLUTION_AUTO);

    // Batasi device pixel ratio ke 1 supaya tidak render di resolusi HiDPI
    // penuh. Splat rendering berat di fragment shader (overdraw + alpha
    // blending), jadi ini cukup berpengaruh terutama untuk splat berukuran
    // ratusan ribu ke atas. Hapus baris ini kalau Anda lebih mengutamakan
    // ketajaman visual di layar retina.
    app.graphicsDevice.maxPixelRatio = 1;

    app.start();
    const onResize = () => app.resizeCanvas();
    window.addEventListener('resize', onResize);
    app.once('destroy', () => window.removeEventListener('resize', onResize));

    // -------------------- Muat aset --------------------

    const SPLAT_URL = `./models/${model.file}`;

    const assets = [
        new Asset('camera-controls', 'script', {
            url: 'https://cdn.jsdelivr.net/npm/playcanvas/scripts/esm/camera-controls.mjs'
        }),
        new Asset('splat', 'gsplat', { url: SPLAT_URL })
    ];

    const loader = new AssetListLoader(assets, app.assets);
    await new Promise(resolve => loader.load(resolve));

    if (currentApp !== app) return; // pengguna sudah pindah model lagi

    // -------------------- Kamera --------------------

    const camera = new Entity('Camera');
    camera.setPosition(0, 0, 2.5);
    camera.addComponent('camera');
    camera.addComponent('script');
    camera.script.create('cameraControls');
    app.root.addChild(camera);

    // -------------------- Splat --------------------

    const splat = new Entity('Splat');
    splat.addComponent('gsplat', { asset: assets[1] });
    app.root.addChild(splat);

    // -------------------- Sistem anotasi --------------------
    // Setiap anotasi punya: id, position [x, y, z] dalam ruang dunia (world
    // space), title, dan text (deskripsi). Posisi mengikuti sistem koordinat
    // splat itu sendiri. Anotasi disimpan terpisah per model (localStorage
    // key mengikuti id model).

    const STORAGE_KEY = `gsplatAnnotations:${model.id}`;

    function loadAnnotations() {
        try {
            const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
            return Array.isArray(saved) ? saved : [];
        } catch (e) {
            return [];
        }
    }

    function saveAnnotations(list) {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
        } catch (e) {
            console.warn('Gagal menyimpan anotasi ke localStorage:', e);
        }
    }

    let annotations = loadAnnotations();

    const overlay = document.getElementById('annotation-overlay');
    const pinElements = new Map(); // id -> { pinEl, labelEl }

    function escapeHtml(str) {
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    function createPinElement(ann) {
        const pin = document.createElement('div');
        pin.className = 'gsplat-pin';
        pin.title = ann.title;

        const dot = document.createElement('div');
        dot.className = 'gsplat-pin-dot';
        pin.appendChild(dot);

        const label = document.createElement('div');
        label.className = 'gsplat-pin-label';
        label.innerHTML = `<strong>${escapeHtml(ann.title)}</strong><br>${escapeHtml(ann.text || '')}`;
        label.style.display = 'none';
        pin.appendChild(label);

        pin.addEventListener('click', (e) => {
            e.stopPropagation();
            const willShow = label.style.display !== 'block';
            document.querySelectorAll('.gsplat-pin-label').forEach(el => { el.style.display = 'none'; });
            label.style.display = willShow ? 'block' : 'none';
        });

        overlay.appendChild(pin);
        return { pinEl: pin, labelEl: label };
    }

    function rebuildPins() {
        pinElements.forEach(({ pinEl }) => pinEl.remove());
        pinElements.clear();
        annotations.forEach(ann => {
            pinElements.set(ann.id, createPinElement(ann));
        });
    }
    rebuildPins();

    // Perbarui posisi layar setiap pin, tiap frame.
    const worldPos = new Vec3();
    const screenPos = new Vec3();

    app.on('update', () => {
        const rect = canvas.getBoundingClientRect();

        annotations.forEach(ann => {
            const entry = pinElements.get(ann.id);
            if (!entry) return;

            worldPos.set(ann.position[0], ann.position[1], ann.position[2]);
            camera.camera.worldToScreen(worldPos, screenPos);

            // screenPos.z < 0 berarti titik berada di belakang kamera (tidak terlihat).
            const behindCamera = screenPos.z < 0;
            const outOfBounds = screenPos.x < 0 || screenPos.x > canvas.clientWidth ||
                                 screenPos.y < 0 || screenPos.y > canvas.clientHeight;

            if (behindCamera || outOfBounds) {
                entry.pinEl.style.display = 'none';
            } else {
                entry.pinEl.style.display = 'block';
                entry.pinEl.style.left = `${rect.left + screenPos.x}px`;
                entry.pinEl.style.top = `${rect.top + screenPos.y}px`;
            }
        });
    });

    // -------------------- Mode "klik untuk menambah anotasi" --------------------
    // Catatan penting: PlayCanvas belum punya picking langsung ke permukaan
    // gaussian splat (berbeda dari mesh biasa). Jadi titik baru ditempatkan
    // pada jarak tertentu di sepanjang arah klik, diukur dari kamera ke pusat
    // splat saat ini. Anotasi tersimpan otomatis di localStorage per model.

    let addMode = false;

    const toggleBtn = document.createElement('button');
    toggleBtn.id = 'add-annotation-btn';
    toggleBtn.textContent = 'Mode Tambah Anotasi: OFF';
    document.body.appendChild(toggleBtn);

    toggleBtn.addEventListener('click', () => {
        addMode = !addMode;
        toggleBtn.textContent = `Mode Tambah Anotasi: ${addMode ? 'ON' : 'OFF'}`;
        toggleBtn.classList.toggle('active', addMode);
    });

    const clickWorldPoint = new Vec3();

    canvas.addEventListener('click', (e) => {
        if (!addMode) return;

        const rect = canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;

        const targetDistance = camera.getPosition().distance(splat.getPosition()) || 2.5;
        camera.camera.screenToWorld(x, y, targetDistance, clickWorldPoint);

        const title = window.prompt('Judul anotasi:', 'Anotasi baru');
        if (title === null) return; // dibatalkan
        const text = window.prompt('Deskripsi (opsional):', '') || '';

        const newAnn = {
            id: `a_${Date.now()}`,
            position: [
                Math.round(clickWorldPoint.x * 1000) / 1000,
                Math.round(clickWorldPoint.y * 1000) / 1000,
                Math.round(clickWorldPoint.z * 1000) / 1000
            ],
            title,
            text
        };

        annotations.push(newAnn);
        saveAnnotations(annotations);
        rebuildPins();

        console.log('Anotasi baru ditambahkan (tersimpan di localStorage):', newAnn);
    });
}
