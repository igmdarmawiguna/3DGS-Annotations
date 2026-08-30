import {
    Application, Asset, AssetListLoader, Entity,
    FILLMODE_FILL_WINDOW, Mat4, RESOLUTION_AUTO, Vec3
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
const modelSearchEmptyEl = document.getElementById('model-search-empty');
const searchInput = document.getElementById('gallery-search-input');
const annotationResultsEl = document.getElementById('annotation-results');
const annotationResultsListEl = document.getElementById('annotation-results-list');
const annotationResultsEmptyEl = document.getElementById('annotation-results-empty');
const viewerEl = document.getElementById('viewer');
const backBtn = document.getElementById('back-to-gallery-btn');

const THUMB_ICONS = { ply: '🏯', splat: '✨', sog: '💎' };

let galleryCards = []; // { model, cardEl }, dipakai buat filter pencarian
let searchableAnnotations = []; // { model, ann } gabungan dari semua model

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

// Ambil anotasi SEMUA model sekaligus (bukan cuma model yang sedang dibuka
// di viewer) supaya kotak pencarian di galeri bisa mencari anotasi lintas
// model. File-nya kecil (JSON per model), jadi aman diambil semua di depan.
async function loadAllAnnotationsForSearch(models) {
    const perModel = await Promise.all(models.map(async model => {
        try {
            const res = await fetch(`./models/annotations/${model.id}.json`, { cache: 'no-store' });
            if (!res.ok) return [];
            const data = await res.json();
            return Array.isArray(data) ? data.map(ann => ({ model, ann })) : [];
        } catch (e) {
            return [];
        }
    }));
    return perModel.flat();
}

function renderGallery(models) {
    gridEl.innerHTML = '';
    galleryCards = [];

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
        galleryCards.push({ model, cardEl: card });
    });
}

// Render daftar anotasi yang cocok dengan kotak pencarian. Tiap hasil bisa
// diklik untuk langsung membuka model 3D yang bersangkutan sekaligus
// menampilkan detail anotasi itu (lihat openModelAtAnnotation()).
function renderAnnotationResults(query) {
    annotationResultsListEl.innerHTML = '';

    if (!query) {
        annotationResultsEl.classList.add('hidden');
        return;
    }

    const matches = searchableAnnotations.filter(({ model, ann }) => {
        const haystack = `${ann.title} ${ann.text || ''} ${model.title}`.toLowerCase();
        return haystack.includes(query);
    });

    annotationResultsEl.classList.remove('hidden');
    annotationResultsEmptyEl.style.display = matches.length === 0 ? 'block' : 'none';

    matches.forEach(({ model, ann }) => {
        const item = document.createElement('button');
        item.className = 'annotation-result';
        item.innerHTML = `
            <div class="annotation-result-main">
                <p class="annotation-result-title"></p>
                <p class="annotation-result-snippet"></p>
            </div>
            <span class="annotation-result-model"></span>
        `;
        item.querySelector('.annotation-result-title').textContent = ann.title;
        item.querySelector('.annotation-result-snippet').textContent = ann.text || 'Tidak ada deskripsi.';
        item.querySelector('.annotation-result-model').textContent = model.title;
        item.addEventListener('click', () => openModelAtAnnotation(model, ann.id));
        annotationResultsListEl.appendChild(item);
    });
}

function applySearch(rawQuery) {
    const query = rawQuery.trim().toLowerCase();

    let anyModelVisible = false;
    galleryCards.forEach(({ model, cardEl }) => {
        const matches = !query || model.title.toLowerCase().includes(query);
        cardEl.classList.toggle('search-hidden', !matches);
        if (matches) anyModelVisible = true;
    });
    modelSearchEmptyEl.classList.toggle('hidden', !query || anyModelVisible || galleryCards.length === 0);

    renderAnnotationResults(query);
}

searchInput.addEventListener('input', (e) => applySearch(e.target.value));

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
searchableAnnotations = await loadAllAnnotationsForSearch(manifest);

