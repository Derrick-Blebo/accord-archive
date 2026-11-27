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
                    <button type="button" id="apr-tts-toggle-btn" class="px-2.5 h-8 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-semibold flex items-center gap-1.5" title="Read Aloud (TTS)">
                        <i id="apr-tts-toggle-icon" class="fa-solid fa-volume-high"></i>
                        <span class="hidden sm:inline">Read Aloud</span>
                    </button>
                    <button type="button" id="apr-zoom-out" class="w-8 h-8 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs flex items-center justify-center" title="Zoom Out"><i class="fa-solid fa-magnifying-glass-minus"></i></button>
                    <button type="button" id="apr-zoom-in" class="w-8 h-8 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs flex items-center justify-center" title="Zoom In"><i class="fa-solid fa-magnifying-glass-plus"></i></button>
                    <button type="button" id="apr-fullscreen-btn" class="px-2.5 h-8 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-semibold flex items-center gap-1.5" title="Toggle Full Screen">
                        <i id="apr-fullscreen-icon" class="fa-solid fa-expand"></i>
                        <span class="hidden sm:inline" id="apr-fullscreen-label">Full Screen</span>
                    </button>
                    <button type="button" id="apr-close-btn" class="px-3 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-700 text-xs font-bold">Close</button>
                </div>
            </div>

            <div id="apr-tts-bar" class="hidden flex-wrap items-center justify-between gap-2 px-4 py-2 bg-slate-900/95 border-b border-slate-800 text-white shrink-0">
                <div class="flex items-center gap-1.5">
                    <button type="button" id="apr-tts-prev-btn" class="w-8 h-8 rounded-lg bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-xs flex items-center justify-center" title="Previous Sentence">
                        <i class="fa-solid fa-backward-step"></i>
                    </button>
                    <button type="button" id="apr-tts-play-btn" class="px-3 h-8 rounded-lg bg-blue-600 hover:bg-blue-700 text-xs font-bold flex items-center gap-1.5" title="Play / Pause">
                        <i id="apr-tts-play-icon" class="fa-solid fa-play"></i>
                        <span id="apr-tts-play-label">Play</span>
                    </button>
                    <button type="button" id="apr-tts-next-btn" class="w-8 h-8 rounded-lg bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-xs flex items-center justify-center" title="Next Sentence">
                        <i class="fa-solid fa-forward-step"></i>
                    </button>
                    <button type="button" id="apr-tts-stop-btn" class="w-8 h-8 rounded-lg bg-slate-800 hover:bg-rose-700 disabled:opacity-40 text-xs flex items-center justify-center" title="Stop Reading">
                        <i class="fa-solid fa-stop"></i>
                    </button>
                </div>
                <p id="apr-tts-caption" class="flex-1 min-w-[160px] text-[11px] text-slate-300 truncate px-2">Ready to read from current page</p>
                <div class="flex items-center gap-2 shrink-0">
                    <select id="apr-tts-rate-select" class="h-8 rounded-lg bg-slate-800 border border-slate-700 px-2 text-xs text-white focus:outline-none" title="Reading Speed">
                        <option value="0.75">0.75x</option>
                        <option value="1" selected>1.0x</option>
                        <option value="1.25">1.25x</option>
                        <option value="1.5">1.5x</option>
                        <option value="1.75">1.75x</option>
                        <option value="2">2.0x</option>
                    </select>
                    <select id="apr-tts-voice-select" class="h-8 max-w-[160px] sm:max-w-[210px] rounded-lg bg-slate-800 border border-slate-700 px-2 text-xs text-white focus:outline-none truncate" title="Voice"></select>
                </div>
            </div>

            <div id="apr-stage" class="flex-1 overflow-auto flex flex-col items-center p-3 sm:p-6 relative">
                <div id="apr-loading" class="my-auto text-center text-slate-300 space-y-3">
                    <div class="w-10 h-10 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto"></div>
                    <p id="apr-loading-text" class="text-xs font-semibold">Decrypting publication...</p>
                </div>
                <div id="apr-pages-container" class="hidden w-full flex-col items-center gap-4"></div>
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

    const TTS_RATE_STORAGE_KEY = 'accord_tts_rate';
    const TTS_VOICE_STORAGE_KEY = 'accord_tts_voice';

    function splitTextIntoSentences(rawText) {
        const cleaned = String(rawText || '').replace(/\s+/g, ' ').trim();
        if (!cleaned) return [];

        const rawParts = cleaned.split(/(?<=[.!?])\s+/);
        const chunks = [];
        const MAX_CHUNK_LEN = 220;

        for (const part of rawParts) {
            const trimmed = part.trim();
            if (!trimmed) continue;
            if (trimmed.length <= MAX_CHUNK_LEN) {
                chunks.push(trimmed);
                continue;
            }
            // Break long sentences at clause boundaries or spaces so Web Speech doesn't stall
            let remaining = trimmed;
            while (remaining.length > MAX_CHUNK_LEN) {
                let cut = remaining.lastIndexOf(', ', MAX_CHUNK_LEN);
                if (cut < 60) cut = remaining.lastIndexOf('; ', MAX_CHUNK_LEN);
                if (cut < 60) cut = remaining.lastIndexOf(' ', MAX_CHUNK_LEN);
                if (cut < 40) cut = MAX_CHUNK_LEN;
                chunks.push(remaining.slice(0, cut + 1).trim());
                remaining = remaining.slice(cut + 1).trim();
            }
            if (remaining) chunks.push(remaining);
        }
        return chunks;
    }

    async function extractPageSentences(pdfDoc, pageNum) {
        const page = await pdfDoc.getPage(pageNum);
        const textContent = await page.getTextContent();
        const items = Array.isArray(textContent?.items) ? textContent.items : [];
        if (!items.length) return [];

        let text = '';
        let prevItem = null;
        for (let i = 0; i < items.length; i++) {
            const item = items[i];
            const str = typeof item.str === 'string' ? item.str : '';
            if (!str) {
                if (item.hasEOL && text && !text.endsWith('\n')) {
                    text += '\n';
                }
                continue;
            }

            if (text.endsWith('-\n') && /^[a-z]/.test(str)) {
                text = text.slice(0, -2) + str;
            } else {
                let needsBreak = false;
                let needsSpace = false;

                if (text && !text.endsWith(' ') && !text.endsWith('\n') && !/^\s/.test(str)) {
                    const prevT = Array.isArray(prevItem?.transform) ? prevItem.transform : null;
                    const currT = Array.isArray(item.transform) ? item.transform : null;
                    if (prevT && currT && typeof prevItem.width === 'number') {
                        const fontSize = Math.max(
                            item.height || 0,
                            prevItem.height || 0,
                            Math.hypot(currT[2], currT[3]) || 0,
                            Math.hypot(prevT[2], prevT[3]) || 0
                        ) || 12;
                        const dy = Math.abs(currT[5] - prevT[5]);
                        if (dy > fontSize * 0.5) {
                            needsBreak = true;
                        } else {
                            const prevEndX = prevT[4] + prevItem.width;
                            const gap = currT[4] - prevEndX;
                            if (gap > fontSize * 0.18 || currT[4] < prevT[4] - fontSize * 0.5) {
                                needsSpace = true;
                            }
                        }
                    }
                }

                if (needsBreak) {
                    text += '\n' + str;
                } else if (needsSpace) {
                    text += ' ' + str;
                } else {
                    text += str;
                }
            }

            prevItem = item;
            if (item.hasEOL) {
                text += '\n';
            }
        }
        return splitTextIntoSentences(text);
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
        const pagesContainer = document.getElementById('apr-pages-container');
        const prevBtn = document.getElementById('apr-prev-btn');
        const nextBtn = document.getElementById('apr-next-btn');
        const pageInput = document.getElementById('apr-page-input');
        const pageTotalEl = document.getElementById('apr-page-total');
        const zoomInBtn = document.getElementById('apr-zoom-in');
        const zoomOutBtn = document.getElementById('apr-zoom-out');
        const fullscreenBtn = document.getElementById('apr-fullscreen-btn');
        const fullscreenIcon = document.getElementById('apr-fullscreen-icon');
        const fullscreenLabel = document.getElementById('apr-fullscreen-label');
        const closeBtn = document.getElementById('apr-close-btn');
        const stageEl = document.getElementById('apr-stage');
        const ttsToggleBtn = document.getElementById('apr-tts-toggle-btn');
        const ttsBar = document.getElementById('apr-tts-bar');
        const ttsPrevBtn = document.getElementById('apr-tts-prev-btn');
        const ttsPlayBtn = document.getElementById('apr-tts-play-btn');
        const ttsPlayIcon = document.getElementById('apr-tts-play-icon');
        const ttsPlayLabel = document.getElementById('apr-tts-play-label');
        const ttsNextBtn = document.getElementById('apr-tts-next-btn');
        const ttsStopBtn = document.getElementById('apr-tts-stop-btn');
        const ttsCaption = document.getElementById('apr-tts-caption');
        const ttsRateSelect = document.getElementById('apr-tts-rate-select');
        const ttsVoiceSelect = document.getElementById('apr-tts-voice-select');

        const watermarkText = userEmail ? `Licensed to ${userEmail}` : 'Accord Archive Protected Reader';
        titleEl.innerText = book.title || 'Protected Publication';
        loadingEl.classList.remove('hidden');
        pagesContainer.classList.add('hidden');
        pagesContainer.classList.remove('flex');
        pagesContainer.innerHTML = '';
        if (ttsBar) {
            ttsBar.classList.add('hidden');
            ttsBar.classList.remove('flex');
        }
        modal.classList.remove('hidden');
        modal.classList.add('flex');

        let pdfDoc = null;
        let currentPage = 1;
        let scale = window.innerWidth < 640 ? 1.1 : 1.35;
        let closed = false;
        let pageObserver = null;
        let visibilityObserver = null;
        let pageSlots = [];
        let renderGeneration = 0;

        // Web Speech API TTS State
        const ttsSupported = 'speechSynthesis' in global && typeof global.SpeechSynthesisUtterance === 'function';
        const pageSentencesCache = new Map();
        let ttsVoices = [];
        let ttsState = 'idle'; // 'idle' | 'playing' | 'paused'
        let ttsPage = 1;
        let ttsSentenceIdx = 0;
        let ttsGeneration = 0;
        let activeTtsWrap = null;
        let voicesChangedHandler = null;

        const clearTtsPageHighlight = () => {
            if (activeTtsWrap) {
                activeTtsWrap.classList.remove('ring-2', 'ring-blue-500');
                activeTtsWrap = null;
            }
        };

        const highlightTtsPage = (pageNum) => {
            clearTtsPageHighlight();
            const slot = pageSlots[pageNum - 1];
            if (slot?.wrap) {
                slot.wrap.classList.add('ring-2', 'ring-blue-500');
                activeTtsWrap = slot.wrap;
            }
        };

        const updateTtsUi = (captionText) => {
            if (!ttsPlayBtn) return;
            const isPlaying = ttsState === 'playing';
            const isActive = ttsState !== 'idle';
            if (ttsPlayIcon) {
                ttsPlayIcon.className = isPlaying ? 'fa-solid fa-pause' : 'fa-solid fa-play';
            }
            if (ttsPlayLabel) {
                ttsPlayLabel.textContent = isPlaying ? 'Pause' : (ttsState === 'paused' ? 'Resume' : 'Play');
            }
            if (ttsToggleBtn) {
                ttsToggleBtn.classList.toggle('bg-blue-600', isActive);
                ttsToggleBtn.classList.toggle('bg-slate-800', !isActive);
            }
            if (ttsStopBtn) ttsStopBtn.disabled = !isActive;
            if (ttsPrevBtn) ttsPrevBtn.disabled = !pdfDoc;
            if (ttsNextBtn) ttsNextBtn.disabled = !pdfDoc;
            if (captionText !== undefined && ttsCaption) {
                ttsCaption.textContent = captionText;
            }
        };

        const stopTts = (captionText = 'Ready to read from current page') => {
            ttsGeneration += 1;
            ttsState = 'idle';
            ttsSentenceIdx = 0;
            clearTtsPageHighlight();
            if (ttsSupported) {
                try { global.speechSynthesis.cancel(); } catch (_) {}
            }
            updateTtsUi(captionText);
        };

        if (ttsToggleBtn) {
            ttsToggleBtn.style.display = ttsSupported ? '' : 'none';
        }

        const syncFullscreenUi = () => {
            const isFs = Boolean(document.fullscreenElement || document.webkitFullscreenElement);
            if (fullscreenIcon) {
                fullscreenIcon.className = isFs ? 'fa-solid fa-compress' : 'fa-solid fa-expand';
            }
            if (fullscreenLabel) {
                fullscreenLabel.textContent = isFs ? 'Exit Full Screen' : 'Full Screen';
            }
        };

        const toggleFullscreen = async () => {
            try {
                const isFs = Boolean(document.fullscreenElement || document.webkitFullscreenElement);
                if (!isFs) {
                    if (modal.requestFullscreen) {
                        await modal.requestFullscreen();
                    } else if (modal.webkitRequestFullscreen) {
                        modal.webkitRequestFullscreen();
                    }
                } else {
                    if (document.exitFullscreen) {
                        await document.exitFullscreen();
                    } else if (document.webkitExitFullscreen) {
                        document.webkitExitFullscreen();
                    }
                }
            } catch (err) {
                console.warn('Fullscreen toggle warning:', err);
            } finally {
                syncFullscreenUi();
            }
        };

        if (fullscreenBtn) {
            fullscreenBtn.onclick = toggleFullscreen;
        }
        document.addEventListener('fullscreenchange', syncFullscreenUi);
        document.addEventListener('webkitfullscreenchange', syncFullscreenUi);
        syncFullscreenUi();

        const cleanup = () => {
            closed = true;
            stopTts();
            if (ttsSupported && voicesChangedHandler && typeof global.speechSynthesis.removeEventListener === 'function') {
                global.speechSynthesis.removeEventListener('voiceschanged', voicesChangedHandler);
                voicesChangedHandler = null;
            }
            if (pageObserver) {
                pageObserver.disconnect();
                pageObserver = null;
            }
            if (visibilityObserver) {
                visibilityObserver.disconnect();
                visibilityObserver = null;
            }
            document.removeEventListener('fullscreenchange', syncFullscreenUi);
            document.removeEventListener('webkitfullscreenchange', syncFullscreenUi);
            const isFs = Boolean(document.fullscreenElement || document.webkitFullscreenElement);
            if (isFs) {
                try {
                    if (document.exitFullscreen) document.exitFullscreen();
                    else if (document.webkitExitFullscreen) document.webkitExitFullscreen();
                } catch (_) {}
            }
            modal.classList.add('hidden');
            modal.classList.remove('flex');
            if (pdfDoc && typeof pdfDoc.destroy === 'function') {
                try { pdfDoc.destroy(); } catch (_) {}
            }
            pdfDoc = null;
            pagesContainer.innerHTML = '';
            pageSlots = [];
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

            const updatePageControls = (num) => {
                currentPage = Math.max(1, Math.min(pdfDoc.numPages, num));
                pageInput.value = String(currentPage);
                prevBtn.disabled = currentPage <= 1;
                nextBtn.disabled = currentPage >= pdfDoc.numPages;
            };

            const renderPageSlot = async (slot, gen) => {
                if (!pdfDoc || closed || gen !== renderGeneration) return;
                if (slot.renderedScale === scale && slot.rendered) return;
                if (slot.rendering) return;
                slot.rendering = true;

                try {
                    const page = await pdfDoc.getPage(slot.pageNum);
                    if (closed || gen !== renderGeneration) return;
                    const viewport = page.getViewport({ scale });
                    const dpr = Math.min(window.devicePixelRatio || 1, 2);

                    slot.wrap.style.minHeight = `${Math.floor(viewport.height)}px`;
                    slot.canvas.width = Math.floor(viewport.width * dpr);
                    slot.canvas.height = Math.floor(viewport.height * dpr);
                    slot.canvas.style.width = `${Math.floor(viewport.width)}px`;
                    slot.canvas.style.height = `${Math.floor(viewport.height)}px`;

                    const ctx = slot.canvas.getContext('2d');
                    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
                    await page.render({ canvasContext: ctx, viewport }).promise;
                    if (closed || gen !== renderGeneration) return;
                    slot.rendered = true;
                    slot.renderedScale = scale;
                } catch (err) {
                    if (err?.name !== 'RenderingCancelledException') {
                        console.warn(`Page ${slot.pageNum} render warning:`, err);
                    }
                } finally {
                    slot.rendering = false;
                }
            };

            const scrollToPage = (num) => {
                if (!pdfDoc || closed) return;
                const target = Math.max(1, Math.min(pdfDoc.numPages, num));
                updatePageControls(target);
                const slot = pageSlots[target - 1];
                if (slot?.wrap) {
                    slot.wrap.scrollIntoView({ behavior: 'smooth', block: 'start' });
                    renderPageSlot(slot, renderGeneration);
                }
            };

            const firstPage = await pdfDoc.getPage(1);
            const baseViewport = firstPage.getViewport({ scale });
            const estimatedHeight = Math.floor(baseViewport.height);

            pageSlots = [];
            const fragment = document.createDocumentFragment();
            for (let p = 1; p <= pdfDoc.numPages; p++) {
                const wrap = document.createElement('div');
                wrap.className = 'relative shadow-2xl rounded-lg overflow-hidden bg-white shrink-0';
                wrap.style.minHeight = `${estimatedHeight}px`;
                wrap.dataset.pageNum = String(p);

                const canvas = document.createElement('canvas');
                canvas.className = 'block max-w-full h-auto';

                const watermark = document.createElement('div');
                watermark.className = 'pointer-events-none absolute inset-0 flex items-end justify-end p-3 opacity-25 text-[10px] font-bold text-slate-700 select-none';
                watermark.innerText = watermarkText;

                const pageBadge = document.createElement('div');
                pageBadge.className = 'pointer-events-none absolute top-2.5 right-2.5 px-2 py-0.5 rounded-full bg-slate-900/60 text-white text-[10px] font-bold select-none';
                pageBadge.innerText = `${p} / ${pdfDoc.numPages}`;

                wrap.appendChild(canvas);
                wrap.appendChild(watermark);
                wrap.appendChild(pageBadge);
                fragment.appendChild(wrap);

                pageSlots.push({
                    pageNum: p,
                    wrap,
                    canvas,
                    rendered: false,
                    rendering: false,
                    renderedScale: null
                });
            }
            pagesContainer.appendChild(fragment);

            const setupObservers = () => {
                if (pageObserver) pageObserver.disconnect();
                if (visibilityObserver) visibilityObserver.disconnect();

                const gen = renderGeneration;
                if (typeof IntersectionObserver !== 'undefined') {
                    pageObserver = new IntersectionObserver((entries) => {
                        entries.forEach(entry => {
                            if (!entry.isIntersecting) return;
                            const pageNum = Number(entry.target.dataset.pageNum);
                            const idx = pageNum - 1;
                            [idx - 1, idx, idx + 1].forEach(i => {
                                if (pageSlots[i]) renderPageSlot(pageSlots[i], gen);
                            });
                        });
                    }, { root: stageEl, rootMargin: '600px 0px' });

                    visibilityObserver = new IntersectionObserver((entries) => {
                        let bestPage = null;
                        let bestRatio = 0;
                        entries.forEach(entry => {
                            if (entry.isIntersecting && entry.intersectionRatio >= bestRatio) {
                                bestRatio = entry.intersectionRatio;
                                bestPage = Number(entry.target.dataset.pageNum);
                            }
                        });
                        if (bestPage) {
                            updatePageControls(bestPage);
                        }
                    }, { root: stageEl, threshold: [0.15, 0.4, 0.7] });

                    pageSlots.forEach(slot => {
                        pageObserver.observe(slot.wrap);
                        visibilityObserver.observe(slot.wrap);
                    });
                } else {
                    pageSlots.forEach(slot => renderPageSlot(slot, gen));
                }
            };

            prevBtn.onclick = () => scrollToPage(currentPage - 1);
            nextBtn.onclick = () => scrollToPage(currentPage + 1);
            pageInput.onchange = () => scrollToPage(parseInt(pageInput.value, 10) || 1);

            const rerenderZoom = async () => {
                const anchorPage = currentPage;
                renderGeneration += 1;
                const gen = renderGeneration;
                pageSlots.forEach(slot => {
                    slot.rendered = false;
                    slot.rendering = false;
                });
                const anchorSlot = pageSlots[anchorPage - 1];
                if (anchorSlot) {
                    await renderPageSlot(anchorSlot, gen);
                    anchorSlot.wrap.scrollIntoView({ behavior: 'auto', block: 'start' });
                }
                if (pageSlots[anchorPage - 2]) renderPageSlot(pageSlots[anchorPage - 2], gen);
                if (pageSlots[anchorPage]) renderPageSlot(pageSlots[anchorPage], gen);
            };

            zoomInBtn.onclick = () => { scale = Math.min(2.6, scale + 0.2); rerenderZoom(); };
            zoomOutBtn.onclick = () => { scale = Math.max(0.6, scale - 0.2); rerenderZoom(); };

            // Setup Web Speech API TTS controls
            const getPageSentencesCached = async (pageNum) => {
                if (pageSentencesCache.has(pageNum)) {
                    return pageSentencesCache.get(pageNum);
                }
                const sentences = await extractPageSentences(pdfDoc, pageNum);
                pageSentencesCache.set(pageNum, sentences);
                return sentences;
            };

            const populateVoices = () => {
                if (!ttsSupported || !ttsVoiceSelect) return;
                const voices = global.speechSynthesis.getVoices() || [];
                ttsVoices = voices.slice().sort((a, b) => {
                    const aEn = (a.lang || '').toLowerCase().startsWith('en') ? 0 : 1;
                    const bEn = (b.lang || '').toLowerCase().startsWith('en') ? 0 : 1;
                    if (aEn !== bEn) return aEn - bEn;
                    return (a.name || '').localeCompare(b.name || '');
                });
                const savedUri = localStorage.getItem(TTS_VOICE_STORAGE_KEY) || '';
                ttsVoiceSelect.innerHTML = '';
                if (!ttsVoices.length) {
                    const opt = document.createElement('option');
                    opt.value = '';
                    opt.textContent = 'Default Voice';
                    ttsVoiceSelect.appendChild(opt);
                    return;
                }
                ttsVoices.forEach((v) => {
                    const opt = document.createElement('option');
                    opt.value = v.voiceURI;
                    opt.textContent = `${v.name} (${v.lang})`;
                    if (savedUri && v.voiceURI === savedUri) opt.selected = true;
                    else if (!savedUri && v.default) opt.selected = true;
                    ttsVoiceSelect.appendChild(opt);
                });
            };

            if (ttsSupported) {
                const savedRate = localStorage.getItem(TTS_RATE_STORAGE_KEY);
                if (savedRate && ttsRateSelect && Array.from(ttsRateSelect.options).some(o => o.value === savedRate)) {
                    ttsRateSelect.value = savedRate;
                }
                populateVoices();
                voicesChangedHandler = () => populateVoices();
                if (typeof global.speechSynthesis.addEventListener === 'function') {
                    global.speechSynthesis.addEventListener('voiceschanged', voicesChangedHandler);
                }
            }

            const speakFrom = async (startPage, startSentenceIdx = 0) => {
                if (!ttsSupported || !pdfDoc || closed) return;
                const gen = ++ttsGeneration;
                ttsState = 'playing';
                try { global.speechSynthesis.cancel(); } catch (_) {}

                let targetPage = Math.max(1, Math.min(pdfDoc.numPages, startPage));
                let targetIdx = Math.max(0, startSentenceIdx);
                let sentences = [];

                updateTtsUi(`Loading text for page ${targetPage}...`);
                while (targetPage <= pdfDoc.numPages) {
                    if (closed || gen !== ttsGeneration) return;
                    sentences = await getPageSentencesCached(targetPage);
                    if (closed || gen !== ttsGeneration) return;
                    if (sentences.length > 0 && targetIdx < sentences.length) {
                        break;
                    }
                    targetPage += 1;
                    targetIdx = 0;
                }

                if (targetPage > pdfDoc.numPages || !sentences.length) {
                    if (startPage === 1 && targetPage > pdfDoc.numPages) {
                        stopTts('No readable text found (this may be a scanned PDF).');
                    } else {
                        stopTts('Finished reading publication.');
                    }
                    return;
                }

                ttsPage = targetPage;
                ttsSentenceIdx = targetIdx;
                if (currentPage !== ttsPage) {
                    scrollToPage(ttsPage);
                }
                highlightTtsPage(ttsPage);

                const sentenceText = sentences[ttsSentenceIdx];
                updateTtsUi(`Page ${ttsPage}/${pdfDoc.numPages} • ${ttsSentenceIdx + 1}/${sentences.length}: ${sentenceText}`);

                const utterance = new global.SpeechSynthesisUtterance(sentenceText);
                const selectedRate = parseFloat(ttsRateSelect?.value || '1') || 1;
                utterance.rate = selectedRate;
                const selectedVoiceUri = ttsVoiceSelect?.value || '';
                const matchedVoice = ttsVoices.find(v => v.voiceURI === selectedVoiceUri);
                if (matchedVoice) {
                    utterance.voice = matchedVoice;
                }

                utterance.onend = () => {
                    if (closed || gen !== ttsGeneration || ttsState !== 'playing') return;
                    if (ttsSentenceIdx + 1 < sentences.length) {
                        speakFrom(ttsPage, ttsSentenceIdx + 1);
                    } else if (ttsPage + 1 <= pdfDoc.numPages) {
                        speakFrom(ttsPage + 1, 0);
                    } else {
                        stopTts('Finished reading publication.');
                    }
                };

                utterance.onerror = (ev) => {
                    if (closed || gen !== ttsGeneration || ttsState !== 'playing') return;
                    if (ev?.error === 'interrupted' || ev?.error === 'canceled') return;
                    console.warn('TTS utterance error:', ev?.error || ev);
                    stopTts('Read Aloud stopped due to a browser speech error.');
                };

                global.speechSynthesis.speak(utterance);
            };

            const pauseTts = () => {
                if (ttsState !== 'playing') return;
                ttsGeneration += 1;
                ttsState = 'paused';
                try { global.speechSynthesis.cancel(); } catch (_) {}
                updateTtsUi(`Paused on Page ${ttsPage}/${pdfDoc.numPages}`);
            };

            if (ttsToggleBtn && ttsBar) {
                ttsToggleBtn.onclick = () => {
                    const isHidden = ttsBar.classList.contains('hidden');
                    if (isHidden) {
                        ttsBar.classList.remove('hidden');
                        ttsBar.classList.add('flex');
                        if (ttsState === 'idle') {
                            speakFrom(currentPage, 0);
                        }
                    } else {
                        ttsBar.classList.add('hidden');
                        ttsBar.classList.remove('flex');
                        if (ttsState !== 'idle') {
                            stopTts();
                        }
                    }
                };
            }

            if (ttsPlayBtn) {
                ttsPlayBtn.onclick = () => {
                    if (!ttsSupported) return;
                    if (ttsState === 'playing') {
                        pauseTts();
                    } else if (ttsState === 'paused') {
                        speakFrom(ttsPage, ttsSentenceIdx);
                    } else {
                        speakFrom(currentPage, 0);
                    }
                };
            }

            if (ttsStopBtn) {
                ttsStopBtn.onclick = () => stopTts();
            }

            if (ttsPrevBtn) {
                ttsPrevBtn.onclick = async () => {
                    if (!ttsSupported || !pdfDoc) return;
                    if (ttsState === 'idle') {
                        const prevP = Math.max(1, currentPage - 1);
                        speakFrom(prevP, 0);
                        return;
                    }
                    if (ttsSentenceIdx > 0) {
                        speakFrom(ttsPage, ttsSentenceIdx - 1);
                    } else if (ttsPage > 1) {
                        const prevSentences = await getPageSentencesCached(ttsPage - 1);
                        speakFrom(ttsPage - 1, Math.max(0, prevSentences.length - 1));
                    } else {
                        speakFrom(1, 0);
                    }
                };
            }

            if (ttsNextBtn) {
                ttsNextBtn.onclick = async () => {
                    if (!ttsSupported || !pdfDoc) return;
                    if (ttsState === 'idle') {
                        speakFrom(currentPage, 0);
                        return;
                    }
                    const currSentences = await getPageSentencesCached(ttsPage);
                    if (ttsSentenceIdx + 1 < currSentences.length) {
                        speakFrom(ttsPage, ttsSentenceIdx + 1);
                    } else if (ttsPage < pdfDoc.numPages) {
                        speakFrom(ttsPage + 1, 0);
                    }
                };
            }

            if (ttsRateSelect) {
                ttsRateSelect.onchange = () => {
                    localStorage.setItem(TTS_RATE_STORAGE_KEY, ttsRateSelect.value);
                    if (ttsState === 'playing') {
                        speakFrom(ttsPage, ttsSentenceIdx);
                    }
                };
            }

            if (ttsVoiceSelect) {
                ttsVoiceSelect.onchange = () => {
                    localStorage.setItem(TTS_VOICE_STORAGE_KEY, ttsVoiceSelect.value);
                    if (ttsState === 'playing') {
                        speakFrom(ttsPage, ttsSentenceIdx);
                    }
                };
            }

            updateTtsUi('Ready to read from current page');

            loadingEl.classList.add('hidden');
            pagesContainer.classList.remove('hidden');
            pagesContainer.classList.add('flex');
            stageEl.scrollTop = 0;
            updatePageControls(1);
            setupObservers();
            await renderPageSlot(pageSlots[0], renderGeneration);
            if (pageSlots[1]) renderPageSlot(pageSlots[1], renderGeneration);
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
