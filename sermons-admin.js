// Accord Sermons Hub Admin
const SUPABASE_URL = 'https://mzblgajftvyyosyrawcx.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im16YmxnYWpmdHZ5eW9zeXJhd2N4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTQ0NzYxNTQsImV4cCI6MjExMDA1MjE1NH0.Xs9MeioNfqb5DzxDYP-9ZqfywBeOlUreAY-yKrcBmJM';
const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const SERMONS_CONFIG_RECORD_NAME = '__ACCORD_SERMONS_CONFIG__';
const SUPERADMIN_EMAILS = ['accordmedia1@gmail.com', 'rickblebs1@gmail.com'];

let currentTableFilter = 'all';
let sermonsConfig = {
    pastors: [],
    ministries: [],
    playlists: [],
    sermonSpotlights: []
};

window.onload = async function () {
    const { data: { session } } = await supabaseClient.auth.getSession();
    if (session?.user && await hasSermonsAdminPermission(session.user.email)) {
        unlockDashboard(session.user);
    }
};

async function hasSermonsAdminPermission(email) {
    const normalized = String(email || '').trim().toLowerCase();
    if (!normalized) return false;
    if (SUPERADMIN_EMAILS.includes(normalized)) return true;

    try {
        const { data } = await supabaseClient
            .from('books')
            .select('description')
            .eq('title', '__ACCORD_ADMIN_ROLES__')
            .maybeSingle();

        if (data?.description) {
            const roles = JSON.parse(data.description);
            const entry = (Array.isArray(roles) ? roles : []).find(
                r => String(r.email || '').trim().toLowerCase() === normalized
            );
            if (entry) {
                if (Array.isArray(entry.roles)) {
                    return entry.roles.includes('music_admin') || entry.roles.includes('sermons_admin') || entry.roles.includes('superadmin');
                }
                return entry.role === 'music_admin' || entry.role === 'sermons_admin' || entry.role === 'superadmin';
            }
        }
    } catch {}
    return false;
}

async function handleLogin(e) {
    e.preventDefault();
    const email = document.getElementById('login-email').value.trim();
    const password = document.getElementById('login-password').value;
    const errEl = document.getElementById('login-error');
    const btn = document.getElementById('login-btn');
    errEl.classList.add('hidden');

    btn.disabled = true;
    btn.textContent = 'Signing in...';

    const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });
    btn.disabled = false;
    btn.textContent = 'Sign In to Sermons Admin';

    if (error || !data?.user) {
        errEl.textContent = error?.message || 'Invalid credentials.';
        errEl.classList.remove('hidden');
        return;
    }

    if (!(await hasSermonsAdminPermission(data.user.email))) {
        await supabaseClient.auth.signOut();
        errEl.textContent = 'This account does not have Sermons / Music Admin permissions.';
        errEl.classList.remove('hidden');
        return;
    }

    unlockDashboard(data.user);
}

function unlockDashboard(user) {
    document.getElementById('login-gate').classList.add('hidden');
    document.getElementById('admin-dashboard').classList.remove('hidden');
    document.getElementById('admin-email-badge').textContent = user.email;
    loadSermonsConfigFromSupabase();
}

async function handleLogout() {
    await supabaseClient.auth.signOut();
    window.location.reload();
}

function normalizeSermonsConfig(parsed) {
    return {
        pastors: Array.isArray(parsed?.pastors) ? parsed.pastors : [],
        ministries: Array.isArray(parsed?.ministries) ? parsed.ministries : [],
        playlists: Array.isArray(parsed?.playlists) ? parsed.playlists : [],
        sermonSpotlights: Array.isArray(parsed?.sermonSpotlights) ? parsed.sermonSpotlights : []
    };
}

async function loadSermonsConfigFromSupabase() {
    try {
        const { data, error } = await supabaseClient
            .from('books')
            .select('description')
            .eq('title', SERMONS_CONFIG_RECORD_NAME)
            .maybeSingle();

        if (!error && data?.description) {
            sermonsConfig = normalizeSermonsConfig(JSON.parse(data.description));
            localStorage.setItem('accord_sermons_config', JSON.stringify(sermonsConfig));
            renderAll();
            return;
        }
    } catch (e) {
        console.warn('Could not load sermons config:', e);
    }

    const localSaved = localStorage.getItem('accord_sermons_config');
    if (localSaved) {
        try {
            sermonsConfig = normalizeSermonsConfig(JSON.parse(localSaved));
        } catch {}
    }
    renderAll();
}

async function persistSermonsConfig() {
    localStorage.setItem('accord_sermons_config', JSON.stringify(sermonsConfig));
    const { data: existing } = await supabaseClient
        .from('books')
        .select('id')
        .eq('title', SERMONS_CONFIG_RECORD_NAME)
        .maybeSingle();

    const payload = {
        title: SERMONS_CONFIG_RECORD_NAME,
        author: 'System Sermons Config',
        category: 'System',
        year: '2026',
        pages: '0',
        description: JSON.stringify(sermonsConfig),
        is_visible: false,
        status: 'system_config',
        is_for_sale: false,
        price: 0
    };

    const res = existing?.id
        ? await supabaseClient.from('books').update(payload).eq('id', existing.id)
        : await supabaseClient.from('books').insert([payload]);

    if (res.error) {
        showToast('Could not save to database: ' + res.error.message);
        return false;
    }
    renderAll();
    return true;
}

function showToast(msg) {
    const toast = document.getElementById('toast');
    const msgEl = document.getElementById('toast-message');
    if (!toast || !msgEl) return;
    msgEl.textContent = msg;
    toast.classList.remove('translate-y-24', 'opacity-0');
    toast.classList.add('translate-y-0', 'opacity-100');
    setTimeout(() => {
        toast.classList.remove('translate-y-0', 'opacity-100');
        toast.classList.add('translate-y-24', 'opacity-0');
    }, 3200);
}