// ============================================================
// 2. MODAL ANOTASI (tambah / edit / hapus)
// ============================================================
// Elemen modal ini sudah ada sekali di index.html (bukan dibuat ulang tiap
// pindah model), jadi listener-nya dipasang sekali di sini. Modal ini
// beroperasi lewat `activeSession`, yaitu kumpulan fungsi/array anotasi
// milik viewer yang sedang aktif — supaya modal tidak perlu tahu apa pun
// soal PlayCanvas, dan tidak perlu daftar ulang listener tiap ganti model.

let activeSession = null; // diisi startViewer(): { annotations, saveAnnotations, rebuildPins }
let modalContext = null; // { mode: 'create', worldPoint } atau { mode: 'edit', ann }

const modalEl = document.getElementById('annotation-modal');
const modalKickerEl = document.getElementById('annotation-modal-kicker');
const modalViewTitleEl = document.getElementById('annotation-view-title');
const modalTitleField = document.getElementById('annotation-title-field');
const modalTextLabel = document.getElementById('annotation-text-label');
const modalTitleInput = document.getElementById('annotation-title-input');
const modalTextInput = document.getElementById('annotation-text-input');
const modalSaveBtn = document.getElementById('annotation-save-btn');
const modalCancelBtn = document.getElementById('annotation-cancel-btn');
const modalDeleteBtn = document.getElementById('annotation-delete-btn');

function openAnnotationModal(context) {
    modalContext = context;

    // 'view' dipakai saat "Mode Tambah Anotasi" OFF (atau dari hasil
    // pencarian di galeri): pin/hasil cuma menampilkan isi anotasi, tidak
    // bisa diedit/dihapus dari sini. 'create'/'edit' hanya bisa dipicu saat
    // mode itu ON (lihat canvas & pin click handler di bawah).
    //
    // Di mode view, hierarki tipografinya dibalik dari form biasa: judul
    // anotasi jadi elemen paling menonjol (heading terpisah #annotation-view
    // -title yang bisa wrap multi-baris — input teks biasa tidak bisa),
    // field judul (input) disembunyikan total, dan deskripsi tampil sebagai
    // paragraf biasa. Kicker kecil di atas cuma penanda ringan "ini modal
    // apa", bukan bagian dari konten yang dibaca.
    const readOnly = context.mode === 'view';
    modalTitleInput.readOnly = readOnly;
    modalTextInput.readOnly = readOnly;
    modalTitleField.classList.toggle('hidden', readOnly);
    modalViewTitleEl.classList.toggle('hidden', !readOnly);
    modalTextLabel.classList.toggle('hidden', readOnly);
    modalSaveBtn.classList.toggle('hidden', readOnly);
    modalDeleteBtn.classList.toggle('hidden', readOnly || context.mode === 'create');
    modalCancelBtn.textContent = readOnly ? 'Tutup' : 'Batal';

    if (context.mode === 'create') {
        modalKickerEl.textContent = 'Tambah Anotasi';
        modalTitleInput.value = '';
        modalTextInput.value = '';
        modalTextInput.classList.remove('is-empty');
    } else {
        modalKickerEl.textContent = readOnly ? 'Anotasi' : 'Edit Anotasi';
        modalTitleInput.value = context.ann.title;
        modalViewTitleEl.textContent = context.ann.title;
        const hasText = Boolean(context.ann.text);
        modalTextInput.value = readOnly
            ? (hasText ? context.ann.text : 'Tidak ada deskripsi.')
            : (context.ann.text || '');
        modalTextInput.classList.toggle('is-empty', readOnly && !hasText);
    }

    modalEl.classList.remove('hidden');
    if (!readOnly) modalTitleInput.focus();
}

function closeAnnotationModal() {
    modalEl.classList.add('hidden');
    modalContext = null;
}

modalCancelBtn.addEventListener('click', closeAnnotationModal);

modalEl.addEventListener('click', (e) => {
    if (e.target === modalEl) closeAnnotationModal();
});

