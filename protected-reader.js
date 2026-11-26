/**
 * Accord Archive — Protected Book Encryption, IndexedDB Cache & Page-by-Page Reader
 * Uses Web Crypto API (AES-256-GCM), IndexedDB for origin-private device caching,
 * and PDF.js for page-by-page canvas rendering without exposing downloadable files.
 */
(function (global) {
    'use strict';

    const IDB_NAME = 'accord_protected_books_db';
    const IDB_VERSION = 1;
    const IDB_STORE = 'encrypted_books';
    const MAGIC = [0x41, 0x43, 0x52, 0x44]; // "ACRD"
    const FORMAT_VERSION = 1;
    const PDFJS_CDN = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
    const PDFJS_WORKER_CDN = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

    function bytesToB64(bytes) {
        let binary = '';
        const chunkSize = 0x8000;
        for (let i = 0; i < bytes.length; i += chunkSize) {
            const chunk = bytes.subarray(i, i + chunkSize);
            binary += String.fromCharCode.apply(null, chunk);
        }
        return btoa(binary);
    }

    function b64ToBytes(b64) {
        const binary = atob(String(b64 || '').trim());
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) {
            bytes[i] = binary.charCodeAt(i);
        }
        return bytes;
    }

    async function generateBookKeyB64() {
        const key = await crypto.subtle.generateKey(
            { name: 'AES-GCM', length: 256 },
            true,
            ['encrypt', 'decrypt']
        );
        const raw = await crypto.subtle.exportKey('raw', key);
        return bytesToB64(new Uint8Array(raw));
    }

    async function importAesKey(keyB64) {
        const raw = b64ToBytes(keyB64);
        return crypto.subtle.importKey(
            'raw',
            raw,
            { name: 'AES-GCM' },
            false,
            ['encrypt', 'decrypt']
        );
    }

    async function encryptFileBuffer(arrayBuffer, keyB64) {
        const aesKey = await importAesKey(keyB64);
        const iv = crypto.getRandomValues(new Uint8Array(12));
        const cipherBuffer = await crypto.subtle.encrypt(
            { name: 'AES-GCM', iv },
            aesKey,
            arrayBuffer
        );
        const cipherBytes = new Uint8Array(cipherBuffer);
        const out = new Uint8Array(4 + 1 + 12 + cipherBytes.length);
        out.set(MAGIC, 0);
        out[4] = FORMAT_VERSION;
        out.set(iv, 5);
        out.set(cipherBytes, 17);
        return new Blob([out], { type: 'application/octet-stream' });
    }

    async function decryptBuffer(encryptedArrayBuffer, keyB64) {
        const bytes = new Uint8Array(encryptedArrayBuffer);
        if (
            bytes.length < 18 ||
            bytes[0] !== MAGIC[0] ||
            bytes[1] !== MAGIC[1] ||
            bytes[2] !== MAGIC[2] ||
            bytes[3] !== MAGIC[3] ||
            bytes[4] !== FORMAT_VERSION
        ) {
            throw new Error('Invalid or unsupported encrypted book format.');
        }
        const iv = bytes.subarray(5, 17);
        const cipherBytes = bytes.subarray(17);
        const aesKey = await importAesKey(keyB64);
        const plainBuffer = await crypto.subtle.decrypt(
            { name: 'AES-GCM', iv },
            aesKey,
            cipherBytes
        );
        return new Uint8Array(plainBuffer);
    }

    function openProtectedDb() {
        return new Promise((resolve, reject) => {
            if (!('indexedDB' in global)) {
                reject(new Error('IndexedDB is not supported in this browser.'));
                return;
            }
            const req = indexedDB.open(IDB_NAME, IDB_VERSION);
            req.onupgradeneeded = () => {
                const db = req.result;
                if (!db.objectStoreNames.contains(IDB_STORE)) {
                    db.createObjectStore(IDB_STORE, { keyPath: 'bookId' });
                }
            };
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error || new Error('Failed to open local cache.'));
        });
    }

    async function getCachedEncryptedBook(bookId) {
        try {
            const db = await openProtectedDb();
            return await new Promise((resolve, reject) => {
                const tx = db.transaction(IDB_STORE, 'readonly');
                const store = tx.objectStore(IDB_STORE);
                const req = store.get(String(bookId));
                req.onsuccess = () => resolve(req.result || null);
                req.onerror = () => reject(req.error);
            });
        } catch (err) {
            console.warn('IndexedDB read warning:', err);
            return null;
        }
    }

    async function putCachedEncryptedBook(record) {
        try {
            const db = await openProtectedDb();
            await new Promise((resolve, reject) => {
                const tx = db.transaction(IDB_STORE, 'readwrite');
                const store = tx.objectStore(IDB_STORE);
                const req = store.put(record);
                req.onsuccess = () => resolve();
                req.onerror = () => reject(req.error);
            });
        } catch (err) {
            console.warn('IndexedDB write warning:', err);
        }
    }

    function sanitizeFileBase(name) {
        const base = String(name || 'document').replace(/\.[^/.]+$/, '');
        return base.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 60) || 'document';
    }

    /**
     * Uploads original file to private `books-master` bucket AND encrypted `.enc` to `archive-files/protected/`.
     */
    async function uploadProtectedBookAssets({ supabaseClient, file, bookTitle }) {
        if (!supabaseClient) throw new Error('Supabase client is required.');
        if (!file) throw new Error('File is required.');

        const safeBase = sanitizeFileBase(file.name || bookTitle);
        const stamp = Date.now();
        const extMatch = String(file.name || '').match(/\.[a-zA-Z0-9]+$/);
        const ext = extMatch ? extMatch[0].toLowerCase() : '.pdf';

        // 1. Store original unencrypted PDF in private `books-master` vault
        const masterFilePath = `masters/${safeBase}_master_${stamp}${ext}`;
        const { error: masterErr } = await supabaseClient.storage
            .from('books-master')
            .upload(masterFilePath, file, {
                contentType: file.type || 'application/pdf',
                cacheControl: '3600',
                upsert: false
            });

        if (masterErr) {
            throw new Error(`Master vault upload failed: ${masterErr.message}`);
        }

        // 2. Encrypt file in-browser and upload `.enc` to `archive-files/protected/`
        const keyB64 = await generateBookKeyB64();
        const plainBuffer = await file.arrayBuffer();
        const encryptedBlob = await encryptFileBuffer(plainBuffer, keyB64);

        const encPath = `protected/${safeBase}_enc_${stamp}.enc`;
        const { data: encUp, error: encErr } = await supabaseClient.storage
            .from('archive-files')
            .upload(encPath, encryptedBlob, {
                contentType: 'application/octet-stream',
                cacheControl: '31536000',
                upsert: false
            });

        if (encErr) {
            throw new Error(`Encrypted bundle upload failed: ${encErr.message}`);
        }

        const { data: pubData } = supabaseClient.storage
            .from('archive-files')
            .getPublicUrl(encUp.path);

        return {
            masterFilePath,
            encryptedUrl: pubData.publicUrl,
            keyB64
        };
    }

    /**
     * Uploads only the original file to private `books-master` (used when saving a downloadable book so we still have a master copy if toggled later).
     */
    async function uploadMasterOnly({ supabaseClient, file, bookTitle }) {
        const safeBase = sanitizeFileBase(file.name || bookTitle);
        const extMatch = String(file.name || '').match(/\.[a-zA-Z0-9]+$/);
        const ext = extMatch ? extMatch[0].toLowerCase() : '.pdf';
        const masterFilePath = `masters/${safeBase}_master_${Date.now()}${ext}`;

        const { error } = await supabaseClient.storage
            .from('books-master')
            .upload(masterFilePath, file, {
                contentType: file.type || 'application/pdf',
                cacheControl: '3600',
                upsert: false
            });
        if (error) throw new Error(`Master vault upload failed: ${error.message}`);
        return masterFilePath;
    }

    /**
     * Generates a short-lived signed URL for admins/company to download the original PDF from `books-master`.
     */
    async function getMasterDownloadUrl({ supabaseClient, masterFilePath, expiresInSeconds = 120 }) {
        if (!masterFilePath) throw new Error('No master PDF path recorded for this book.');
        const { data, error } = await supabaseClient.storage
            .from('books-master')
            .createSignedUrl(masterFilePath, expiresInSeconds);
        if (error || !data?.signedUrl) {
            throw new Error(error?.message || 'Could not generate master PDF download link.');
        }
        return data.signedUrl;
    }

    /**
     * Converts an existing unencrypted book (from `master_file_path` or `download_url`) into an encrypted bundle.
     */
    async function encryptExistingBook({ supabaseClient, book }) {
        let sourceUrl = '';
        let masterPath = book.master_file_path || '';

        if (masterPath) {
            sourceUrl = await getMasterDownloadUrl({ supabaseClient, masterFilePath: masterPath, expiresInSeconds: 300 });
        } else if (book.download_url) {
            sourceUrl = book.download_url.includes('/archive-files/')
                ? book.download_url.split('?')[0]
                : book.download_url;
        } else {
            throw new Error('This book has no source PDF file to encrypt.');
        }

        const resp = await fetch(sourceUrl);
        if (!resp.ok) {
            throw new Error(`Could not fetch source PDF (HTTP ${resp.status}). External hosts without CORS must be uploaded directly.`);
        }
        const plainBuffer = await resp.arrayBuffer();
        const blob = new Blob([plainBuffer], { type: 'application/pdf' });
        const fileName = `${sanitizeFileBase(book.title)}.pdf`;
        const file = new File([blob], fileName, { type: 'application/pdf' });

        if (!masterPath) {
            masterPath = await uploadMasterOnly({ supabaseClient, file, bookTitle: book.title });
        }

        const keyB64 = await generateBookKeyB64();
        const encryptedBlob = await encryptFileBuffer(plainBuffer, keyB64);
        const encPath = `protected/${sanitizeFileBase(book.title)}_enc_${Date.now()}.enc`;

        const { data: encUp, error: encErr } = await supabaseClient.storage
            .from('archive-files')
            .upload(encPath, encryptedBlob, {
                contentType: 'application/octet-stream',
                cacheControl: '31536000',
                upsert: false
            });

        if (encErr) throw new Error(`Encrypted bundle upload failed: ${encErr.message}`);

        const { data: pubData } = supabaseClient.storage
            .from('archive-files')
            .getPublicUrl(encUp.path);

        const { error: keyErr } = await supabaseClient
            .from('book_encryption_keys')
            .upsert({
                book_id: Number(book.id),
                key_b64: keyB64,
                algorithm: 'AES-GCM-256',
                updated_at: new Date().toISOString()
            });

        if (keyErr) throw new Error(`Failed to save encryption key: ${keyErr.message}`);

        return {
            masterFilePath: masterPath,
            encryptedUrl: pubData.publicUrl
        };
    }

    async function saveBookEncryptionKey({ supabaseClient, bookId, keyB64 }) {
        const { error } = await supabaseClient
            .from('book_encryption_keys')
            .upsert({
                book_id: Number(bookId),
                key_b64: keyB64,
                algorithm: 'AES-GCM-256',
                updated_at: new Date().toISOString()
            });
        if (error) {
            throw new Error(`Failed to store encryption key: ${error.message}`);
        }
    }

    function loadPdfJs() {
        if (global.pdfjsLib) {
            global.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER_CDN;
            return Promise.resolve(global.pdfjsLib);
        }
        return new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = PDFJS_CDN;
            script.onload = () => {
                if (global.pdfjsLib) {
                    global.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER_CDN;
                    resolve(global.pdfjsLib);
                } else {
                    reject(new Error('PDF.js failed to initialize.'));
                }
            };
            script.onerror = () => reject(new Error('Failed to load PDF reader library.'));
            document.head.appendChild(script);
        });
    }

    function ensureReaderModalDom() {
        let modal = document.getElementById('accord-protected-reader-modal');
        if (modal) return modal;

        const style = document.createElement('style');
        style.textContent = `
            #accord-protected-reader-modal {
                user-select: none;
                -webkit-user-select: none;
                -webkit-touch-callout: none;
            }
            @media print {
                #accord-protected-reader-modal { display: none !important; }
            }
        `;
        document.head.appendChild(style);

        modal = document.createElement('div');
        modal.id = 'accord-protected-reader-modal';
        modal.className = 'fixed inset-0 z-[90] hidden bg-slate-950/95 backdrop-blur-sm flex-col';
        modal.innerHTML = `
            <div class="flex items-center justify-between gap-3 px-4 py-3 bg-slate-900 border-b border-slate-800 text-white shrink-0">
                <div class="min-w-0">
                    <p id="apr-book-title" class="text-xs sm:text-sm font-bold truncate"></p>
                    <p id="apr-status-line" class="text-[10px] text-slate-400">Protected In-App Reader • Offline Cached</p>
                </div>
                <div class="flex items-center gap-2 shrink-0">
                    <button type="button" id="apr-zoom-out" class="w-8 h-8 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs flex items-center justify-center" title="Zoom Out"><i class="fa-solid fa-magnifying-glass-minus"></i></button>
                    <button type="button" id="apr-zoom-in" class="w-8 h-8 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs flex items-center justify-center" title="Zoom In"><i class="fa-solid fa-magnifying-glass-plus"></i></button>
                    <button type="button" id="apr-close-btn" class="px-3 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-700 text-xs font-bold">Close</button>
                </div>
            </div>

            <div id="apr-stage" class="flex-1 overflow-auto flex items-center justify-center p-3 sm:p-6 relative">
                <div id="apr-loading" class="text-center text-slate-300 space-y-3">
                    <div class="w-10 h-10 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto"></div>
                    <p id="apr-loading-text" class="text-xs font-semibold">Decrypting publication...</p>
                </div>
                <div id="apr-canvas-wrap" class="hidden relative shadow-2xl rounded-lg overflow-hidden bg-white">
                    <canvas id="apr-canvas" class="block max-w-full h-auto"></canvas>
                    <div id="apr-watermark" class="pointer-events-none absolute inset-0 flex items-end justify-end p-3 opacity-25 text-[10px] font-bold text-slate-700 select-none"></div>
                </div>
            </div>

            <div class="flex items-center justify-between gap-3 px-4 py-3 bg-slate-900 border-t border-slate-800 text-white shrink-0">
                <button type="button" id="apr-prev-btn" class="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-xs font-bold flex items-center gap-1.5">
                    <i class="fa-solid fa-chevron-left"></i><span>Prev</span>
                </button>
                <div class="flex items-center gap-2 text-xs font-semibold">
                    <span>Page</span>
                    <input type="number" id="apr-page-input" min="1" value="1" class="w-14 bg-slate-800 border border-slate-700 rounded-lg px-2 py-1 text-center text-xs text-white focus:outline-none">
                    <span id="apr-page-total" class="text-slate-400">/ 1</span>
                </div>
                <button type="button" id="apr-next-btn" class="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-xs font-bold flex items-center gap-1.5">
                    <span>Next</span><i class="fa-solid fa-chevron-right"></i>
                </button>
            </div>
        `;
        document.body.appendChild(modal);

        modal.addEventListener('contextmenu', (e) => e.preventDefault());
        return modal;
    }

    async function openProtectedReaderModal({ supabaseClient, book, userEmail = '' }) {
        if (!book) throw new Error('Book is required.');
        if (!book.encrypted_url) {
            throw new Error('This protected publication is not encrypted yet.');
        }

        const modal = ensureReaderModalDom();
        const titleEl = document.getElementById('apr-book-title');
        const statusEl = document.getElementById('apr-status-line');
        const loadingEl = document.getElementById('apr-loading');
        const loadingTextEl = document.getElementById('apr-loading-text');
        const canvasWrap = document.getElementById('apr-canvas-wrap');
        const canvas = document.getElementById('apr-canvas');
        const watermarkEl = document.getElementById('apr-watermark');
        const prevBtn = document.getElementById('apr-prev-btn');
        const nextBtn = document.getElementById('apr-next-btn');
        const pageInput = document.getElementById('apr-page-input');
        const pageTotalEl = document.getElementById('apr-page-total');
        const zoomInBtn = document.getElementById('apr-zoom-in');
        const zoomOutBtn = document.getElementById('apr-zoom-out');
        const closeBtn = document.getElementById('apr-close-btn');
        const stageEl = document.getElementById('apr-stage');

        titleEl.innerText = book.title || 'Protected Publication';
        watermarkEl.innerText = userEmail ? `Licensed to ${userEmail}` : 'Accord Archive Protected Reader';
        loadingEl.classList.remove('hidden');
        canvasWrap.classList.add('hidden');
        modal.classList.remove('hidden');
        modal.classList.add('flex');

        let pdfDoc = null;
        let currentPage = 1;
        let scale = window.innerWidth < 640 ? 1.1 : 1.35;
        let renderTask = null;
        let closed = false;

        const cleanup = () => {
            closed = true;
            modal.classList.add('hidden');
            modal.classList.remove('flex');
            if (pdfDoc && typeof pdfDoc.destroy === 'function') {
                try { pdfDoc.destroy(); } catch (_) {}
            }
            pdfDoc = null;
            const ctx = canvas.getContext('2d');
            ctx?.clearRect(0, 0, canvas.width, canvas.height);
        };

        closeBtn.onclick = cleanup;

        try {
            // 1. Fetch decryption key (tiny ~32 byte check via RLS)
            loadingTextEl.innerText = 'Verifying reading license...';
            const { data: keyRow, error: keyErr } = await supabaseClient
                .from('book_encryption_keys')
                .select('key_b64')
                .eq('book_id', Number(book.id))
                .maybeSingle();

            if (keyErr || !keyRow?.key_b64) {
                throw new Error(keyErr?.message || 'Reading license not available. Please sign in or purchase this book.');
            }

            // 2. Load encrypted bundle from IndexedDB or download once
            let cached = await getCachedEncryptedBook(book.id);
            let encryptedBuffer = null;

            if (cached && cached.encryptedUrl === book.encrypted_url && cached.encryptedBuffer) {
                encryptedBuffer = cached.encryptedBuffer;
                statusEl.innerText = 'Protected In-App Reader • Loaded from Device Cache (0 KB used)';
            } else {
                loadingTextEl.innerText = 'Downloading encrypted edition to private device cache...';
                const resp = await fetch(book.encrypted_url);
                if (!resp.ok) throw new Error(`Failed to load encrypted book (HTTP ${resp.status}).`);
                encryptedBuffer = await resp.arrayBuffer();
                await putCachedEncryptedBook({
                    bookId: String(book.id),
                    encryptedUrl: book.encrypted_url,
                    encryptedBuffer,
                    cachedAt: Date.now()
                });
                statusEl.innerText = 'Protected In-App Reader • Cached Securely on Device';
            }

            if (closed) return;

            // 3. Decrypt in RAM & load into PDF.js
            loadingTextEl.innerText = 'Decrypting in memory...';
            const plainBytes = await decryptBuffer(encryptedBuffer, keyRow.key_b64);
            const pdfjs = await loadPdfJs();
            pdfDoc = await pdfjs.getDocument({ data: plainBytes }).promise;

            if (closed) {
                try { pdfDoc.destroy(); } catch (_) {}
                return;
            }

            pageTotalEl.innerText = `/ ${pdfDoc.numPages}`;
            pageInput.max = String(pdfDoc.numPages);

            const renderPage = async (num) => {
                if (!pdfDoc || closed) return;
                currentPage = Math.max(1, Math.min(pdfDoc.numPages, num));
                pageInput.value = String(currentPage);
                prevBtn.disabled = currentPage <= 1;
                nextBtn.disabled = currentPage >= pdfDoc.numPages;

                if (renderTask) {
                    try { renderTask.cancel(); } catch (_) {}
                }

                const page = await pdfDoc.getPage(currentPage);
                const viewport = page.getViewport({ scale });
                const dpr = Math.min(window.devicePixelRatio || 1, 2);
                canvas.width = Math.floor(viewport.width * dpr);
                canvas.height = Math.floor(viewport.height * dpr);
                canvas.style.width = `${Math.floor(viewport.width)}px`;
                canvas.style.height = `${Math.floor(viewport.height)}px`;

                const ctx = canvas.getContext('2d');
                ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
                renderTask = page.render({ canvasContext: ctx, viewport });
                await renderTask.promise;
                stageEl.scrollTop = 0;
            };

            prevBtn.onclick = () => renderPage(currentPage - 1);
            nextBtn.onclick = () => renderPage(currentPage + 1);
            pageInput.onchange = () => renderPage(parseInt(pageInput.value, 10) || 1);
            zoomInBtn.onclick = () => { scale = Math.min(2.6, scale + 0.2); renderPage(currentPage); };
            zoomOutBtn.onclick = () => { scale = Math.max(0.6, scale - 0.2); renderPage(currentPage); };

            // Touch swipe support for mobile page turns
            let touchStartX = 0;
            stageEl.ontouchstart = (e) => {
                touchStartX = e.changedTouches?.[0]?.screenX || 0;
            };
            stageEl.ontouchend = (e) => {
                const dx = (e.changedTouches?.[0]?.screenX || 0) - touchStartX;
                if (dx < -55) renderPage(currentPage + 1);
                if (dx > 55) renderPage(currentPage - 1);
            };

            loadingEl.classList.add('hidden');
            canvasWrap.classList.remove('hidden');
            await renderPage(1);
        } catch (err) {
            console.error('Protected Reader Error:', err);
            loadingTextEl.innerText = err?.message || 'Unable to open protected book.';
        }
    }

    global.AccordProtectedReader = {
        generateBookKeyB64,
        encryptFileBuffer,
        decryptBuffer,
        uploadProtectedBookAssets,
        uploadMasterOnly,
        getMasterDownloadUrl,
        encryptExistingBook,
        saveBookEncryptionKey,
        openProtectedReaderModal
    };
})(window);