function escapeHTML(str) {
    return String(str || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function renderAll() {
    document.getElementById('stat-sermon-playlists').textContent = sermonsConfig.playlists.length;
    document.getElementById('stat-pastor-spotlights').textContent = sermonsConfig.pastors.length;
    document.getElementById('stat-ministry-spotlights').textContent = sermonsConfig.ministries.length;
    document.getElementById('stat-sermon-spotlights').textContent = sermonsConfig.sermonSpotlights.length;
    renderSermonsTable();
    renderSermonSpotlightsTable();
    loadAndRenderSermonPlaylistInsights();
}

async function loadAndRenderSermonPlaylistInsights() {
    const savedEl = document.getElementById('sermon-insights-most-saved');
    const engagedEl = document.getElementById('sermon-insights-most-engaged');
    if (!savedEl || !engagedEl) return;

    let stats = [];
    try {
        const { data, error } = await supabaseClient
            .from('playlist_stats')
            .select('playlist_id, playlist_title, save_count, play_count, platform_click_count, engagement_count, last_engaged_at')
            .order('engagement_count', { ascending: false })
            .limit(100);

        if (!error && Array.isArray(data)) {
            stats = data;
        }
    } catch {}

    if (stats.length === 0) {
        try {
            const localRaw = localStorage.getItem('accord_playlist_analytics_local');
            if (localRaw) stats = Object.values(JSON.parse(localRaw));
        } catch {}
    }

    const sermonPlaylistsById = new Map((sermonsConfig.playlists || []).map(p => [String(p.id), p]));
    const filtered = stats.filter(row => {
        const id = String(row.playlist_id || '');
        return sermonPlaylistsById.has(id) || id.startsWith('serm-') || id.startsWith('profile_sermon_');
    });

    const normalized = filtered.map(row => {
        const pl = sermonPlaylistsById.get(String(row.playlist_id));
        return {
            playlist_id: String(row.playlist_id),
            playlist_title: pl?.title || row.playlist_title || row.playlist_id,
            save_count: Number(row.save_count || 0),
            play_count: Number(row.play_count || 0),
            platform_click_count: Number(row.platform_click_count || 0),
            engagement_count: Number(row.engagement_count || 0)
        };
    });

    const mostSaved = [...normalized].sort((a, b) => b.save_count - a.save_count).slice(0, 6);
    const mostEngaged = [...normalized].sort((a, b) => b.engagement_count - a.engagement_count).slice(0, 6);

    const renderRows = (rows, emptyMsg, metricRenderer) => {
        if (rows.length === 0) {
            return `<p class="text-accord-muted py-4">${emptyMsg}</p>`;
        }
        return rows.map((row, idx) => `
            <div class="py-2.5 flex items-center justify-between gap-3">
                <div class="flex items-center gap-2.5 min-w-0">
                    <span class="w-5 h-5 rounded-full bg-slate-100 text-accord-slate text-[10px] font-extrabold flex items-center justify-center shrink-0">${idx + 1}</span>
                    <span class="font-semibold text-accord-slate truncate">${escapeHTML(row.playlist_title)}</span>
                </div>
                <div class="flex items-center gap-2 shrink-0 text-[11px]">
                    ${metricRenderer(row)}
                </div>
            </div>
        `).join('');
    };

    savedEl.innerHTML = renderRows(
        mostSaved,
        'No sermon playlist saves recorded yet.',
        row => `<span class="px-2.5 py-0.5 rounded-full bg-accord-lightBlue text-accord-blue font-bold">${row.save_count} saves</span>`
    );

    engagedEl.innerHTML = renderRows(
        mostEngaged,
        'No sermon playlist engagement recorded yet.',
        row => `
            <span class="text-accord-muted">${row.play_count} plays</span>
            <span class="text-accord-muted">• ${row.platform_click_count} clicks</span>
            <span class="px-2.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700 font-bold">${row.engagement_count} total</span>
        `
    );
}

function setSermonTableFilter(filter) {
    currentTableFilter = filter;
    ['all', 'playlist', 'pastor', 'ministry'].forEach(f => {
        const btn = document.getElementById(`sermon-filter-${f}`);
        if (!btn) return;
        btn.className = f === filter
            ? 'px-3.5 py-1.5 rounded-full text-xs font-bold bg-accord-blue text-white'
            : 'px-3.5 py-1.5 rounded-full text-xs font-bold bg-slate-100 text-accord-slate hover:bg-slate-200';
    });
    renderSermonsTable();
}

function renderSermonsTable() {
    const tbody = document.getElementById('sermons-table-body');
    if (!tbody) return;

    const rows = [
        ...sermonsConfig.playlists.map(p => ({ ...p, _kind: 'playlist', _label: 'Sermon Playlist', _badge: 'bg-blue-50 text-accord-blue' })),
        ...sermonsConfig.pastors.map(p => ({ ...p, _kind: 'pastor', _label: 'Pastor Spotlight', _badge: 'bg-amber-50 text-amber-800' })),
        ...sermonsConfig.ministries.map(p => ({ ...p, _kind: 'ministry', _label: 'Ministry Spotlight', _badge: 'bg-indigo-50 text-indigo-700' }))
    ].filter(item => currentTableFilter === 'all' || item._kind === currentTableFilter);

    if (rows.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5" class="py-8 text-center text-accord-muted">No entries yet. Use the buttons above to add a Sermon Playlist, Pastor, or Ministry Spotlight.</td></tr>`;
        return;
    }

    tbody.innerHTML = rows.map(item => `
        <tr class="hover:bg-slate-50/80">
            <td class="py-3 pr-4">
                <div class="flex items-center gap-3">
                    <img src="${escapeHTML(item.image || 'assets/icon-192.png')}" alt="" class="w-10 h-10 rounded-lg object-cover bg-slate-100 shrink-0">
                    <div class="min-w-0">
                        <p class="font-bold text-accord-slate truncate max-w-[220px]">${escapeHTML(item.title)}</p>
                        <p class="text-[11px] text-accord-muted truncate max-w-[220px]">${escapeHTML(item.curator || '')}</p>
                    </div>
                </div>
            </td>
            <td class="py-3 px-4">
                <span class="px-2.5 py-1 rounded-full text-[10px] font-bold ${item._badge}">${item._label}</span>
            </td>
            <td class="py-3 px-4 text-accord-muted">${escapeHTML(item.genre || '—')}</td>
            <td class="py-3 px-4">
                <div class="flex items-center gap-1.5">
                    <button type="button" onclick="toggleSermonItemFeatured('${escapeHTML(item.id)}', '${item._kind}')" class="px-2 py-0.5 rounded-full text-[10px] font-bold ${item.featured !== false ? 'bg-accord-goldLight text-amber-800' : 'bg-slate-100 text-slate-500'}">
                        ${item.featured !== false ? 'Featured' : 'Standard'}
                    </button>
                    <button type="button" onclick="toggleSermonItemVisibility('${escapeHTML(item.id)}', '${item._kind}')" class="px-2 py-0.5 rounded-full text-[10px] font-bold ${item.hidden ? 'bg-red-50 text-red-600' : 'bg-emerald-50 text-emerald-700'}">
                        ${item.hidden ? 'Hidden' : 'Visible'}
                    </button>
                </div>
            </td>
            <td class="py-3 pl-4 text-right space-x-1.5 whitespace-nowrap">
                <button type="button" onclick="openSermonItemModal('edit', '${escapeHTML(item.id)}', '${item._kind}')" class="px-2.5 py-1.5 rounded-lg bg-slate-100 hover:bg-accord-blue hover:text-white text-accord-slate font-bold transition-colors">Edit</button>
                <button type="button" onclick="deleteSermonItem('${escapeHTML(item.id)}', '${item._kind}')" class="px-2.5 py-1.5 rounded-lg bg-red-50 hover:bg-red-600 hover:text-white text-red-600 font-bold transition-colors">Delete</button>
            </td>
        </tr>
    `).join('');
}

function renderSermonSpotlightsTable() {
    const tbody = document.getElementById('sermon-spotlights-table-body');
    if (!tbody) return;
    if (sermonsConfig.sermonSpotlights.length === 0) {
        tbody.innerHTML = `<tr><td colspan="4" class="py-8 text-center text-accord-muted">No featured individual sermons yet.</td></tr>`;
        return;
    }

    tbody.innerHTML = sermonsConfig.sermonSpotlights.map(s => `
        <tr class="hover:bg-slate-50/80">
            <td class="py-3 pr-4 font-bold text-accord-slate">${escapeHTML(s.title)}</td>
            <td class="py-3 px-4 text-accord-muted">${escapeHTML(s.artist || '—')}</td>
            <td class="py-3 px-4">
                <button type="button" onclick="toggleSermonSpotlightVisibility('${escapeHTML(s.id)}')" class="px-2.5 py-0.5 rounded-full text-[10px] font-bold ${s.hidden ? 'bg-red-50 text-red-600' : 'bg-emerald-50 text-emerald-700'}">
                    ${s.hidden ? 'Hidden' : 'Visible'}
                </button>
            </td>
            <td class="py-3 pl-4 text-right space-x-1.5 whitespace-nowrap">
                <button type="button" onclick="openSermonSpotlightModal('edit', '${escapeHTML(s.id)}')" class="px-2.5 py-1.5 rounded-lg bg-slate-100 hover:bg-accord-blue hover:text-white text-accord-slate font-bold transition-colors">Edit</button>
                <button type="button" onclick="deleteSermonSpotlight('${escapeHTML(s.id)}')" class="px-2.5 py-1.5 rounded-lg bg-red-50 hover:bg-red-600 hover:text-white text-red-600 font-bold transition-colors">Delete</button>
            </td>
        </tr>
    `).join('');
}

function toggleSermonTypeFields() {
    const type = document.getElementById('sermon-item-type')?.value || 'playlist';
    const isPlaylist = type === 'playlist';
    document.getElementById('sermon-playlist-links-group')?.classList.toggle('hidden', !isPlaylist);
    document.getElementById('sermon-playlist-tracks-group')?.classList.toggle('hidden', !isPlaylist);
    document.getElementById('sermon-curator-group')?.classList.toggle('hidden', !isPlaylist);
    document.getElementById('sermon-spotlight-link-group')?.classList.toggle('hidden', isPlaylist);
    document.getElementById('sermon-spotlight-tracks-group')?.classList.toggle('hidden', isPlaylist);
}

function addSpotlightSermonRow(title = '', link = '') {
    const container = document.getElementById('spotlight-sermons-container');
    if (!container) return;
    const row = document.createElement('div');
    row.className = 'spotlight-sermon-row grid grid-cols-1 sm:grid-cols-[1fr_1fr_auto] gap-2 items-center';
    row.innerHTML = `
        <input type="text" class="sermon-row-title bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs" placeholder="Sermon Title" value="${escapeHTML(title)}">
        <input type="url" class="sermon-row-link bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs" placeholder="Spotify / Apple Podcasts / Audiomack URL" value="${escapeHTML(link)}">
        <button type="button" onclick="this.closest('.spotlight-sermon-row').remove()" class="px-2.5 py-2 rounded-xl bg-red-50 text-red-600 text-xs font-bold">✕</button>
    `;
    container.appendChild(row);
}

function updateSermonCoverPreview(url) {
    const img = document.getElementById('sermon-cover-preview');
    const ph = document.getElementById('sermon-cover-placeholder');
    if (url) {
        img.src = url;
        img.classList.remove('hidden');
        ph?.classList.add('hidden');
    } else {
        img.src = '';
        img.classList.add('hidden');
        ph?.classList.remove('hidden');
    }
}

function clearSermonCover() {
    document.getElementById('sermon-item-image').value = '';
    updateSermonCoverPreview('');
}

function compressCoverImage(file, maxDim = 800, quality = 0.84) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            const img = new Image();
            img.onload = () => {
                let { width, height } = img;
                if (width > maxDim || height > maxDim) {
                    const ratio = Math.min(maxDim / width, maxDim / height);
                    width = Math.round(width * ratio);
                    height = Math.round(height * ratio);
                }
                const canvas = document.createElement('canvas');
                canvas.width = width;
                canvas.height = height;
                canvas.getContext('2d').drawImage(img, 0, 0, width, height);
                canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Compression failed')), 'image/jpeg', quality);
            };
            img.onerror = reject;
            img.src = e.target.result;
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
}

async function handleSermonCoverUpload(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    const statusEl = document.getElementById('sermon-cover-status');
    if (statusEl) statusEl.textContent = 'Compressing and uploading...';
    try {
        const blob = await compressCoverImage(file);
        const path = `music-covers/sermon-${Date.now()}.jpg`;
        const { error } = await supabaseClient.storage.from('archive-files').upload(path, blob, { contentType: 'image/jpeg', upsert: true });
        if (error) throw error;
        const { data: pub } = supabaseClient.storage.from('archive-files').getPublicUrl(path);
        document.getElementById('sermon-item-image').value = pub.publicUrl;
        updateSermonCoverPreview(pub.publicUrl);
        if (statusEl) statusEl.textContent = 'Cover image uploaded!';
    } catch (err) {
        if (statusEl) statusEl.textContent = 'Upload failed: ' + (err.message || 'Try again');
    } finally {
        event.target.value = '';
    }
}

let _sermonAutoFillTimer = null;
let _lastSermonAutoFilledUrl = '';

async function fetchSermonLinkMetadata(url) {
    const clean = String(url || '').trim();
    if (!clean || !/^https?:\/\//i.test(clean)) return null;
    const cacheKey = `accord_sermon_meta_${clean}`;
    try {
        const cached = sessionStorage.getItem(cacheKey);
        if (cached) {
            const parsed = JSON.parse(cached);
            if (parsed && (parsed.title || parsed.image || parsed.curator || parsed.description || (Array.isArray(parsed.tracks) && parsed.tracks.length))) {
                return parsed;
            }
        }
    } catch {}
    try {
        const res = await fetch(`/api/music-metadata?url=${encodeURIComponent(clean)}`);
        if (!res.ok) return null;
        const meta = await res.json();
        if (meta && (meta.title || meta.image || meta.curator || meta.description || (Array.isArray(meta.tracks) && meta.tracks.length))) {
            try { sessionStorage.setItem(cacheKey, JSON.stringify(meta)); } catch {}
        }
        return meta;
    } catch {
        return null;
    }
}

function setSermonAutoFillStatus(text, isError = false) {
    const el = document.getElementById('sermon-autofill-status');
    if (!el) return;
    if (!text) {
        el.classList.add('hidden');
        el.textContent = '';
        return;
    }
    el.textContent = text;
    el.className = `text-[11px] font-semibold ${isError ? 'text-amber-600' : 'text-accord-blue'}`;
    el.classList.remove('hidden');
}

function applySermonMetadataToForm(meta) {
    if (!meta) return false;
    let filledAny = false;
    const titleEl = document.getElementById('sermon-item-title');
    const imageEl = document.getElementById('sermon-item-image');
    const curatorEl = document.getElementById('sermon-item-curator');
    const descEl = document.getElementById('sermon-item-description');
    const tracksEl = document.getElementById('sermon-item-tracks');

    if (meta.title && titleEl && (!titleEl.value.trim() || titleEl.dataset.autoFilled === 'true')) {
        titleEl.value = meta.title;
        titleEl.dataset.autoFilled = 'true';
        filledAny = true;
    }
    if (meta.image && imageEl && (!imageEl.value.trim() || imageEl.dataset.autoFilled === 'true')) {
        imageEl.value = meta.image;
        imageEl.dataset.autoFilled = 'true';
        updateSermonCoverPreview(meta.image);
        filledAny = true;
    }
    const curatorVal = meta.curator || meta.artist || '';
    if (curatorVal && curatorEl && (!curatorEl.value.trim() || curatorEl.dataset.autoFilled === 'true')) {
        curatorEl.value = curatorVal;
        curatorEl.dataset.autoFilled = 'true';
        filledAny = true;
    }
    if (meta.description && descEl && (!descEl.value.trim() || descEl.dataset.autoFilled === 'true')) {
        descEl.value = meta.description;
        descEl.dataset.autoFilled = 'true';
        filledAny = true;
    }
    if (Array.isArray(meta.tracks) && meta.tracks.length > 0 && tracksEl && (!tracksEl.value.trim() || tracksEl.dataset.autoFilled === 'true')) {
        tracksEl.value = meta.tracks
            .map(t => t.artist ? `${t.title} - ${t.artist}` : t.title)
            .join('\n');
        tracksEl.dataset.autoFilled = 'true';
        filledAny = true;
    }
    return filledAny;
}

function scheduleSermonAutoFill(rawUrl, immediate = false) {
    clearTimeout(_sermonAutoFillTimer);
    const delay = immediate ? 80 : 450;
    _sermonAutoFillTimer = setTimeout(async () => {
        const candidate = String(
            rawUrl ||
            document.getElementById('sermon-spotify-link')?.value ||
            document.getElementById('sermon-apple-link')?.value ||
            document.getElementById('sermon-audiomack-link')?.value ||
            document.getElementById('sermon-item-link')?.value ||
            ''
        ).trim();
        if (!candidate || !/^https?:\/\//i.test(candidate)) return;
        if (candidate === _lastSermonAutoFilledUrl) return;
        _lastSermonAutoFilledUrl = candidate;

        setSermonAutoFillStatus('Fetching cover art, title & details from link...');
        const meta = await fetchSermonLinkMetadata(candidate);
        if (meta && applySermonMetadataToForm(meta)) {
            setSermonAutoFillStatus('Details auto-filled from link!');
        } else if (meta && (meta.title || meta.image)) {
            setSermonAutoFillStatus('Link checked.');
        } else {
            setSermonAutoFillStatus('Could not auto-fetch from this link — you can enter details manually.', true);
        }
    }, delay);
}

async function autoFillSermonMetadata(explicitUrl = '') {
    const type = document.getElementById('sermon-item-type')?.value || 'playlist';
    const isPlaylist = type === 'playlist';
    const rawUrl = String(
        explicitUrl ||
        (isPlaylist
            ? (document.getElementById('sermon-apple-link')?.value ||
               document.getElementById('sermon-spotify-link')?.value ||
               document.getElementById('sermon-audiomack-link')?.value ||
               '')
            : (document.getElementById('sermon-item-link')?.value || ''))
    ).trim();
    if (!rawUrl) {
        showToast('Paste a Spotify, Apple Podcasts, Audiomack, or YouTube link first.');
        return;
    }
    const btn = document.getElementById(isPlaylist ? 'sermon-playlist-autofill-btn' : 'sermon-spotlight-autofill-btn');
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin mr-1"></i> Fetching...';
    }
    setSermonAutoFillStatus('Fetching cover art, title & details from link...');
    try {
        const meta = await fetchSermonLinkMetadata(rawUrl);
        _lastSermonAutoFilledUrl = rawUrl;
        if (meta && applySermonMetadataToForm(meta)) {
            setSermonAutoFillStatus('Details auto-filled from link!');
            showToast('Details auto-filled from link!');
        } else {
            setSermonAutoFillStatus('Could not auto-fetch from link. Please enter details manually.', true);
            showToast('Could not auto-fill from link. Please enter details manually.');
        }
    } catch {
        setSermonAutoFillStatus('Could not auto-fill from link. Please enter details manually.', true);
        showToast('Could not auto-fill from link. Please enter details manually.');
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = '<i class="fa-solid fa-wand-magic-sparkles mr-1"></i> Auto-fill';
        }
    }
}

function openSermonItemModal(mode = 'add', id = null, defaultType = 'playlist') {
    const form = document.getElementById('sermon-item-form');
    form.reset();
    _lastSermonAutoFilledUrl = '';
    setSermonAutoFillStatus('');
    ['sermon-item-title', 'sermon-item-image', 'sermon-item-curator', 'sermon-item-description', 'sermon-item-tracks'].forEach(elId => {
        const el = document.getElementById(elId);
        if (el) delete el.dataset.autoFilled;
    });
    document.getElementById('edit-sermon-id').value = '';
    document.getElementById('sermon-item-image').value = '';
    document.getElementById('spotlight-sermons-container').innerHTML = '';
    updateSermonCoverPreview('');

    document.getElementById('sermon-item-type').value = defaultType;
    document.getElementById('sermon-item-featured').checked = true;
    document.getElementById('sermon-item-visible').checked = true;

    if (mode === 'edit' && id) {
        document.getElementById('sermon-modal-heading').textContent = 'Edit Sermon Entry';
        const list = defaultType === 'pastor'
            ? sermonsConfig.pastors
            : (defaultType === 'ministry' ? sermonsConfig.ministries : sermonsConfig.playlists);
        const item = list.find(x => x.id === id);
        if (item) {
            document.getElementById('edit-sermon-id').value = item.id;
            document.getElementById('sermon-item-title').value = item.title || '';
            document.getElementById('sermon-item-genre').value = item.genre || '';
            document.getElementById('sermon-item-curator').value = item.curator || '';
            document.getElementById('sermon-item-image').value = item.image || '';
            updateSermonCoverPreview(item.image || '');
            document.getElementById('sermon-item-link').value = item.link || '';
            document.getElementById('sermon-item-description').value = item.article || item.description || '';
            document.getElementById('sermon-item-featured').checked = item.featured !== false;
            document.getElementById('sermon-item-visible').checked = item.hidden !== true;

            if (defaultType === 'playlist') {
                const links = item.links && typeof item.links === 'object' ? item.links : {};
                const legacyLink = String(item.link || '').trim();
                const legacyLower = legacyLink.toLowerCase();
                document.getElementById('sermon-spotify-link').value =
                    links.spotify || item.spotifyLink || (legacyLower.includes('spotify.com') ? legacyLink : '');
                document.getElementById('sermon-apple-link').value =
                    links.apple || item.appleMusicLink || ((legacyLower.includes('music.apple.com') || legacyLower.includes('podcasts.apple.com')) ? legacyLink : '');
                document.getElementById('sermon-audiomack-link').value =
                    links.audiomack || item.audiomackLink || (legacyLower.includes('audiomack.com') ? legacyLink : '');
                if (Array.isArray(item.tracks)) {
                    document.getElementById('sermon-item-tracks').value = item.tracks
                        .map(t => t.artist ? `${t.title} - ${t.artist}` : t.title)
                        .join('\n');
                }
            } else {
                const songs = Array.isArray(item.songs) ? item.songs : [];
                if (songs.length > 0) songs.forEach(s => addSpotlightSermonRow(s.title, s.link));
                else addSpotlightSermonRow();
            }
        }
    } else {
        document.getElementById('sermon-modal-heading').textContent =
            defaultType === 'pastor' ? 'Add Pastor Spotlight' : (defaultType === 'ministry' ? 'Add Ministry Spotlight' : 'Add Sermon Playlist');
        addSpotlightSermonRow();
    }

    toggleSermonTypeFields();
    const modal = document.getElementById('sermon-item-modal');
    modal.classList.remove('hidden');
    modal.classList.add('flex');
}

function closeSermonItemModal() {
    const modal = document.getElementById('sermon-item-modal');
    modal.classList.add('hidden');
    modal.classList.remove('flex');
}

async function handleSaveSermonItem(e) {
    e.preventDefault();
    const existingId = document.getElementById('edit-sermon-id').value;
    const id = existingId || 'serm-' + Date.now();
    const type = document.getElementById('sermon-item-type').value;
    let title = document.getElementById('sermon-item-title').value.trim();
    const genre = document.getElementById('sermon-item-genre').value.trim();
    let curator = document.getElementById('sermon-item-curator').value.trim();
    let image = document.getElementById('sermon-item-image').value.trim();
    const link = document.getElementById('sermon-item-link').value.trim();
    let description = document.getElementById('sermon-item-description').value.trim();
    const featured = document.getElementById('sermon-item-featured').checked;
    const visible = document.getElementById('sermon-item-visible').checked;

    const spotify = document.getElementById('sermon-spotify-link')?.value.trim() || '';
    const apple = document.getElementById('sermon-apple-link')?.value.trim() || '';
    const audiomack = document.getElementById('sermon-audiomack-link')?.value.trim() || '';

    const songs = [];
    if (type !== 'playlist') {
        document.querySelectorAll('#spotlight-sermons-container .spotlight-sermon-row').forEach(row => {
            const sTitle = row.querySelector('.sermon-row-title')?.value.trim();
            const sLink = row.querySelector('.sermon-row-link')?.value.trim();
            if (sTitle || sLink) songs.push({ title: sTitle || title, link: sLink || '' });
        });
    }

    if (!image) {
        const candidateLinks = type === 'playlist'
            ? [spotify, apple, audiomack, link].filter(Boolean)
            : [link, ...songs.map(s => s.link)].filter(Boolean);
        if (candidateLinks.length > 0) {
            const submitBtn = e.target?.querySelector('button[type="submit"]');
            const originalBtnHtml = submitBtn ? submitBtn.innerHTML : '';
            if (submitBtn) {
                submitBtn.disabled = true;
                submitBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin mr-1.5"></i> Pulling cover...';
            }
            try {
                for (const candidate of candidateLinks) {
                    const meta = await fetchSermonLinkMetadata(candidate);
                    if (meta) {
                        if (!image && meta.image) image = meta.image;
                        if (!title && meta.title) title = meta.title;
                        if (!curator && (meta.curator || meta.artist)) curator = meta.curator || meta.artist;
                        if (!description && meta.description) description = meta.description;
                        if (image) break;
                    }
                }
                if (image) {
                    document.getElementById('sermon-item-image').value = image;
                    updateSermonCoverPreview(image);
                }
            } finally {
                if (submitBtn) {
                    submitBtn.disabled = false;
                    submitBtn.innerHTML = originalBtnHtml;
                }
            }
        }
    }

    if (!image) {
        showToast('Please upload a cover image or paste a streaming link with cover art.');
        return;
    }

    const tracks = type === 'playlist'
        ? document.getElementById('sermon-item-tracks').value.split('\n').map(l => l.trim()).filter(Boolean).map(line => {
            const idx = line.indexOf(' - ');
            return idx !== -1 ? { title: line.slice(0, idx).trim(), artist: line.slice(idx + 3).trim() } : { title: line, artist: '' };
        })
        : [];

    const record = {
        id,
        title,
        genre,
        curator,
        image,
        link: type === 'playlist' ? (spotify || apple || audiomack || link) : link,
        ...(type === 'playlist' ? { links: { spotify, apple, audiomack } } : {}),
        description,
        article: description,
        tracks,
        songs,
        approved: true,
        featured,
        hidden: !visible,
        createdAt: new Date().toISOString()
    };

    sermonsConfig.playlists = sermonsConfig.playlists.filter(x => x.id !== id);
    sermonsConfig.pastors = sermonsConfig.pastors.filter(x => x.id !== id);
    sermonsConfig.ministries = sermonsConfig.ministries.filter(x => x.id !== id);

    if (type === 'pastor') sermonsConfig.pastors.push(record);
    else if (type === 'ministry') sermonsConfig.ministries.push(record);
    else sermonsConfig.playlists.push(record);

    closeSermonItemModal();
    if (await persistSermonsConfig()) {
        showToast('Sermons entry saved!');
    }
}

async function toggleSermonItemFeatured(id, kind) {
    const list = kind === 'pastor' ? sermonsConfig.pastors : (kind === 'ministry' ? sermonsConfig.ministries : sermonsConfig.playlists);
    const item = list.find(x => x.id === id);
    if (!item) return;
    item.featured = item.featured === false;
    await persistSermonsConfig();
    const offLabel = kind === 'playlist' ? 'All Sermon Playlists Only' : 'Blog Only';
    showToast(`${item.title} is now ${item.featured ? 'Featured on Sermons Hub' : offLabel}.`);
}

async function toggleSermonItemVisibility(id, kind) {
    const list = kind === 'pastor' ? sermonsConfig.pastors : (kind === 'ministry' ? sermonsConfig.ministries : sermonsConfig.playlists);
    const item = list.find(x => x.id === id);
    if (!item) return;
    item.hidden = !item.hidden;
    await persistSermonsConfig();
    showToast(`"${item.title}" is now ${item.hidden ? 'hidden from public pages' : 'visible to the public'}.`);
}

async function deleteSermonItem(id, kind) {
    if (!confirm('Delete this entry permanently?')) return;
    if (kind === 'pastor') sermonsConfig.pastors = sermonsConfig.pastors.filter(x => x.id !== id);
    else if (kind === 'ministry') sermonsConfig.ministries = sermonsConfig.ministries.filter(x => x.id !== id);
    else sermonsConfig.playlists = sermonsConfig.playlists.filter(x => x.id !== id);
    if (await persistSermonsConfig()) showToast('Entry deleted.');
}

function openSermonSpotlightModal(mode = 'add', id = null) {
    _lastSermonSpotUrl = '';
    document.getElementById('edit-sermon-spotlight-id').value = '';
    document.getElementById('sermon-spot-link').value = '';
    document.getElementById('sermon-spot-title').value = '';
    document.getElementById('sermon-spot-artist').value = '';
    document.getElementById('sermon-spot-visible').checked = true;

    if (mode === 'edit' && id) {
        document.getElementById('sermon-spotlight-modal-heading').textContent = 'Edit Sermon Spotlight';
        const s = sermonsConfig.sermonSpotlights.find(x => x.id === id);
        if (s) {
            document.getElementById('edit-sermon-spotlight-id').value = s.id;
            document.getElementById('sermon-spot-link').value = s.link || '';
            document.getElementById('sermon-spot-title').value = s.title || '';
            document.getElementById('sermon-spot-artist').value = s.artist || '';
            document.getElementById('sermon-spot-visible').checked = s.hidden !== true;
        }
    } else {
        document.getElementById('sermon-spotlight-modal-heading').textContent = 'Add Sermon Spotlight';
    }
    const modal = document.getElementById('sermon-spotlight-modal');
    modal.classList.remove('hidden');
    modal.classList.add('flex');
}

function closeSermonSpotlightModal() {
    const modal = document.getElementById('sermon-spotlight-modal');
    modal.classList.add('hidden');
    modal.classList.remove('flex');
}

let _sermonSpotAutoFillTimer = null;
let _lastSermonSpotUrl = '';

function scheduleSermonSpotlightAutoFill(rawUrl, immediate = false) {
    clearTimeout(_sermonSpotAutoFillTimer);
    const delay = immediate ? 80 : 450;
    _sermonSpotAutoFillTimer = setTimeout(async () => {
        const url = String(rawUrl || document.getElementById('sermon-spot-link')?.value || '').trim();
        if (!url || !/^https?:\/\//i.test(url) || url === _lastSermonSpotUrl) return;
        _lastSermonSpotUrl = url;
        const meta = await fetchSermonLinkMetadata(url);
        if (!meta) return;
        const titleEl = document.getElementById('sermon-spot-title');
        const artistEl = document.getElementById('sermon-spot-artist');
        if (meta.title && titleEl && !titleEl.value.trim()) titleEl.value = meta.title;
        const preacher = meta.curator || meta.artist || '';
        if (preacher && artistEl && !artistEl.value.trim()) artistEl.value = preacher;
    }, delay);
}

async function autoFillSingleSermonSpotlight() {
    const url = document.getElementById('sermon-spot-link')?.value.trim();
    if (!url) {
        showToast('Paste a streaming link first.');
        return;
    }
    const btn = document.getElementById('sermon-spot-autofill-btn');
    if (btn) { btn.disabled = true; btn.textContent = '...'; }
    try {
        const meta = await fetchSermonLinkMetadata(url);
        if (meta) {
            if (meta.title) document.getElementById('sermon-spot-title').value = meta.title;
            const preacher = meta.curator || meta.artist || '';
            if (preacher && !document.getElementById('sermon-spot-artist').value) {
                document.getElementById('sermon-spot-artist').value = preacher;
            }
            showToast('Sermon info auto-filled!');
        } else {
            showToast('Could not auto-fill from link.');
        }
    } catch {
        showToast('Could not auto-fill from link.');
    } finally {
        if (btn) { btn.disabled = false; btn.textContent = 'Auto-fill'; }
    }
}

async function handleSaveSermonSpotlight(e) {
    e.preventDefault();
    const existingId = document.getElementById('edit-sermon-spotlight-id').value;
    const id = existingId || 'ss-' + Date.now();
    const record = {
        id,
        link: document.getElementById('sermon-spot-link').value.trim(),
        title: document.getElementById('sermon-spot-title').value.trim(),
        artist: document.getElementById('sermon-spot-artist').value.trim(),
        hidden: !document.getElementById('sermon-spot-visible').checked
    };
    sermonsConfig.sermonSpotlights = sermonsConfig.sermonSpotlights.filter(x => x.id !== id);
    sermonsConfig.sermonSpotlights.push(record);
    closeSermonSpotlightModal();
    if (await persistSermonsConfig()) showToast('Sermon Spotlight saved!');
}

async function toggleSermonSpotlightVisibility(id) {
    const s = sermonsConfig.sermonSpotlights.find(x => x.id === id);
    if (!s) return;
    s.hidden = !s.hidden;
    await persistSermonsConfig();
}

async function deleteSermonSpotlight(id) {
    if (!confirm('Delete this featured sermon?')) return;
    sermonsConfig.sermonSpotlights = sermonsConfig.sermonSpotlights.filter(x => x.id !== id);
    if (await persistSermonsConfig()) showToast('Sermon Spotlight deleted.');
}

// ==========================================
// BULK IMPORT SERMONS, PASTORS & MINISTRIES FROM EXCEL
// ==========================================

let excelSermonDrafts = [];

const SERMON_EXCEL_TYPE_META = {
    playlist: { label: 'Sermon Playlist', badge: 'bg-blue-50 text-accord-blue', icon: 'fa-solid fa-list-ul' },
    pastor: { label: 'Pastor Spotlight', badge: 'bg-amber-50 text-amber-800', icon: 'fa-solid fa-user-tie' },
    ministry: { label: 'Ministry Spotlight', badge: 'bg-indigo-50 text-indigo-700', icon: 'fa-solid fa-church' },
    sermon: { label: 'Featured Sermon', badge: 'bg-emerald-50 text-emerald-700', icon: 'fa-solid fa-microphone-lines' }
};

function openSermonsExcelImportModal(defaultType = 'auto') {
    excelSermonDrafts = [];
    const fileInput = document.getElementById('sermons-excel-file');
    if (fileInput) fileInput.value = '';
    const filenameEl = document.getElementById('sermons-excel-filename');
    if (filenameEl) filenameEl.textContent = 'No file selected';
    const typeSelect = document.getElementById('sermons-excel-default-type');
    if (typeSelect) typeSelect.value = defaultType || 'auto';
    document.getElementById('sermons-excel-progress-wrap')?.classList.add('hidden');
    document.getElementById('sermons-excel-preview-wrap')?.classList.add('hidden');
    const tbody = document.getElementById('sermons-excel-preview-body');
    if (tbody) tbody.innerHTML = '';
    const confirmBtn = document.getElementById('sermons-excel-confirm-btn');
    if (confirmBtn) {
        confirmBtn.disabled = true;
        confirmBtn.innerHTML = '<i class="fa-solid fa-check mr-1.5"></i> Import Entries';
    }
    const modal = document.getElementById('excel-sermons-import-modal');
    if (modal) {
        modal.classList.remove('hidden');
        modal.classList.add('flex');
    }
}

function closeSermonsExcelImportModal() {
    const modal = document.getElementById('excel-sermons-import-modal');
    if (modal) {
        modal.classList.remove('flex');
        modal.classList.add('hidden');
    }
    excelSermonDrafts = [];
}

function downloadSermonsExcelTemplate() {
    if (typeof XLSX === 'undefined') {
        showToast('Excel library is still loading. Please try again in a moment.');
        return;
    }

    const workbook = XLSX.utils.book_new();

    const playlistRows = [
        {
            Title: 'Kingdom Foundations Series',
            'Spotify Link': 'https://open.spotify.com/show/example',
            'Apple Link': '',
            'Audiomack Link': '',
            Topic: 'Faith & Grace',
            'Preacher / Curator': 'Pastor John Doe',
            Description: 'Foundational teachings on faith, grace, and purpose.',
            'Episodes / Tracks': 'Walking in Faith - Pastor John Doe; Power of Grace - Pastor John Doe',
            'Cover URL': '',
            Featured: 'Yes',
            Visible: 'Yes'
        }
    ];

    const pastorRows = [
        {
            Name: 'Pastor John Doe',
            'Topic / Focus': 'Faith & Leadership',
            'Primary Link': 'https://open.spotify.com/show/example',
            'Cover URL': '',
            'Featured Sermons': 'Walking in Faith | https://open.spotify.com/episode/example1; Living with Purpose | https://open.spotify.com/episode/example2',
            'Bio / Article': 'Senior pastor and author teaching practical biblical wisdom.',
            Featured: 'Yes',
            Visible: 'Yes'
        }
    ];

    const ministryRows = [
        {
            Name: 'Grace City Ministry',
            'Topic / Focus': 'Worship & Discipleship',
            'Primary Link': 'https://open.spotify.com/show/example',
            'Cover URL': '',
            'Featured Sermons': 'Sunday Teaching Series | https://open.spotify.com/episode/example3',
            'Description / Article': 'A teaching and worship ministry equipping believers.',
            Featured: 'Yes',
            Visible: 'Yes'
        }
    ];

    const sermonRows = [
        {
            'Sermon Title': 'Walking by Faith',
            'Preacher / Ministry': 'Pastor John Doe',
            'Streaming Link': 'https://open.spotify.com/episode/example1',
            Visible: 'Yes'
        }
    ];

    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(playlistRows), 'Sermon Playlists');
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(pastorRows), 'Pastors');
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(ministryRows), 'Ministries');
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(sermonRows), 'Sermons');

    XLSX.writeFile(workbook, 'Accord_Sermons_Pastors_Ministries_Template.xlsx');
    showToast('Sample Excel template downloaded!');
}

