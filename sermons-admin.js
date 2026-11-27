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

async function autoFillSermonMetadata() {
    const rawUrl = String(
        document.getElementById('sermon-apple-link')?.value ||
        document.getElementById('sermon-spotify-link')?.value ||
        document.getElementById('sermon-audiomack-link')?.value ||
        ''
    ).trim();
    if (!rawUrl) {
        showToast('Paste a Spotify, Apple Podcasts, or Audiomack link first.');
        return;
    }
    const btn = document.getElementById('sermon-playlist-autofill-btn');
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin mr-1"></i> Fetching...';
    }
    try {
        const res = await fetch(`/api/music-metadata?url=${encodeURIComponent(rawUrl)}`);
        const meta = await res.json();
        if (meta.title) document.getElementById('sermon-item-title').value = meta.title;
        if (meta.image && !document.getElementById('sermon-item-image').value) {
            document.getElementById('sermon-item-image').value = meta.image;
            updateSermonCoverPreview(meta.image);
        }
        if (meta.curator && !document.getElementById('sermon-item-curator').value) {
            document.getElementById('sermon-item-curator').value = meta.curator;
        }
        if (meta.description && !document.getElementById('sermon-item-description').value) {
            document.getElementById('sermon-item-description').value = meta.description;
        }
        if (Array.isArray(meta.tracks) && meta.tracks.length > 0) {
            document.getElementById('sermon-item-tracks').value = meta.tracks
                .map(t => t.artist ? `${t.title} - ${t.artist}` : t.title)
                .join('\n');
        }
        showToast('Details auto-filled from link!');
    } catch {
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
                const links = item.links || {};
                document.getElementById('sermon-spotify-link').value = links.spotify || '';
                document.getElementById('sermon-apple-link').value = links.apple || '';
                document.getElementById('sermon-audiomack-link').value = links.audiomack || '';
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
    const title = document.getElementById('sermon-item-title').value.trim();
    const genre = document.getElementById('sermon-item-genre').value.trim();
    const curator = document.getElementById('sermon-item-curator').value.trim();
    const image = document.getElementById('sermon-item-image').value.trim();
    const link = document.getElementById('sermon-item-link').value.trim();
    const description = document.getElementById('sermon-item-description').value.trim();
    const featured = document.getElementById('sermon-item-featured').checked;
    const visible = document.getElementById('sermon-item-visible').checked;

    if (!image) {
        showToast('Please upload a cover image first.');
        return;
    }

    const spotify = document.getElementById('sermon-spotify-link')?.value.trim() || '';
    const apple = document.getElementById('sermon-apple-link')?.value.trim() || '';
    const audiomack = document.getElementById('sermon-audiomack-link')?.value.trim() || '';

    const tracks = type === 'playlist'
        ? document.getElementById('sermon-item-tracks').value.split('\n').map(l => l.trim()).filter(Boolean).map(line => {
            const idx = line.indexOf(' - ');
            return idx !== -1 ? { title: line.slice(0, idx).trim(), artist: line.slice(idx + 3).trim() } : { title: line, artist: '' };
        })
        : [];

    const songs = [];
    if (type !== 'playlist') {
        document.querySelectorAll('#spotlight-sermons-container .spotlight-sermon-row').forEach(row => {
            const sTitle = row.querySelector('.sermon-row-title')?.value.trim();
            const sLink = row.querySelector('.sermon-row-link')?.value.trim();
            if (sTitle || sLink) songs.push({ title: sTitle || title, link: sLink || '' });
        });
    }

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
}

async function toggleSermonItemVisibility(id, kind) {
    const list = kind === 'pastor' ? sermonsConfig.pastors : (kind === 'ministry' ? sermonsConfig.ministries : sermonsConfig.playlists);
    const item = list.find(x => x.id === id);
    if (!item) return;
    item.hidden = !item.hidden;
    await persistSermonsConfig();
}

async function deleteSermonItem(id, kind) {
    if (!confirm('Delete this entry permanently?')) return;
    if (kind === 'pastor') sermonsConfig.pastors = sermonsConfig.pastors.filter(x => x.id !== id);
    else if (kind === 'ministry') sermonsConfig.ministries = sermonsConfig.ministries.filter(x => x.id !== id);
    else sermonsConfig.playlists = sermonsConfig.playlists.filter(x => x.id !== id);
    if (await persistSermonsConfig()) showToast('Entry deleted.');
}

function openSermonSpotlightModal(mode = 'add', id = null) {
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

async function autoFillSingleSermonSpotlight() {
    const url = document.getElementById('sermon-spot-link')?.value.trim();
    if (!url) {
        showToast('Paste a streaming link first.');
        return;
    }
    const btn = document.getElementById('sermon-spot-autofill-btn');
    if (btn) { btn.disabled = true; btn.textContent = '...'; }
    try {
        const res = await fetch(`/api/music-metadata?url=${encodeURIComponent(url)}`);
        const meta = await res.json();
        if (meta.title) document.getElementById('sermon-spot-title').value = meta.title;
        if (meta.curator && !document.getElementById('sermon-spot-artist').value) {
            document.getElementById('sermon-spot-artist').value = meta.curator;
        }
        showToast('Sermon info auto-filled!');
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