// Script "cameraControls" bawaan PlayCanvas mendengarkan keydown/keyup di
// window secara global (lihat KeyboardMouseSource di engine-nya) supaya WASD
// & panah bisa dipakai gerak/orbit kamera dari mana saja, tanpa peduli
// elemen mana yang sedang fokus. Akibatnya, saat modal ini terbuka dan Anda
// mengetik huruf seperti w/a/s/d atau spasi di field judul/deskripsi, huruf
// itu ikut "bocor" ke PlayCanvas dan bikin kamera/model seolah bergerak
// sendiri. Listener di bawah dipasang di fase CAPTURE (parameter `true`)
// pada window, supaya selalu dijalankan lebih dulu daripada listener
// bubble-phase milik PlayCanvas pada node yang sama — lalu stopPropagation()
// mencegah event itu diteruskan ke sana. Ini tidak mengganggu pengetikan
// normal di field (stopPropagation cuma menghentikan event menyebar ke
// elemen lain, bukan membatalkan aksi default seperti mengetik teks).
window.addEventListener('keydown', (e) => {
    if (modalEl.classList.contains('hidden')) return;
    e.stopPropagation();
    if (e.key === 'Escape') closeAnnotationModal();
}, true);

window.addEventListener('keyup', (e) => {
    if (!modalEl.classList.contains('hidden')) e.stopPropagation();
}, true);

modalSaveBtn.addEventListener('click', async () => {
    if (!modalContext || !activeSession) return;

    const title = modalTitleInput.value.trim();
    if (!title) {
        modalTitleInput.focus();
        return;
    }
    const text = modalTextInput.value.trim();

    if (modalContext.mode === 'create') {
        activeSession.annotations.push({
            id: `a_${Date.now()}`,
            position: modalContext.worldPoint,
            title,
            text
        });
    } else {
        modalContext.ann.title = title;
        modalContext.ann.text = text;
    }

    await activeSession.saveAnnotations(activeSession.annotations);
    activeSession.rebuildPins();
    closeAnnotationModal();
});

modalDeleteBtn.addEventListener('click', async () => {
    if (!modalContext || modalContext.mode !== 'edit' || !activeSession) return;
    if (!window.confirm('Hapus anotasi ini?')) return;

    const idx = activeSession.annotations.findIndex(a => a.id === modalContext.ann.id);
    if (idx !== -1) activeSession.annotations.splice(idx, 1);

    await activeSession.saveAnnotations(activeSession.annotations);
    activeSession.rebuildPins();
    closeAnnotationModal();
});

// ============================================================
// 3. VIEWER: dibuat/dihancurkan setiap kali pindah model
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
    activeSession = null;
    closeAnnotationModal();
}

async function openModel(model, options = {}) {
    destroyViewer();
    showViewer();
    await startViewer(model, options);
}

// Dipanggil dari hasil pencarian anotasi di galeri: buka model yang
// bersangkutan lalu langsung tampilkan detail anotasi itu (mode view),
// tanpa pengguna harus mencari-cari pin-nya secara manual.
async function openModelAtAnnotation(model, annotationId) {
    await openModel(model, { focusAnnotationId: annotationId });
}