function normalizeExcelHeader(key) {
    return String(key || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function normalizeUrlForDupCheck(url) {
    const raw = String(url || '').trim();
    if (!raw) return '';
    try {
        const u = new URL(raw);
        return `${u.hostname.toLowerCase()}${u.pathname.replace(/\/+$/, '')}`;
    } catch {
        return raw.toLowerCase();
    }
}

function parseExcelBoolean(val, defaultVal = true, isNegated = false) {
    const str = String(val ?? '').trim().toLowerCase();
    if (!str) return defaultVal;
    const falsy = ['false', 'no', '0', 'hidden', 'n', 'off'];
    const truthy = ['true', 'yes', '1', 'visible', 'y', 'on'];
    if (isNegated) {
        if (truthy.includes(str)) return false;
        if (falsy.includes(str)) return true;
        return defaultVal;
    }
    if (falsy.includes(str)) return false;
    if (truthy.includes(str)) return true;
    return defaultVal;
}

function parsePlaylistTracksText(raw) {
    if (!raw) return [];
    const lines = String(raw).includes('\n') ? String(raw).split('\n') : String(raw).split(';');
    return lines
        .map(l => l.trim())
        .filter(Boolean)
        .map(line => {
            const idx = line.indexOf(' - ');
            return idx !== -1
                ? { title: line.slice(0, idx).trim(), artist: line.slice(idx + 3).trim() }
                : { title: line, artist: '' };
        });
}

function parseSpotlightSermonsText(raw, fallbackTitle = '') {
    if (!raw) return [];
    const lines = String(raw).includes('\n') ? String(raw).split('\n') : String(raw).split(';');
    return lines
        .map(l => l.trim())
        .filter(Boolean)
        .map(line => {
            if (line.includes('|')) {
                const [t, ...rest] = line.split('|');
                return { title: t.trim() || fallbackTitle, link: rest.join('|').trim() };
            }
            const urlMatch = line.match(/https?:\/\/\S+/i);
            if (urlMatch) {
                const link = urlMatch[0];
                const title = line.replace(link, '').replace(/[-–—:]\s*$/, '').trim();
                return { title: title || fallbackTitle, link };
            }
            return { title: line, link: '' };
        })
        .filter(s => s.title || s.link);
}

function normalizeSermonEntryType(rawType) {
    const t = String(rawType || '').trim().toLowerCase();
    if (!t) return '';
    if (t.includes('pastor') || t.includes('preacher') || t.includes('speaker')) return 'pastor';
    if (t.includes('ministr') || t.includes('church')) return 'ministry';
    if (t === 'sermon' || t === 'sermons' || t.includes('spotlight') || t.includes('individual') || t.includes('episode')) return 'sermon';
    if (t.includes('playlist') || t.includes('series')) return 'playlist';
    return '';
}

function inferSermonRowType(sheetName, normalizedRow, fallbackType = 'auto') {
    const explicitType = normalizeSermonEntryType(
        normalizedRow.type || normalizedRow.entrytype || normalizedRow.kind || normalizedRow.section
    );
    if (explicitType) return explicitType;

    const sheetType = normalizeSermonEntryType(sheetName);
    if (sheetType) return sheetType;

    if (fallbackType && fallbackType !== 'auto') return fallbackType;

    if (normalizedRow.sermontitle || normalizedRow.streaminglink) return 'sermon';
    if (normalizedRow.pastorname || normalizedRow.bioarticle || normalizedRow.bio) return 'pastor';
    if (normalizedRow.ministryname || normalizedRow.churchname) return 'ministry';
    return 'playlist';
}

function mapExcelRowToSermonDraft(rawRow, index, sheetName, fallbackType) {
    const normalized = {};
    Object.entries(rawRow || {}).forEach(([k, v]) => {
        normalized[normalizeExcelHeader(k)] = String(v ?? '').trim();
    });

    const pick = (...keys) => {
        for (const k of keys) {
            if (normalized[k]) return normalized[k];
        }
        return '';
    };

    const kind = inferSermonRowType(sheetName, normalized, fallbackType);

    const spotifyLink = pick('spotifylink', 'spotifyurl', 'spotify');
    const appleLink = pick('applelink', 'applepodcastslink', 'applemusiclink', 'appleurl', 'apple');
    const audiomackLink = pick('audiomacklink', 'audiomackurl', 'audiomack');
    const genericLink = pick('streaminglink', 'primarylink', 'profilelink', 'link', 'url');

    const title = pick(
        'title', 'name', 'sermontitle', 'playlisttitle', 'playlistname',
        'pastorname', 'ministryname', 'churchname', 'series'
    );
    const curator = pick(
        'preachercurator', 'preacherministry', 'preacher', 'curator',
        'artist', 'speaker', 'author', 'ministry', 'pastor'
    );
    const genre = pick('topicfocus', 'topicseries', 'topic', 'focus', 'genre', 'category', 'series');
    const image = pick('coverurl', 'imageurl', 'image', 'cover', 'portrait', 'portraiturl', 'artwork');
    const description = pick('descriptionarticle', 'bioarticle', 'description', 'bio', 'article', 'summary', 'notes');

    const rawTracks = pick('episodestracks', 'episodes', 'tracks', 'tracklist');
    const rawFeaturedSermons = pick('featuredsermons', 'sermons', 'sermonlinks', 'songs');

    const tracks = kind === 'playlist' ? parsePlaylistTracksText(rawTracks) : [];
    const songs = (kind === 'pastor' || kind === 'ministry')
        ? parseSpotlightSermonsText(rawFeaturedSermons || rawTracks, title)
        : [];

    const visible = normalized.hidden !== undefined && normalized.hidden !== ''
        ? parseExcelBoolean(normalized.hidden, true, true)
        : parseExcelBoolean(normalized.visible, true, false);
    const featured = parseExcelBoolean(normalized.featured, true, false);

    return {
        rowIndex: index,
        sheetName: sheetName || '',
        kind,
        title,
        curator,
        genre,
        image,
        spotifyLink,
        appleLink,
        audiomackLink,
        link: genericLink || spotifyLink || appleLink || audiomackLink,
        description,
        tracks,
        songs,
        featured,
        visible,
        selected: true,
        isDuplicate: false,
        fetchStatus: 'pending'
    };
}

function isDuplicateSermonDraft(draft) {
    const draftTitle = String(draft.title || '').trim().toLowerCase();
    const draftLinks = [
        draft.link,
        draft.spotifyLink,
        draft.appleLink,
        draft.audiomackLink
    ].map(normalizeUrlForDupCheck).filter(Boolean);

    const targetList = draft.kind === 'pastor'
        ? sermonsConfig.pastors
        : (draft.kind === 'ministry'
            ? sermonsConfig.ministries
            : (draft.kind === 'sermon' ? sermonsConfig.sermonSpotlights : sermonsConfig.playlists));

    return targetList.some(existing => {
        const existingTitle = String(existing.title || '').trim().toLowerCase();
        if (draftTitle && existingTitle && draftTitle === existingTitle) return true;

        const existingLinks = [
            existing.link,
            existing.links?.spotify,
            existing.links?.apple,
            existing.links?.audiomack
        ].map(normalizeUrlForDupCheck).filter(Boolean);

        return draftLinks.some(u => existingLinks.includes(u));
    });
}

function recheckSermonsExcelDuplicates() {
    const skipDuplicates = document.getElementById('sermons-excel-skip-duplicates')?.checked !== false;
    excelSermonDrafts.forEach(draft => {
        draft.isDuplicate = isDuplicateSermonDraft(draft);
        if (draft.isDuplicate && skipDuplicates) {
            draft.selected = false;
        }
    });
    renderSermonsExcelPreview();
}

function toggleAllSermonsExcelRows(checked) {
    const skipDuplicates = document.getElementById('sermons-excel-skip-duplicates')?.checked !== false;
    excelSermonDrafts.forEach(draft => {
        if (checked && draft.isDuplicate && skipDuplicates) {
            draft.selected = false;
        } else {
            draft.selected = Boolean(checked);
        }
    });
    renderSermonsExcelPreview();
}

function toggleSermonsExcelRow(index, checked) {
    if (!excelSermonDrafts[index]) return;
    excelSermonDrafts[index].selected = Boolean(checked);
    updateSermonsExcelSummary();
}

function updateSermonsExcelSummary() {
    const selected = excelSermonDrafts.filter(d => d.selected && d.title);
    const dupCount = excelSermonDrafts.filter(d => d.isDuplicate).length;
    const summaryEl = document.getElementById('sermons-excel-summary');
    if (summaryEl) {
        summaryEl.textContent = `${selected.length} of ${excelSermonDrafts.length} entries selected` +
            (dupCount > 0 ? ` (${dupCount} duplicate${dupCount === 1 ? '' : 's'} detected)` : '');
    }
    const confirmBtn = document.getElementById('sermons-excel-confirm-btn');
    if (confirmBtn) {
        confirmBtn.disabled = selected.length === 0;
        confirmBtn.innerHTML = `<i class="fa-solid fa-check mr-1.5"></i> Import ${selected.length || ''} Entr${selected.length === 1 ? 'y' : 'ies'}`;
    }
}

function renderSermonsExcelPreview() {
    const previewWrap = document.getElementById('sermons-excel-preview-wrap');
    const tbody = document.getElementById('sermons-excel-preview-body');
    if (!tbody || !previewWrap) return;

    previewWrap.classList.remove('hidden');
    tbody.innerHTML = '';

    excelSermonDrafts.forEach((draft, idx) => {
        const typeMeta = SERMON_EXCEL_TYPE_META[draft.kind] || SERMON_EXCEL_TYPE_META.playlist;
        const hasLink = Boolean(draft.link || draft.spotifyLink || draft.appleLink || draft.audiomackLink);

        let statusBadge = '<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-700">Ready</span>';
        if (draft.fetchStatus === 'loading') {
            statusBadge = '<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-100 text-blue-700"><i class="fa-solid fa-spinner fa-spin mr-1"></i>Fetching</span>';
        } else if (draft.isDuplicate) {
            statusBadge = '<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-800">Duplicate</span>';
        } else if (!draft.title) {
            statusBadge = '<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-100 text-rose-700">Missing Title</span>';
        } else if (draft.kind !== 'sermon' && !draft.image) {
            statusBadge = '<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-800">No Cover</span>';
        }

        const subInfo = draft.kind === 'playlist'
            ? `${draft.tracks.length} episode${draft.tracks.length === 1 ? '' : 's'}`
            : (draft.kind === 'sermon'
                ? (hasLink ? 'Streaming link ready' : 'No link')
                : `${draft.songs.length} featured sermon${draft.songs.length === 1 ? '' : 's'}`);

        const tr = document.createElement('tr');
        tr.className = draft.isDuplicate ? 'bg-amber-50/40' : 'hover:bg-slate-50/80';
        tr.innerHTML = `
            <td class="py-2.5 px-3">
                <input type="checkbox" ${draft.selected ? 'checked' : ''} onchange="toggleSermonsExcelRow(${idx}, this.checked)" class="w-4 h-4 accent-emerald-600 rounded">
            </td>
            <td class="py-2.5 px-3">
                ${draft.image
                    ? `<img src="${escapeHTML(draft.image)}" alt="" class="w-10 h-10 rounded-xl object-cover border border-slate-200">`
                    : `<div class="w-10 h-10 rounded-xl bg-slate-100 text-slate-400 flex items-center justify-center border border-slate-200"><i class="${typeMeta.icon}"></i></div>`
                }
            </td>
            <td class="py-2.5 px-3 whitespace-nowrap">
                <span class="px-2.5 py-1 rounded-full text-[10px] font-bold ${typeMeta.badge}">${typeMeta.label}</span>
            </td>
            <td class="py-2.5 px-3">
                <p class="font-bold text-accord-slate">${escapeHTML(draft.title || '(Untitled)')}</p>
                <p class="text-[11px] text-accord-muted">${escapeHTML(draft.curator || '—')}</p>
            </td>
            <td class="py-2.5 px-3">
                <p class="text-accord-slate font-medium">${escapeHTML(draft.genre || '—')}</p>
                <p class="text-[10px] text-accord-muted mt-0.5">${escapeHTML(subInfo)}</p>
            </td>
            <td class="py-2.5 px-3 whitespace-nowrap">${statusBadge}</td>
        `;
        tbody.appendChild(tr);
    });

    updateSermonsExcelSummary();
}

async function handleSermonsExcelUpload(event) {
    const file = event?.target?.files?.[0];
    if (!file) return;

    if (typeof XLSX === 'undefined') {
        showToast('Excel library is still loading. Please try again in a moment.');
        return;
    }

    const filenameEl = document.getElementById('sermons-excel-filename');
    if (filenameEl) filenameEl.textContent = file.name;

    const fallbackType = document.getElementById('sermons-excel-default-type')?.value || 'auto';

    try {
        const buffer = await file.arrayBuffer();
        const workbook = XLSX.read(buffer, { type: 'array' });
        if (!workbook.SheetNames || workbook.SheetNames.length === 0) {
            showToast('The uploaded file has no sheets.');
            return;
        }

        const drafts = [];
        workbook.SheetNames.forEach(sheetName => {
            const sheet = workbook.Sheets[sheetName];
            const rawRows = XLSX.utils.sheet_to_json(sheet, { defval: '' });
            rawRows.forEach(rawRow => {
                const draft = mapExcelRowToSermonDraft(rawRow, drafts.length, sheetName, fallbackType);
                if (draft.title || draft.link || draft.spotifyLink || draft.appleLink || draft.audiomackLink) {
                    drafts.push(draft);
                }
            });
        });

        if (drafts.length === 0) {
            showToast('No valid sermon, pastor, or ministry rows found in the spreadsheet.');
            return;
        }

        excelSermonDrafts = drafts;
        recheckSermonsExcelDuplicates();
        await enrichSermonsExcelDrafts();
    } catch (err) {
        console.error('Excel parse error:', err);
        showToast('Could not read Excel file. Please check the format.');
    }
}

async function enrichSermonsExcelDrafts() {
    const progressWrap = document.getElementById('sermons-excel-progress-wrap');
    const progressText = document.getElementById('sermons-excel-progress-text');
    const progressCount = document.getElementById('sermons-excel-progress-count');
    const progressBar = document.getElementById('sermons-excel-progress-bar');

    const targets = excelSermonDrafts.filter(d => {
        const sourceUrl = d.spotifyLink || d.appleLink || d.audiomackLink || d.link;
        if (!sourceUrl) return false;
        if (d.kind === 'sermon') return !d.title || !d.curator;
        return !d.title || !d.image || (d.kind === 'playlist' && (!d.curator || d.tracks.length === 0));
    });

    if (targets.length === 0) return;

    progressWrap?.classList.remove('hidden');
    let completed = 0;
    const total = targets.length;
    const updateProgress = () => {
        if (progressCount) progressCount.textContent = `${completed} / ${total}`;
        if (progressBar) progressBar.style.width = `${Math.round((completed / total) * 100)}%`;
        if (progressText) {
            progressText.textContent = completed < total
                ? 'Fetching streaming covers & metadata...'
                : 'Metadata extraction complete!';
        }
    };
    updateProgress();

    const CONCURRENCY = 3;
    let cursor = 0;

    async function worker() {
        while (cursor < targets.length) {
            const draft = targets[cursor++];
            const sourceUrl = draft.spotifyLink || draft.appleLink || draft.audiomackLink || draft.link;
            draft.fetchStatus = 'loading';
            renderSermonsExcelPreview();

            try {
                const resp = await fetch(`/api/music-metadata?url=${encodeURIComponent(sourceUrl)}`);
                if (resp.ok) {
                    const meta = await resp.json();
                    if (!draft.title && meta.title) draft.title = meta.title;
                    if (!draft.image && meta.image) draft.image = meta.image;
                    if (!draft.curator && meta.curator) draft.curator = meta.curator;
                    if (!draft.description && meta.description) draft.description = meta.description;
                    if (draft.kind === 'playlist' && draft.tracks.length === 0 && Array.isArray(meta.tracks) && meta.tracks.length > 0) {
                        draft.tracks = meta.tracks
                            .map(t => ({ title: t.title || '', artist: t.artist || '' }))
                            .filter(t => t.title);
                    }
                    draft.fetchStatus = 'done';
                } else {
                    draft.fetchStatus = 'error';
                }
            } catch {
                draft.fetchStatus = 'error';
            }

            completed++;
            updateProgress();
            recheckSermonsExcelDuplicates();
        }
    }

    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, targets.length) }, () => worker()));
}

async function confirmSermonsExcelImport() {
    const toCreate = excelSermonDrafts.filter(d => d.selected && d.title);
    if (toCreate.length === 0) {
        showToast('Select at least one entry with a title to import.');
        return;
    }

    const baseTime = Date.now();
    const counts = { playlist: 0, pastor: 0, ministry: 0, sermon: 0 };

    toCreate.forEach((draft, idx) => {
        if (draft.kind === 'sermon') {
            sermonsConfig.sermonSpotlights.push({
                id: `ss-${baseTime}-${idx}`,
                link: draft.link || draft.spotifyLink || draft.appleLink || draft.audiomackLink || '',
                title: draft.title,
                artist: draft.curator || '',
                hidden: !draft.visible
            });
            counts.sermon++;
            return;
        }

        const primaryLink = draft.kind === 'playlist'
            ? (draft.spotifyLink || draft.appleLink || draft.audiomackLink || draft.link || '')
            : (draft.link || draft.spotifyLink || draft.appleLink || draft.audiomackLink || '');

        const record = {
            id: `serm-${baseTime}-${idx}`,
            title: draft.title,
            genre: draft.genre || '',
            curator: draft.curator || '',
            image: draft.image || '',
            link: primaryLink,
            ...(draft.kind === 'playlist' ? {
                links: {
                    spotify: draft.spotifyLink || '',
                    apple: draft.appleLink || '',
                    audiomack: draft.audiomackLink || ''
                }
            } : {}),
            description: draft.description || '',
            article: draft.description || '',
            tracks: draft.kind === 'playlist' ? draft.tracks : [],
            songs: draft.kind !== 'playlist' ? draft.songs : [],
            approved: true,
            featured: draft.featured,
            hidden: !draft.visible,
            createdAt: new Date().toISOString()
        };

        if (draft.kind === 'pastor') {
            sermonsConfig.pastors.push(record);
            counts.pastor++;
        } else if (draft.kind === 'ministry') {
            sermonsConfig.ministries.push(record);
            counts.ministry++;
        } else {
            sermonsConfig.playlists.push(record);
            counts.playlist++;
        }
    });

    closeSermonsExcelImportModal();
    if (await persistSermonsConfig()) {
        const parts = [];
        if (counts.playlist) parts.push(`${counts.playlist} playlist${counts.playlist === 1 ? '' : 's'}`);
        if (counts.pastor) parts.push(`${counts.pastor} pastor${counts.pastor === 1 ? '' : 's'}`);
        if (counts.ministry) parts.push(`${counts.ministry} ministr${counts.ministry === 1 ? 'y' : 'ies'}`);
        if (counts.sermon) parts.push(`${counts.sermon} sermon${counts.sermon === 1 ? '' : 's'}`);
        showToast(`Imported ${parts.join(', ')} from Excel!`);
    }
}