async function startViewer(model, options = {}) {
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

    // Dipakai nanti untuk menempatkan anotasi (lihat bagian "klik untuk
    // menambah anotasi" di bawah). splatCenters adalah posisi asli tiap
    // titik gaussian (local space, interleaved x,y,z) langsung dari data
    // splat itu sendiri — dipakai untuk mencari titik gaussian terdekat
    // dengan ray klik, supaya anotasi nempel ke splat sungguhan, bukan
    // cuma ke kotak pembatasnya. splatLocalAabb tetap disimpan sebagai
    // fallback kalau tidak ada titik gaussian yang cukup dekat dengan ray.
    const gsplatData = assets[1].resource && assets[1].resource.gsplatData;
    const splatCenters = gsplatData ? gsplatData.getCenters() : null;
    const splatCount = gsplatData ? gsplatData.numSplats : 0;
    const splatLocalAabb = assets[1].resource && assets[1].resource.aabb;

    // -------------------- Sistem anotasi --------------------
    // Setiap anotasi punya: id, position [x, y, z] dalam ruang dunia (world
    // space), title, dan text (deskripsi). Posisi mengikuti sistem koordinat
    // splat itu sendiri. Anotasi disimpan sebagai file JSON asli di
    // models/annotations/<id-model>.json lewat endpoint kecil di server.mjs
    // (GET file statis untuk baca, POST /api/annotations/<id> untuk tulis).

    const ANNOTATIONS_FILE_URL = `./models/annotations/${model.id}.json`;
    const ANNOTATIONS_API_URL = `./api/annotations/${model.id}`;
    let saveErrorShown = false;

    async function loadAnnotationsFromFile() {
        try {
            const res = await fetch(ANNOTATIONS_FILE_URL, { cache: 'no-store' });
            if (!res.ok) return []; // belum pernah ada anotasi untuk model ini
            const data = await res.json();
            return Array.isArray(data) ? data : [];
        } catch (e) {
            console.warn('Gagal memuat anotasi:', e);
            return [];
        }
    }

    async function saveAnnotationsToFile(list) {
        try {
            const res = await fetch(ANNOTATIONS_API_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(list)
            });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
        } catch (e) {
            console.warn('Gagal menyimpan anotasi ke file:', e);
            if (!saveErrorShown) {
                saveErrorShown = true;
                window.alert(
                    'Anotasi tidak tersimpan ke file. Pastikan Anda menjalankan\n\n' +
                    '    node server.mjs\n\n' +
                    'bukan "python3 -m http.server", supaya endpoint penyimpanan tersedia.'
                );
            }
        }
    }

    let annotations = await loadAnnotationsFromFile();
    if (currentApp !== app) return; // pengguna sudah pindah model lagi selama fetch

    const overlay = document.getElementById('annotation-overlay');
    const pinElements = new Map(); // id -> pinEl

    function createPinElement(ann) {
        const pin = document.createElement('div');
        pin.className = 'gsplat-pin';
        pin.title = ann.title;

        const dot = document.createElement('div');
        dot.className = 'gsplat-pin-dot';
        pin.appendChild(dot);

        pin.addEventListener('click', (e) => {
            e.stopPropagation();
            // Klik pin cuma boleh mengedit/menghapus saat "Mode Tambah
            // Anotasi" ON; kalau OFF, cuma menampilkan isinya (read-only).
            openAnnotationModal({ mode: addMode ? 'edit' : 'view', ann });
        });

        overlay.appendChild(pin);
        return pin;
    }

    function rebuildPins() {
        pinElements.forEach(pinEl => pinEl.remove());
        pinElements.clear();
        annotations.forEach(ann => {
            pinElements.set(ann.id, createPinElement(ann));
        });
    }
    rebuildPins();

    activeSession = { annotations, saveAnnotations: saveAnnotationsToFile, rebuildPins };

    // Datang dari hasil pencarian anotasi di galeri (lihat
    // openModelAtAnnotation()): langsung tampilkan detail anotasi yang dicari,
    // tanpa pengguna perlu mencari-cari pin-nya secara manual dulu.
    if (options.focusAnnotationId) {
        const focusedAnn = annotations.find(a => a.id === options.focusAnnotationId);
        if (focusedAnn) openAnnotationModal({ mode: 'view', ann: focusedAnn });
    }

    // Perbarui posisi layar setiap pin, tiap frame.
    const worldPos = new Vec3();
    const screenPos = new Vec3();

    app.on('update', () => {
        const rect = canvas.getBoundingClientRect();

        annotations.forEach(ann => {
            const pinEl = pinElements.get(ann.id);
            if (!pinEl) return;

            worldPos.set(ann.position[0], ann.position[1], ann.position[2]);
            camera.camera.worldToScreen(worldPos, screenPos);

            // screenPos.z < 0 berarti titik berada di belakang kamera (tidak terlihat).
            const behindCamera = screenPos.z < 0;
            const outOfBounds = screenPos.x < 0 || screenPos.x > canvas.clientWidth ||
                                 screenPos.y < 0 || screenPos.y > canvas.clientHeight;

            if (behindCamera || outOfBounds) {
                pinEl.style.display = 'none';
            } else {
                pinEl.style.display = 'block';
                pinEl.style.left = `${rect.left + screenPos.x}px`;
                pinEl.style.top = `${rect.top + screenPos.y}px`;
            }
        });
    });

    // -------------------- Mode "klik untuk menambah anotasi" --------------------
    // Catatan penting: PlayCanvas belum punya picking langsung ke permukaan
    // gaussian splat (berbeda dari mesh biasa yang bisa di-raycast). Sebagai
    // gantinya, klik ditembakkan sebagai ray lalu dicari TITIK GAUSSIAN ASLI
    // (dari splatCenters, data mentah splat itu sendiri) yang paling dekat
    // dengan ray tersebut — lihat findNearestSplatPointIndex(). Ini membuat
    // anotasi benar-benar menempel ke splat sungguhan, bukan cuma ke bentuk
    // pendekatan seperti kotak pembatas atau bidang datar.
    //
    // Kalau tidak ada titik gaussian yang cukup dekat dengan ray (misalnya
    // klik meleset dari siluet model, atau splat sangat jarang di titik itu),
    // dipakai fallback berjenjang: pertama uji tabrakan dengan AABB (bounding
    // box) data splat lewat rayAabbIntersection(), lalu kalau itu juga gagal,
    // taruh titik di bidang datar pada jarak kamera-ke-pusat-splat. Fallback
    // paling akhir ini yang dulu dipakai sebagai satu-satunya metode — titik
    // yang ditaruh di situ sering "melayang" di depan/belakang permukaan
    // sungguhan, sehingga terlihat bergeser relatif terhadap model saat
    // kamera diputar (paralaks), walau posisinya sendiri tetap tidak berubah
    // di ruang dunia. Anotasi tersimpan sebagai file JSON per model lewat
    // modal (lihat bagian 2 di atas).

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

    // Cari titik gaussian (dari splatCenters) yang paling dekat dengan garis
    // ray klik, di antara titik yang ada DI DEPAN kamera (t > 0). Di antara
    // titik yang jaraknya ke ray masih di bawah pickThreshold, dipilih yang
    // t-nya (jarak sepanjang ray) PALING KECIL — ini penting supaya yang
    // kepilih adalah titik permukaan terdepan yang terlihat, bukan titik di
    // balik/dalam model yang kebetulan juga dekat dengan garis ray yang sama.
    // Mengembalikan index ke splatCenters, atau -1 kalau tidak ada yang cukup
    // dekat (misalnya klik meleset dari siluet model).
    function findNearestSplatPointIndex(originLocal, dirLocal) {
        let bestT = Infinity;
        let bestIndex = -1;

        for (let i = 0; i < splatCount; i++) {
            const idx = i * 3;
            const ox = splatCenters[idx] - originLocal.x;
            const oy = splatCenters[idx + 1] - originLocal.y;
            const oz = splatCenters[idx + 2] - originLocal.z;

            const t = ox * dirLocal.x + oy * dirLocal.y + oz * dirLocal.z;
            if (t <= 0 || t >= bestT) continue;

            const perpSq = (ox * ox + oy * oy + oz * oz) - t * t;
            if (perpSq < pickThresholdSq) {
                bestT = t;
                bestIndex = i;
            }
        }

        return bestIndex;
    }

    // Uji ray (origin + t*dir, dalam local space) terhadap AABB axis-aligned
    // memakai slab method. Dipakai sebagai fallback kalau tidak ada titik
    // gaussian yang cukup dekat dengan ray (mis. splat sangat jarang di area
    // itu). Mengembalikan t terkecil yang >= 0, atau null kalau ray tidak
    // menembus box sama sekali / box ada di belakang ray.
    function rayAabbIntersection(originLocal, dirLocal, aabb) {
        const min = {
            x: aabb.center.x - aabb.halfExtents.x,
            y: aabb.center.y - aabb.halfExtents.y,
            z: aabb.center.z - aabb.halfExtents.z
        };
        const max = {
            x: aabb.center.x + aabb.halfExtents.x,
            y: aabb.center.y + aabb.halfExtents.y,
            z: aabb.center.z + aabb.halfExtents.z
        };

        let tMin = -Infinity;
        let tMax = Infinity;

        for (const axis of ['x', 'y', 'z']) {
            const o = originLocal[axis];
            const d = dirLocal[axis];
            if (Math.abs(d) < 1e-8) {
                if (o < min[axis] || o > max[axis]) return null;
                continue;
            }
            let t1 = (min[axis] - o) / d;
            let t2 = (max[axis] - o) / d;
            if (t1 > t2) [t1, t2] = [t2, t1];
            tMin = Math.max(tMin, t1);
            tMax = Math.min(tMax, t2);
            if (tMin > tMax) return null;
        }

        if (tMax < 0) return null; // box ada di belakang ray
        return tMin >= 0 ? tMin : tMax;
    }

    // Ambang batas jarak tegak lurus (dari ray ke titik gaussian) yang masih
    // dianggap "kena", diskalakan relatif ke ukuran model (persentase kecil
    // dari diagonal AABB-nya) supaya masuk akal untuk model besar maupun kecil.
    const splatDiagonal = splatLocalAabb ? splatLocalAabb.halfExtents.length() * 2 : 1;
    const pickThreshold = Math.max(splatDiagonal * 0.01, 0.005);
    const pickThresholdSq = pickThreshold * pickThreshold;

    const rayOriginLocal = new Vec3();
    const rayDirLocal = new Vec3();
    const rayFarWorld = new Vec3();
    const hitLocalPoint = new Vec3();
    const clickWorldPoint = new Vec3();
    const invSplatTransform = new Mat4();

    canvas.addEventListener('click', (e) => {
        if (!addMode) return;

        const rect = canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;

        const targetDistance = camera.getPosition().distance(splat.getPosition()) || 2.5;

        let hitFound = false;

        if (splatCenters || splatLocalAabb) {
            // Ambil dua titik di sepanjang ray klik untuk dapat arahnya, lalu
            // pindahkan ray itu ke local space splat (tempat splatCenters dan
            // splatLocalAabb disimpan).
            camera.camera.screenToWorld(x, y, targetDistance, rayFarWorld);
            invSplatTransform.copy(splat.getWorldTransform()).invert();
            invSplatTransform.transformPoint(camera.getPosition(), rayOriginLocal);
            invSplatTransform.transformPoint(rayFarWorld, rayDirLocal);
            rayDirLocal.sub(rayOriginLocal).normalize();

            const nearestIdx = splatCenters ? findNearestSplatPointIndex(rayOriginLocal, rayDirLocal) : -1;

            if (nearestIdx !== -1) {
                hitLocalPoint.set(
                    splatCenters[nearestIdx * 3],
                    splatCenters[nearestIdx * 3 + 1],
                    splatCenters[nearestIdx * 3 + 2]
                );
                splat.getWorldTransform().transformPoint(hitLocalPoint, clickWorldPoint);
                hitFound = true;
            } else if (splatLocalAabb) {
                const t = rayAabbIntersection(rayOriginLocal, rayDirLocal, splatLocalAabb);
                if (t !== null) {
                    hitLocalPoint.copy(rayDirLocal).mulScalar(t).add(rayOriginLocal);
                    splat.getWorldTransform().transformPoint(hitLocalPoint, clickWorldPoint);
                    hitFound = true;
                }
            }
        }

        if (!hitFound) {
            // Fallback terakhir: bidang datar pada jarak kamera-ke-pusat-splat,
            // dipakai kalau klik benar-benar meleset dari model atau data
            // splat tidak tersedia.
            camera.camera.screenToWorld(x, y, targetDistance, clickWorldPoint);
        }

        openAnnotationModal({
            mode: 'create',
            worldPoint: [
                Math.round(clickWorldPoint.x * 1000) / 1000,
                Math.round(clickWorldPoint.y * 1000) / 1000,
                Math.round(clickWorldPoint.z * 1000) / 1000
            ]
        });
    });
}
