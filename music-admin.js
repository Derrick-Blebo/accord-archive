// ==========================================
// ACCORD GOSPEL MUSIC & POLLS ADMIN
// ==========================================

let musicConfig = {
    artistes: [],
    playlists: [],
    songSpotlights: [],
    polls: [],
    submissions: [],
    spotlightSubmissions: [],
    pollNominations: []
};

let musicTableFilter = 'all';
let deleteTarget = { type: null, id: null };

// ==========================================
// AUTHENTICATION & PERMISSION GATE
// ==========================================

window.onload = async function () {
    await loadMusicConfigFromSupabase();
    const { data: { session } } = await supabaseClient.auth.getSession();

    if (session?.user?.email) {
        if (await hasMusicAdminPermission(session.user.email)) {
            unlockDashboard(session.user);
        } else {
            await supabaseClient.auth.signOut();
            showLoginError('Access denied. Music Admin permissions required.');
        }
    }
};

async function hasMusicAdminPermission(email) {
    if (!email) return false;
    const clean = email.trim().toLowerCase();
    if (clean === MASTER_ADMIN_EMAIL.toLowerCase()) return true;

    const { data } = await supabaseClient
        .from('books')
        .select('description')
        .eq('title', ROLES_CONFIG_RECORD_NAME)
        .maybeSingle();

    if (data?.description) {
        try {
            const registry = JSON.parse(data.description);
            if (Array.isArray(registry)) {
                const userEntry = registry.find(r => (r.email || '').toLowerCase() === clean);
                if (userEntry && userEntry.status === 'active') {
                    if (userEntry.isMaster || (userEntry.portals || []).includes('superadmin') || (userEntry.portals || []).includes('music')) {
                        return true;
                    }
                }
            }
        } catch (e) {}
    }

    const localSaved = localStorage.getItem('accord_roles_registry');
    if (localSaved) {
        try {
            const registry = JSON.parse(localSaved);
            const userEntry = registry.find(r => (r.email || '').toLowerCase() === clean);
            if (userEntry && userEntry.status === 'active') {
                if (userEntry.isMaster || (userEntry.portals || []).includes('superadmin') || (userEntry.portals || []).includes('music')) {
                    return true;
                }
            }
        } catch (e) {}
    }

    return false;
}

function showLoginError(msg) {
    const errorBox = document.getElementById('login-error');
    if (errorBox) {
        errorBox.innerText = msg;
        errorBox.classList.remove('hidden');
    }
}

async function handleLogin(e) {
    e.preventDefault();
    const email = document.getElementById('login-email').value.trim();
    const password = document.getElementById('login-password').value;
    const errorBox = document.getElementById('login-error');
    const submitBtn = document.getElementById('login-submit-btn');

    errorBox.classList.add('hidden');
    submitBtn.disabled = true;
    submitBtn.innerText = 'Verifying Credentials...';

    const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });

    submitBtn.disabled = false;
    submitBtn.innerText = 'Unlock Music Portal';

    if (error) {
        showLoginError(error.message || 'Invalid email or password.');
        return;
    }

    if (!await hasMusicAdminPermission(data?.user?.email)) {
        await supabaseClient.auth.signOut();
        showLoginError('Access denied. Your account is not authorized for Music Admin.');
        return;
    }

    unlockDashboard(data.user);
    showToast('Welcome to Gospel Music & Polls Admin!');
}

function unlockDashboard(user) {
    document.getElementById('auth-gate').classList.add('hidden');
    document.getElementById('dashboard-wrapper').classList.remove('hidden');
    const emailEl = document.getElementById('admin-user-email');
    if (emailEl && user?.email) emailEl.innerText = user.email;

    renderAll();
    loadAndRenderPlaylistInsights();
}

async function loadAndRenderPlaylistInsights() {
    const savedEl = document.getElementById('insights-most-saved');
    const engagedEl = document.getElementById('insights-most-engaged');
    if (!savedEl || !engagedEl) return;

    let stats = [];
    try {
        const { data, error } = await supabaseClient
            .from('playlist_stats')
            .select('playlist_id, playlist_title, save_count, play_count, platform_click_count, engagement_count, last_engaged_at')
            .order('engagement_count', { ascending: false })
            .limit(50);

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

    const titleById = new Map((musicConfig.playlists || []).map(p => [String(p.id), p.title]));
    const normalized = stats.map(row => ({
        playlist_id: String(row.playlist_id),
        playlist_title: titleById.get(String(row.playlist_id)) || row.playlist_title || row.playlist_id,
        save_count: Number(row.save_count || 0),
        play_count: Number(row.play_count || 0),
        platform_click_count: Number(row.platform_click_count || 0),
        engagement_count: Number(row.engagement_count || 0)
    }));

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
        'No playlist saves recorded yet.',
        row => `<span class="px-2.5 py-0.5 rounded-full bg-accord-lightBlue text-accord-blue font-bold">${row.save_count} saves</span>`
    );

    engagedEl.innerHTML = renderRows(
        mostEngaged,
        'No playlist engagement recorded yet.',
        row => `
            <span class="text-accord-muted">${row.play_count} plays</span>
            <span class="text-accord-muted">• ${row.platform_click_count} clicks</span>
            <span class="px-2.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700 font-bold">${row.engagement_count} total</span>
        `
    );
}

async function handleLogout() {
    await supabaseClient.auth.signOut();
    document.getElementById('dashboard-wrapper').classList.add('hidden');
    document.getElementById('auth-gate').classList.remove('hidden');
    document.getElementById('login-form').reset();
    showToast('Signed out successfully.');
}

// ==========================================
// DATA PERSISTENCE (STORED IN BOOKS TABLE)
// ==========================================

function normalizeConfig(parsed) {
    return {
        artistes: Array.isArray(parsed?.artistes) ? parsed.artistes : [],
        playlists: Array.isArray(parsed?.playlists) ? parsed.playlists : [],
        songSpotlights: Array.isArray(parsed?.songSpotlights) ? parsed.songSpotlights : [],
        polls: Array.isArray(parsed?.polls) ? parsed.polls : [],
        submissions: Array.isArray(parsed?.submissions) ? parsed.submissions : [],
        spotlightSubmissions: Array.isArray(parsed?.spotlightSubmissions) ? parsed.spotlightSubmissions : [],
        pollNominations: Array.isArray(parsed?.pollNominations) ? parsed.pollNominations : []
    };
}

async function loadMusicConfigFromSupabase() {
    const { data, error } = await supabaseClient
        .from('books')
        .select('id, description')
        .eq('title', MUSIC_CONFIG_RECORD_NAME)
        .maybeSingle();

    if (!error && data?.description) {
        try {
            const parsed = JSON.parse(data.description);
            musicConfig = normalizeConfig(parsed);
            localStorage.setItem('accord_music_config', JSON.stringify(musicConfig));
            return;
        } catch (e) {}
    }

    const localSaved = localStorage.getItem('accord_music_config');
    if (localSaved) {
        try {
            const parsed = JSON.parse(localSaved);
            musicConfig = normalizeConfig(parsed);
            return;
        } catch (e) {}
    }

    musicConfig = normalizeConfig({
        artistes: [
            { id: 'art-1', title: 'RichieO', genre: 'Contemporary Gospel', image: '', link: 'https://open.spotify.com/track/sample', description: 'Featured artiste for the UNVL Project.', approved: true, featured: true, songs: [] }
        ],
        playlists: [
            { id: 'pl-1', title: 'AfroGospel Vol. 1', genre: 'Afrobeat Gospel', image: '', link: 'https://open.spotify.com/playlist/sample', description: 'Curated by DJ ChristCentric.' }
        ],
        polls: [
            { id: 'poll-1', title: 'Song of the Year - 2026 Awards', nominees: ['RichieO - Higher Ground', 'OK Muziq - Gratitude', 'Pacome Ben Elohim - Grace'], votes: { 'RichieO - Higher Ground': 120, 'OK Muziq - Gratitude': 95, 'Pacome Ben Elohim - Grace': 140 }, status: 'open', endDate: '2026-12-31' }
        ]
    });
}

async function persistMusicConfig() {
    localStorage.setItem('accord_music_config', JSON.stringify(musicConfig));

    const { data: existing } = await supabaseClient
        .from('books')
        .select('id')
        .eq('title', MUSIC_CONFIG_RECORD_NAME)
        .maybeSingle();

    const payload = {
        title: MUSIC_CONFIG_RECORD_NAME,
        author: 'System Music Config',
        category: 'System',
        year: '2026',
        pages: '0',
        description: JSON.stringify(musicConfig),
        is_visible: false,
        status: 'system_config',
        is_for_sale: false,
        price: 0
    };

    let dbError = null;
    if (existing?.id) {
        const { error } = await supabaseClient.from('books').update(payload).eq('id', existing.id);
        dbError = error;
    } else {
        const { error } = await supabaseClient.from('books').insert([payload]);
        dbError = error;
    }

    if (dbError) {
        console.error('Failed to persist music config to Supabase:', dbError);
        showToast(`Warning: Saved locally, but database sync failed (${dbError.message || 'permission error'}).`);
    }

    renderAll();
    return !dbError;
}

// ==========================================
// NAVIGATION & CLICKABLE CARDS
// ==========================================

function focusAdminSection(sectionId, filterType) {
    if (filterType) {
        setMusicTableFilter(filterType);
    }
    const el = document.getElementById(sectionId);
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    el.classList.add('ring-2', 'ring-emerald-400', 'ring-offset-4', 'rounded-3xl');
    setTimeout(() => {
        el.classList.remove('ring-2', 'ring-emerald-400', 'ring-offset-4', 'rounded-3xl');
    }, 1200);
}

function setMusicTableFilter(filter) {
    musicTableFilter = filter;
    ['all', 'spotlight', 'playlist'].forEach(key => {
        const btn = document.getElementById(`filter-btn-${key}`);
        if (!btn) return;
        if (key === filter) {
            btn.className = 'px-3 py-1.5 rounded-lg bg-white text-accord-slate shadow-sm transition-all';
        } else {
            btn.className = 'px-3 py-1.5 rounded-lg text-accord-muted hover:text-accord-slate transition-all';
        }
    });
    renderMusicTable();
}

// ==========================================
// RENDERING UI
// ==========================================

function renderAll() {
    updateStats();
    renderMusicTable();
    renderSongSpotlightsTable();
    renderSpotlightSubmissionsTable();
    renderPollsTable();
    renderPollNominationsTable();
}

function updateStats() {
    document.getElementById('stat-spotlights').innerText = musicConfig.artistes.length;
    document.getElementById('stat-playlists').innerText = musicConfig.playlists.length;
    const songEl = document.getElementById('stat-song-spotlights');
    if (songEl) songEl.innerText = musicConfig.songSpotlights.length;
    document.getElementById('stat-polls').innerText = musicConfig.polls.filter(p => p.status === 'open' && !p.hidden).length;

    const pendingSpotlights = musicConfig.spotlightSubmissions.filter(s => s.status === 'pending').length;
    const pendingNoms = musicConfig.pollNominations.filter(n => n.status === 'pending').length;
    document.getElementById('stat-submissions').innerText = pendingSpotlights + pendingNoms + musicConfig.submissions.length;
}

function renderMusicTable() {
    const tbody = document.getElementById('music-table-body');
    if (!tbody) return;

    let allItems = [
        ...musicConfig.artistes.map(a => ({ ...a, entryType: 'spotlight', typeLabel: 'Artiste Spotlight' })),
        ...musicConfig.playlists.map(p => ({ ...p, entryType: 'playlist', typeLabel: 'Curated Playlist' }))
    ];

    if (musicTableFilter !== 'all') {
        allItems = allItems.filter(x => x.entryType === musicTableFilter);
    }

    tbody.innerHTML = '';
    if (allItems.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" class="py-10 text-center text-accord-muted">No spotlights or playlists in this view yet.</td></tr>`;
        return;
    }

    allItems.forEach(item => {
        const safeId = item.id;
        const isSpotlight = item.entryType === 'spotlight';
        const isFeatured = item.featured !== false;
        const isHidden = Boolean(item.hidden);
        const tr = document.createElement('tr');
        tr.className = `hover:bg-slate-50/90 transition-colors border-b border-slate-100 last:border-0 cursor-pointer ${isHidden ? 'opacity-65 bg-slate-50/40' : ''}`;
        tr.onclick = () => openMusicModal('edit', safeId);
        tr.innerHTML = `
            <td class="py-4 px-6">
                <div class="flex items-center space-x-3">
                    ${item.image
                        ? `<img src="${escapeHTML(item.image)}" alt="${escapeHTML(item.title)}" class="w-9 h-9 ${isSpotlight ? 'rounded-full' : 'rounded-xl'} object-cover shrink-0 border border-slate-200">`
                        : `<div class="w-9 h-9 ${isSpotlight ? 'rounded-full' : 'rounded-xl'} bg-emerald-50 text-emerald-600 font-bold flex items-center justify-center text-xs shrink-0"><i class="fa-solid ${isSpotlight ? 'fa-microphone' : 'fa-list-music'}"></i></div>`
                    }
                    <div>
                        <p class="font-bold text-accord-slate">${escapeHTML(item.title)}${isHidden ? ' <span class="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-200 text-slate-600 ml-1">Hidden</span>' : ''}</p>
                        <p class="text-[11px] text-accord-muted truncate max-w-xs">${escapeHTML(item.article || item.description || '')}</p>
                    </div>
                </div>
            </td>
            <td class="py-4 px-6"><span class="bg-slate-100 text-accord-slate text-[10px] font-bold px-2.5 py-1 rounded-lg">${item.typeLabel}</span></td>
            <td class="py-4 px-6 text-accord-muted">${escapeHTML(item.genre || 'General')}</td>
            <td class="py-4 px-6 text-center" onclick="event.stopPropagation()">
                <button type="button" onclick="toggleMusicItemFeatured('${safeId}', '${item.entryType}')" class="px-2.5 py-1 rounded-full text-[10px] font-bold transition-all ${isFeatured ? 'bg-amber-100 text-amber-800 hover:bg-amber-200' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'}">
                    <i class="fa-solid fa-star mr-1"></i>${isFeatured ? 'Featured' : (isSpotlight ? 'Blog Only' : 'All Playlists Only')}
                </button>
            </td>
            <td class="py-4 px-6 text-center" onclick="event.stopPropagation()">
                <button type="button" onclick="toggleMusicItemVisibility('${safeId}', '${item.entryType}')" class="px-2.5 py-1 rounded-full text-[10px] font-bold transition-all ${isHidden ? 'bg-slate-200 text-slate-600 hover:bg-slate-300' : 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100'}" title="${isHidden ? 'Show on public pages' : 'Hide from public pages'}">
                    <i class="fa-solid ${isHidden ? 'fa-eye-slash' : 'fa-eye'} mr-1"></i>${isHidden ? 'Hidden' : 'Visible'}
                </button>
            </td>
            <td class="py-4 px-6 text-right space-x-1.5 whitespace-nowrap" onclick="event.stopPropagation()">
                <button type="button" onclick="openMusicModal('edit', '${safeId}')" class="w-8 h-8 rounded-xl bg-slate-100 hover:bg-emerald-50 text-slate-600 hover:text-emerald-600 transition-all inline-flex items-center justify-center" title="Edit Entry">
                    <i class="fa-solid fa-pen text-xs"></i>
                </button>
                <button type="button" onclick="promptDeleteMusicItem('${safeId}', '${item.entryType}')" class="w-8 h-8 rounded-xl bg-slate-100 hover:bg-red-50 text-slate-600 hover:text-red-500 transition-all inline-flex items-center justify-center" title="Delete">
                    <i class="fa-solid fa-trash text-xs"></i>
                </button>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

function renderSongSpotlightsTable() {
    const tbody = document.getElementById('song-spotlights-table-body');
    if (!tbody) return;

    tbody.innerHTML = '';
    if (musicConfig.songSpotlights.length === 0) {
        tbody.innerHTML = `<tr><td colspan="4" class="py-8 text-center text-accord-muted">No song spotlights added yet.</td></tr>`;
        return;
    }

    musicConfig.songSpotlights.forEach(song => {
        const isHidden = Boolean(song.hidden);
        const tr = document.createElement('tr');
        tr.className = `hover:bg-slate-50/90 transition-colors border-b border-slate-100 last:border-0 cursor-pointer ${isHidden ? 'opacity-65 bg-slate-50/40' : ''}`;
        tr.onclick = () => openSongSpotlightModal('edit', song.id);
        tr.innerHTML = `
            <td class="py-4 px-6 font-bold text-accord-slate">${escapeHTML(song.title)}${isHidden ? ' <span class="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-200 text-slate-600 ml-1">Hidden</span>' : ''}</td>
            <td class="py-4 px-6 text-accord-blue truncate max-w-md" onclick="event.stopPropagation()">
                <a href="${escapeHTML(song.link)}" target="_blank" rel="noopener noreferrer" class="hover:underline">${escapeHTML(song.link)}</a>
            </td>
            <td class="py-4 px-6 text-center" onclick="event.stopPropagation()">
                <button type="button" onclick="toggleSongSpotlightVisibility('${song.id}')" class="px-2.5 py-1 rounded-full text-[10px] font-bold transition-all ${isHidden ? 'bg-slate-200 text-slate-600 hover:bg-slate-300' : 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100'}" title="${isHidden ? 'Show on Music Hub' : 'Hide from Music Hub'}">
                    <i class="fa-solid ${isHidden ? 'fa-eye-slash' : 'fa-eye'} mr-1"></i>${isHidden ? 'Hidden' : 'Visible'}
                </button>
            </td>
            <td class="py-4 px-6 text-right space-x-1.5 whitespace-nowrap" onclick="event.stopPropagation()">
                <button type="button" onclick="openSongSpotlightModal('edit', '${song.id}')" class="w-8 h-8 rounded-xl bg-slate-100 hover:bg-emerald-50 text-slate-600 hover:text-emerald-600 transition-all inline-flex items-center justify-center" title="Edit">
                    <i class="fa-solid fa-pen text-xs"></i>
                </button>
                <button type="button" onclick="promptDeleteSongSpotlight('${song.id}')" class="w-8 h-8 rounded-xl bg-slate-100 hover:bg-red-50 text-slate-600 hover:text-red-500 transition-all inline-flex items-center justify-center" title="Delete">
                    <i class="fa-solid fa-trash text-xs"></i>
                </button>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

function renderSpotlightSubmissionsTable() {
    const tbody = document.getElementById('spotlight-submissions-table-body');
    if (!tbody) return;

    tbody.innerHTML = '';
    if (musicConfig.spotlightSubmissions.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5" class="py-8 text-center text-accord-muted">No user artist spotlight submissions yet.</td></tr>`;
        return;
    }

    musicConfig.spotlightSubmissions.forEach(sub => {
        const status = sub.status || 'pending';
        const statusBadge = status === 'approved'
            ? `<span class="inline-flex px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-700">Approved</span>`
            : status === 'rejected'
                ? `<span class="inline-flex px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-red-50 text-red-600">Rejected</span>`
                : `<span class="inline-flex px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-amber-50 text-amber-700">Pending</span>`;

        const songsCount = Array.isArray(sub.songs) ? sub.songs.length : 0;
        const tr = document.createElement('tr');
        tr.className = "hover:bg-slate-50/80 transition-colors border-b border-slate-100 last:border-0";
        tr.innerHTML = `
            <td class="py-4 px-6">
                <div class="flex items-center gap-3">
                    ${sub.image
                        ? `<img src="${escapeHTML(sub.image)}" alt="${escapeHTML(sub.title)}" class="w-9 h-9 rounded-full object-cover border border-slate-200 shrink-0">`
                        : `<div class="w-9 h-9 rounded-full bg-purple-50 text-purple-600 flex items-center justify-center text-xs font-bold shrink-0"><i class="fa-solid fa-user"></i></div>`
                    }
                    <div class="min-w-0">
                        <p class="font-bold text-accord-slate">${escapeHTML(sub.title)} <span class="text-[10px] text-accord-muted font-normal">• ${escapeHTML(sub.genre || 'Gospel')}</span></p>
                        <p class="text-[11px] text-accord-muted truncate max-w-xs">${escapeHTML(sub.article || sub.description || '')}</p>
                    </div>
                </div>
            </td>
            <td class="py-4 px-6 text-accord-muted">${songsCount} ${songsCount === 1 ? 'song' : 'songs'}</td>
            <td class="py-4 px-6 text-accord-muted">${escapeHTML(sub.submittedByEmail || 'Registered User')}</td>
            <td class="py-4 px-6 text-center">${statusBadge}</td>
            <td class="py-4 px-6 text-right space-x-1.5 whitespace-nowrap">
                ${status === 'pending' ? `
                    <button type="button" onclick="approveSpotlightSubmission('${sub.id}', true)" class="px-2.5 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-[10px] font-bold transition-all" title="Approve & Feature on Music Page">
                        Approve &amp; Feature
                    </button>
                    <button type="button" onclick="approveSpotlightSubmission('${sub.id}', false)" class="px-2.5 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-accord-slate text-[10px] font-bold transition-all" title="Approve for Blog Only">
                        Blog Only
                    </button>
                ` : ''}
                <button type="button" onclick="deleteSpotlightSubmission('${sub.id}')" class="w-8 h-8 rounded-xl bg-slate-100 hover:bg-red-50 text-slate-600 hover:text-red-500 transition-all inline-flex items-center justify-center" title="Remove">
                    <i class="fa-solid fa-trash text-xs"></i>
                </button>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

function getNomineeLabel(nominee) {
    return typeof nominee === 'string' ? nominee : (nominee?.name || '');
}

function renderPollsTable() {
    const tbody = document.getElementById('polls-table-body');
    if (!tbody) return;

    tbody.innerHTML = '';
    if (musicConfig.polls.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5" class="py-10 text-center text-accord-muted">No award voting polls created yet.</td></tr>`;
        return;
    }

    musicConfig.polls.forEach(poll => {
        const totalVotes = Object.values(poll.votes || {}).reduce((a, b) => a + b, 0);
        const isOpen = poll.status === 'open';
        const isNominating = poll.status === 'nominating';
        const isHidden = Boolean(poll.hidden);
        const safeId = poll.id;

        const statusBadge = isOpen
            ? `<span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-700">Open</span>`
            : isNominating
                ? `<span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-blue-50 text-blue-700">Nominating</span>`
                : `<span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-amber-50 text-amber-700">Closed</span>`;

        const nomineeNames = (poll.nominees || []).map(getNomineeLabel).filter(Boolean);

        const tr = document.createElement('tr');
        tr.className = `hover:bg-slate-50/90 transition-colors border-b border-slate-100 last:border-0 cursor-pointer ${isHidden ? 'opacity-65 bg-slate-50/40' : ''}`;
        tr.onclick = () => openPollModal('edit', safeId);
        tr.innerHTML = `
            <td class="py-4 px-6">
                <div>
                    <p class="font-bold text-accord-slate">${escapeHTML(poll.title)}${isHidden ? ' <span class="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-200 text-slate-600 ml-1">Hidden</span>' : ''}</p>
                    <p class="text-[11px] text-accord-muted">Nominees: ${escapeHTML(nomineeNames.join(', ') || 'None yet (awaiting nominations)')}</p>
                </div>
            </td>
            <td class="py-4 px-6 text-center font-bold text-accord-slate">${totalVotes}</td>
            <td class="py-4 px-6 text-center">${statusBadge}</td>
            <td class="py-4 px-6 text-center" onclick="event.stopPropagation()">
                <button type="button" onclick="togglePollVisibility('${safeId}')" class="px-2.5 py-1 rounded-full text-[10px] font-bold transition-all ${isHidden ? 'bg-slate-200 text-slate-600 hover:bg-slate-300' : 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100'}" title="${isHidden ? 'Show poll on public pages' : 'Hide poll from public pages'}">
                    <i class="fa-solid ${isHidden ? 'fa-eye-slash' : 'fa-eye'} mr-1"></i>${isHidden ? 'Hidden' : 'Visible'}
                </button>
            </td>
            <td class="py-4 px-6 text-right space-x-1.5 whitespace-nowrap" onclick="event.stopPropagation()">
                <button type="button" onclick="openPollModal('edit', '${safeId}')" class="w-8 h-8 rounded-xl bg-slate-100 hover:bg-emerald-50 text-slate-600 hover:text-emerald-600 transition-all inline-flex items-center justify-center" title="Edit Poll">
                    <i class="fa-solid fa-pen text-xs"></i>
                </button>
                <button type="button" onclick="togglePollStatus('${safeId}')" class="w-8 h-8 rounded-xl ${isOpen ? 'bg-amber-50 text-amber-600' : 'bg-emerald-50 text-emerald-600'} hover:opacity-80 transition-all inline-flex items-center justify-center" title="${isOpen ? 'Close Poll' : 'Open Poll'}">
                    <i class="fa-solid ${isOpen ? 'fa-lock' : 'fa-lock-open'} text-xs"></i>
                </button>
                <button type="button" onclick="promptDeletePoll('${safeId}')" class="w-8 h-8 rounded-xl bg-slate-100 hover:bg-red-50 text-slate-600 hover:text-red-500 transition-all inline-flex items-center justify-center" title="Delete Poll">
                    <i class="fa-solid fa-trash text-xs"></i>
                </button>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

function renderPollNominationsTable() {
    const tbody = document.getElementById('poll-nominations-table-body');
    if (!tbody) return;

    tbody.innerHTML = '';
    if (musicConfig.pollNominations.length === 0) {
        tbody.innerHTML = `<tr><td colspan="4" class="py-8 text-center text-accord-muted">No user nominations submitted yet.</td></tr>`;
        return;
    }

    musicConfig.pollNominations.forEach(nom => {
        const isPending = nom.status !== 'approved';
        const tr = document.createElement('tr');
        tr.className = "hover:bg-slate-50/80 transition-colors border-b border-slate-100 last:border-0";
        tr.innerHTML = `
            <td class="py-4 px-6">
                <p class="font-bold text-accord-slate">${escapeHTML(nom.nomineeName)}</p>
                <p class="text-[11px] text-accord-muted">Category: ${escapeHTML(nom.categoryTitle || nom.pollId || 'General')}</p>
            </td>
            <td class="py-4 px-6 space-x-2">
                ${nom.songLink ? `<a href="${escapeHTML(nom.songLink)}" target="_blank" class="text-accord-blue hover:underline">Song Link</a>` : '<span class="text-slate-400">No song link</span>'}
                ${nom.artistLink ? `<span class="text-slate-300">•</span><a href="${escapeHTML(nom.artistLink)}" target="_blank" class="text-emerald-700 hover:underline">Artiste Page</a>` : ''}
            </td>
            <td class="py-4 px-6 text-accord-muted">${escapeHTML(nom.submittedByEmail || 'Registered User')}</td>
            <td class="py-4 px-6 text-right space-x-1.5 whitespace-nowrap">
                ${isPending ? `
                    <button type="button" onclick="approvePollNomination('${nom.id}')" class="px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-[10px] font-bold transition-all">
                        Add to Poll
                    </button>
                ` : `<span class="inline-flex px-2.5 py-1 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-700 mr-1">Added</span>`}
                <button type="button" onclick="deletePollNomination('${nom.id}')" class="w-8 h-8 rounded-xl bg-slate-100 hover:bg-red-50 text-slate-600 hover:text-red-500 transition-all inline-flex items-center justify-center" title="Delete">
                    <i class="fa-solid fa-trash text-xs"></i>
                </button>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

// ==========================================
// MODAL & FORM HANDLERS
// ==========================================

function toggleMusicTypeFields() {
    const type = document.getElementById('item-type')?.value;
    const tracksGroup = document.getElementById('playlist-tracks-group');
    const spotlightGroup = document.getElementById('spotlight-extra-group');
    const spotlightLinkGroup = document.getElementById('spotlight-link-group');
    const playlistLinksGroup = document.getElementById('playlist-links-group');
    if (tracksGroup) tracksGroup.classList.toggle('hidden', type !== 'playlist');
    if (spotlightGroup) spotlightGroup.classList.toggle('hidden', type !== 'spotlight');
    if (spotlightLinkGroup) spotlightLinkGroup.classList.toggle('hidden', type === 'playlist');
    if (playlistLinksGroup) playlistLinksGroup.classList.toggle('hidden', type !== 'playlist');
}

function addSpotlightSongRow(title = '', link = '') {
    const container = document.getElementById('spotlight-songs-container');
    if (!container) return;
    const row = document.createElement('div');
    row.className = 'grid grid-cols-1 sm:grid-cols-[1fr_1fr_auto] gap-2 items-center spotlight-song-row';
    row.innerHTML = `
        <input type="text" value="${escapeHTML(title)}" placeholder="Song Title" class="song-title-input bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs focus:outline-none focus:border-emerald-500">
        <input type="url" value="${escapeHTML(link)}" placeholder="Streaming Link (Spotify, Apple, YouTube)" class="song-link-input bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs focus:outline-none focus:border-emerald-500">
        <button type="button" onclick="this.closest('.spotlight-song-row').remove()" class="w-8 h-8 rounded-xl bg-slate-100 hover:bg-red-50 text-slate-500 hover:text-red-500 flex items-center justify-center text-xs" title="Remove Song">
            <i class="fa-solid fa-xmark"></i>
        </button>
    `;
    container.appendChild(row);
}

function updateCoverPreview(url) {
    const preview = document.getElementById('item-cover-preview');
    const placeholder = document.getElementById('item-cover-placeholder');
    const clearBtn = document.getElementById('clear-cover-btn');
    if (!preview || !placeholder) return;
    const clean = String(url || '').trim();
    if (clean) {
        preview.src = clean;
        preview.classList.remove('hidden');
        placeholder.classList.add('hidden');
        if (clearBtn) clearBtn.classList.remove('hidden');
    } else {
        preview.src = '';
        preview.classList.add('hidden');
        placeholder.classList.remove('hidden');
        if (clearBtn) clearBtn.classList.add('hidden');
    }
}

function clearCoverImage() {
    document.getElementById('item-image').value = '';
    updateCoverPreview('');
    const statusEl = document.getElementById('cover-upload-status');
    if (statusEl) statusEl.innerText = 'Cover removed. Upload a new cover art image.';
}

function compressCoverImage(file, maxDim = 800, quality = 0.84) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(new Error('Could not read image file.'));
        reader.onload = () => {
            const img = new Image();
            img.onerror = () => reject(new Error('Invalid image file.'));
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
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, width, height);
                canvas.toBlob(
                    blob => {
                        if (!blob) return reject(new Error('Image compression failed.'));
                        resolve({ blob, ext: 'webp', contentType: 'image/webp' });
                    },
                    'image/webp',
                    quality
                );
            };
            img.src = reader.result;
        };
        reader.readAsDataURL(file);
    });
}

async function handleCoverFileUpload(event) {
    const file = event?.target?.files?.[0];
    if (!file) return;

    const statusEl = document.getElementById('cover-upload-status');
    const labelEl = document.getElementById('cover-upload-label');
    if (statusEl) statusEl.innerText = 'Uploading...';
    if (labelEl) labelEl.classList.add('opacity-60', 'pointer-events-none');

    try {
        const { blob, ext, contentType } = await compressCoverImage(file);
        const filePath = `music-covers/cover_${Date.now()}_${Math.random().toString(36).slice(2, 7)}.${ext}`;
        const { data, error } = await supabaseClient.storage
            .from('archive-files')
            .upload(filePath, blob, {
                cacheControl: '3600',
                contentType,
                upsert: false
            });

        if (error) throw new Error(error.message || 'Upload failed.');

        const { data: pub } = supabaseClient.storage.from('archive-files').getPublicUrl(data.path);
        const publicUrl = pub?.publicUrl || '';
        document.getElementById('item-image').value = publicUrl;
        updateCoverPreview(publicUrl);
        if (statusEl) statusEl.innerText = 'Cover art uploaded!';
        showToast('Cover art uploaded!');
    } catch (err) {
        console.error('Cover upload error:', err);
        if (statusEl) statusEl.innerText = 'Upload failed';
        showToast(`Cover upload failed: ${err.message}`);
    } finally {
        if (labelEl) labelEl.classList.remove('opacity-60', 'pointer-events-none');
        event.target.value = '';
    }
}

async function autoFillMusicMetadata() {
    const type = document.getElementById('item-type')?.value;
    const isPlaylist = type === 'playlist';
    const linkInput = document.getElementById('item-link');
    const btn = document.getElementById(isPlaylist ? 'playlist-autofill-meta-btn' : 'autofill-meta-btn');
    const rawUrl = isPlaylist
        ? String(
            document.getElementById('item-apple-link')?.value ||
            document.getElementById('item-spotify-link')?.value ||
            document.getElementById('item-audiomack-link')?.value ||
            linkInput?.value ||
            ''
        ).trim()
        : String(linkInput?.value || '').trim();
    if (!rawUrl) {
        showToast('Paste a playlist or streaming link first.');
        return;
    }

    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin mr-1"></i> Fetching...';
    }

    try {
        const resp = await fetch(`/api/music-metadata?url=${encodeURIComponent(rawUrl)}`);
        if (!resp.ok) throw new Error('Could not fetch metadata from link.');
        const meta = await resp.json();

        let filledAny = false;
        if (meta.title) {
            document.getElementById('item-title').value = meta.title;
            filledAny = true;
        }
        if (meta.image && !document.getElementById('item-image').value) {
            document.getElementById('item-image').value = meta.image;
            updateCoverPreview(meta.image);
            filledAny = true;
        }
        if (meta.curator && !document.getElementById('item-curator').value.trim()) {
            document.getElementById('item-curator').value = meta.curator;
            filledAny = true;
        }
        if (meta.description && !document.getElementById('item-description').value.trim()) {
            document.getElementById('item-description').value = meta.description;
            filledAny = true;
        }
        if (Array.isArray(meta.tracks) && meta.tracks.length > 0) {
            const formatted = meta.tracks
                .map(t => t.artist ? `${t.title} - ${t.artist}` : t.title)
                .join('\n');
            document.getElementById('item-tracks').value = formatted;
            filledAny = true;
        }

        if (filledAny) {
            showToast('Details picked up! Upload cover art if needed and save.');
        } else {
            showToast('Could not auto-fetch details. Please upload cover art and type the name.');
        }
    } catch (err) {
        showToast('Could not auto-fetch from link. Please upload cover art and type the name.');
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = '<i class="fa-solid fa-wand-magic-sparkles mr-1"></i> Auto-fill';
        }
    }
}

function parseTracksTextarea(raw) {
    return String(raw || '')
        .split('\n')
        .map(line => line.trim())
        .filter(Boolean)
        .map(line => {
            const sepIdx = line.indexOf(' - ');
            if (sepIdx !== -1) {
                return {
                    title: line.slice(0, sepIdx).trim(),
                    artist: line.slice(sepIdx + 3).trim()
                };
            }
            return { title: line, artist: '' };
        });
}

function openMusicModal(mode = 'add', id = null) {
    const modal = document.getElementById('music-item-modal');
    const heading = document.getElementById('music-modal-heading');
    document.getElementById('music-item-form').reset();
    document.getElementById('edit-music-id').value = '';
    document.getElementById('item-image').value = '';
    document.getElementById('spotlight-songs-container').innerHTML = '';
    const statusEl = document.getElementById('cover-upload-status');
    if (statusEl) statusEl.innerText = 'PNG, JPG, or WebP. Automatically compressed.';
    updateCoverPreview('');

    if (mode === 'edit' && id) {
        heading.innerText = 'Edit Spotlight or Playlist';
        const item = [...musicConfig.artistes, ...musicConfig.playlists].find(x => x.id === id);
        if (item) {
            const isSpotlight = musicConfig.artistes.some(a => a.id === id);
            document.getElementById('edit-music-id').value = item.id;
            document.getElementById('item-type').value = isSpotlight ? 'spotlight' : 'playlist';
            document.getElementById('item-title').value = item.title || '';
            document.getElementById('item-genre').value = item.genre || '';
            document.getElementById('item-curator').value = item.curator || '';
            document.getElementById('item-image').value = item.image || '';
            updateCoverPreview(item.image || '');
            document.getElementById('item-link').value = item.link || '';
            document.getElementById('item-description').value = item.article || item.description || '';
            document.getElementById('item-featured').checked = item.featured !== false;
            document.getElementById('item-visible').checked = item.hidden !== true;

            if (isSpotlight) {
                const songs = Array.isArray(item.songs) ? item.songs : [];
                if (songs.length > 0) {
                    songs.forEach(s => addSpotlightSongRow(s.title || '', s.link || ''));
                } else {
                    addSpotlightSongRow();
                }
            } else {
                const linksObj = item.links && typeof item.links === 'object' ? item.links : {};
                const legacyLink = String(item.link || '').trim();
                const legacyLower = legacyLink.toLowerCase();
                const spotifyVal = linksObj.spotify || item.spotifyLink || (legacyLower.includes('spotify.com') ? legacyLink : '');
                const audiomackVal = linksObj.audiomack || item.audiomackLink || (legacyLower.includes('audiomack.com') ? legacyLink : '');
                const appleVal = linksObj.apple || item.appleMusicLink || (legacyLower.includes('music.apple.com') ? legacyLink : '');
                const spotifyInput = document.getElementById('item-spotify-link');
                const audiomackInput = document.getElementById('item-audiomack-link');
                const appleInput = document.getElementById('item-apple-link');
                if (spotifyInput) spotifyInput.value = spotifyVal;
                if (audiomackInput) audiomackInput.value = audiomackVal;
                if (appleInput) appleInput.value = appleVal;

                if (Array.isArray(item.tracks)) {
                    document.getElementById('item-tracks').value = item.tracks
                        .map(t => (t.artist ? `${t.title} - ${t.artist}` : t.title))
                        .join('\n');
                }
            }
        }
    } else {
        heading.innerText = 'Add Spotlight or Playlist';
        document.getElementById('item-featured').checked = true;
        document.getElementById('item-visible').checked = true;
        addSpotlightSongRow();
    }

    toggleMusicTypeFields();
    modal.classList.remove('hidden');
    modal.classList.add('flex');
}

function closeMusicModal() {
    const modal = document.getElementById('music-item-modal');
    modal.classList.remove('flex');
    modal.classList.add('hidden');
}

async function handleSaveMusicItem(e) {
    e.preventDefault();
    const existingId = document.getElementById('edit-music-id').value;
    const id = existingId || 'item-' + Date.now();
    const type = document.getElementById('item-type').value;
    const title = document.getElementById('item-title').value.trim();
    const genre = document.getElementById('item-genre').value.trim();
    const curator = document.getElementById('item-curator').value.trim();
    const image = document.getElementById('item-image').value.trim();
    const link = document.getElementById('item-link').value.trim();
    const description = document.getElementById('item-description').value.trim();
    const featured = document.getElementById('item-featured').checked;
    const isVisible = document.getElementById('item-visible')?.checked !== false;

    if (!image) {
        showToast('Please upload a cover art photo first.');
        return;
    }

    const songs = [];
    if (type === 'spotlight') {
        document.querySelectorAll('#spotlight-songs-container .spotlight-song-row').forEach(row => {
            const sTitle = row.querySelector('.song-title-input')?.value.trim();
            const sLink = row.querySelector('.song-link-input')?.value.trim();
            if (sTitle || sLink) {
                songs.push({ title: sTitle || title, link: sLink || '' });
            }
        });
    }

    const tracks = type === 'playlist' ? parseTracksTextarea(document.getElementById('item-tracks').value) : [];

    const spotifyLink = type === 'playlist' ? (document.getElementById('item-spotify-link')?.value.trim() || '') : '';
    const audiomackLink = type === 'playlist' ? (document.getElementById('item-audiomack-link')?.value.trim() || '') : '';
    const appleLink = type === 'playlist' ? (document.getElementById('item-apple-link')?.value.trim() || '') : '';
    const playlistLinks = type === 'playlist'
        ? { spotify: spotifyLink, audiomack: audiomackLink, apple: appleLink }
        : undefined;
    const primaryLink = type === 'playlist'
        ? (spotifyLink || appleLink || audiomackLink || link)
        : link;

    const record = {
        id,
        title,
        genre,
        curator,
        image,
        link: primaryLink,
        ...(playlistLinks ? { links: playlistLinks } : {}),
        description,
        article: description,
        tracks,
        songs,
        approved: true,
        featured,
        hidden: !isVisible,
        createdAt: new Date().toISOString()
    };

    musicConfig.artistes = musicConfig.artistes.filter(x => x.id !== id);
    musicConfig.playlists = musicConfig.playlists.filter(x => x.id !== id);

    if (type === 'spotlight') {
        musicConfig.artistes.push(record);
    } else {
        musicConfig.playlists.push(record);
    }

    closeMusicModal();
    const synced = await persistMusicConfig();
    if (synced) {
        showToast('Music entry saved successfully!');
    }
}

async function toggleMusicItemFeatured(id, entryType = 'spotlight') {
    const list = entryType === 'playlist' ? musicConfig.playlists : musicConfig.artistes;
    const item = list.find(x => x.id === id);
    if (!item) return;
    item.featured = item.featured === false;
    await persistMusicConfig();
    const offLabel = entryType === 'playlist' ? 'All Playlists Only' : 'Blog Only';
    showToast(`${item.title} is now ${item.featured ? 'Featured on Music Hub' : offLabel}.`);
}

async function toggleSpotlightFeatured(id) {
    return toggleMusicItemFeatured(id, 'spotlight');
}

async function toggleMusicItemVisibility(id, entryType) {
    const list = entryType === 'playlist' ? musicConfig.playlists : musicConfig.artistes;
    const item = list.find(x => x.id === id);
    if (!item) return;
    item.hidden = !Boolean(item.hidden);
    await persistMusicConfig();
    showToast(`"${item.title}" is now ${item.hidden ? 'hidden from public pages' : 'visible to the public'}.`);
}

// ==========================================
// SONG SPOTLIGHT HANDLERS
// ==========================================

function openSongSpotlightModal(mode = 'add', id = null) {
    const modal = document.getElementById('song-spotlight-modal');
    const heading = document.getElementById('song-spotlight-heading');
    document.getElementById('song-spotlight-form').reset();
    document.getElementById('edit-song-spotlight-id').value = '';

    if (mode === 'edit' && id) {
        heading.innerText = 'Edit Song Spotlight';
        const song = musicConfig.songSpotlights.find(s => s.id === id);
        if (song) {
            document.getElementById('edit-song-spotlight-id').value = song.id;
            document.getElementById('song-spotlight-title').value = song.title || '';
            document.getElementById('song-spotlight-link').value = song.link || '';
            document.getElementById('song-spotlight-visible').checked = song.hidden !== true;
        }
    } else {
        heading.innerText = 'Add Song Spotlight';
        document.getElementById('song-spotlight-visible').checked = true;
    }

    modal.classList.remove('hidden');
    modal.classList.add('flex');
}

function closeSongSpotlightModal() {
    const modal = document.getElementById('song-spotlight-modal');
    modal.classList.remove('flex');
    modal.classList.add('hidden');
}

async function handleSaveSongSpotlight(e) {
    e.preventDefault();
    const id = document.getElementById('edit-song-spotlight-id').value || 'song-' + Date.now();
    const title = document.getElementById('song-spotlight-title').value.trim();
    const link = document.getElementById('song-spotlight-link').value.trim();
    const isVisible = document.getElementById('song-spotlight-visible')?.checked !== false;

    musicConfig.songSpotlights = musicConfig.songSpotlights.filter(s => s.id !== id);
    musicConfig.songSpotlights.unshift({ id, title, link, hidden: !isVisible, createdAt: new Date().toISOString() });

    closeSongSpotlightModal();
    await persistMusicConfig();
    showToast('Song spotlight saved!');
}

async function toggleSongSpotlightVisibility(id) {
    const song = musicConfig.songSpotlights.find(s => s.id === id);
    if (!song) return;
    song.hidden = !Boolean(song.hidden);
    await persistMusicConfig();
    showToast(`"${song.title}" is now ${song.hidden ? 'hidden from Music Hub' : 'visible on Music Hub'}.`);
}

function promptDeleteSongSpotlight(id) {
    deleteTarget = { type: 'songSpotlight', id };
    document.getElementById('confirm-title').innerText = 'Delete Song Spotlight?';
    document.getElementById('confirm-text').innerText = 'This song will be removed from Song Spotlight.';
    openConfirmModal();
}

// ==========================================
// ARTIST SPOTLIGHT SUBMISSIONS APPROVAL
// ==========================================

async function approveSpotlightSubmission(subId, isFeatured) {
    const sub = musicConfig.spotlightSubmissions.find(s => s.id === subId);
    if (!sub) return;

    sub.status = 'approved';
    const newArtist = {
        id: 'art-' + Date.now(),
        title: sub.title,
        genre: sub.genre || 'Gospel',
        curator: sub.submittedByEmail || 'Community Submission',
        image: sub.image || '',
        link: (sub.songs && sub.songs[0]?.link) || '',
        description: sub.article || sub.description || '',
        article: sub.article || sub.description || '',
        songs: Array.isArray(sub.songs) ? sub.songs : [],
        approved: true,
        featured: Boolean(isFeatured),
        approvedAt: new Date().toISOString()
    };

    musicConfig.artistes.unshift(newArtist);
    await persistMusicConfig();
    showToast(`Approved "${sub.title}" (${isFeatured ? 'Featured on Music Hub' : 'Blog Only'})!`);
}

async function deleteSpotlightSubmission(subId) {
    musicConfig.spotlightSubmissions = musicConfig.spotlightSubmissions.filter(s => s.id !== subId);
    await persistMusicConfig();
    showToast('Submission removed.');
}

// ==========================================
// POLL & NOMINATION HANDLERS
// ==========================================

function addPollNomineeRow(name = '', songLink = '', artistLink = '') {
    const container = document.getElementById('poll-nominees-container');
    if (!container) return;
    const row = document.createElement('div');
    row.className = 'p-3 rounded-2xl bg-slate-50 border border-slate-200 space-y-2 poll-nominee-row';
    row.innerHTML = `
        <div class="flex items-center gap-2">
            <input type="text" value="${escapeHTML(name)}" required placeholder="Nominee / Song Name (e.g., RichieO - Higher Ground)" class="nominee-name-input flex-1 bg-white border border-slate-200 rounded-xl px-3 py-2 text-xs focus:outline-none focus:border-emerald-500">
            <button type="button" onclick="this.closest('.poll-nominee-row').remove()" class="w-8 h-8 rounded-xl bg-white hover:bg-red-50 text-slate-500 hover:text-red-500 border border-slate-200 flex items-center justify-center text-xs shrink-0" title="Remove Nominee">
                <i class="fa-solid fa-xmark"></i>
            </button>
        </div>
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <input type="url" value="${escapeHTML(songLink)}" placeholder="Playable Song Link (Spotify, Apple, YouTube)" class="nominee-song-input bg-white border border-slate-200 rounded-xl px-3 py-2 text-xs focus:outline-none focus:border-emerald-500">
            <input type="text" value="${escapeHTML(artistLink)}" placeholder="Artiste Page Link (e.g. artist.html?id=...)" class="nominee-artist-input bg-white border border-slate-200 rounded-xl px-3 py-2 text-xs focus:outline-none focus:border-emerald-500">
        </div>
    `;
    container.appendChild(row);
}

function openPollModal(mode = 'add', id = null) {
    const modal = document.getElementById('poll-modal');
    const heading = document.getElementById('poll-modal-heading');
    document.getElementById('poll-form').reset();
    document.getElementById('edit-poll-id').value = '';
    document.getElementById('poll-nominees-container').innerHTML = '';

    if (mode === 'edit' && id) {
        heading.innerText = 'Edit Award Voting Poll';
        const poll = musicConfig.polls.find(p => p.id === id);
        if (poll) {
            document.getElementById('edit-poll-id').value = poll.id;
            document.getElementById('poll-title').value = poll.title || '';
            document.getElementById('poll-status').value = poll.status || 'open';
            document.getElementById('poll-end-date').value = poll.endDate || '';
            document.getElementById('poll-visible').checked = poll.hidden !== true;
            const nominees = Array.isArray(poll.nominees) ? poll.nominees : [];
            if (nominees.length > 0) {
                nominees.forEach(n => {
                    if (typeof n === 'string') {
                        addPollNomineeRow(n, '', '');
                    } else {
                        addPollNomineeRow(n.name || '', n.songLink || '', n.artistLink || '');
                    }
                });
            } else {
                addPollNomineeRow();
            }
        }
    } else {
        heading.innerText = 'Create Award Voting Poll';
        document.getElementById('poll-visible').checked = true;
        addPollNomineeRow();
        addPollNomineeRow();
    }

    modal.classList.remove('hidden');
    modal.classList.add('flex');
}

function closePollModal() {
    const modal = document.getElementById('poll-modal');
    modal.classList.remove('flex');
    modal.classList.add('hidden');
}

async function handleSavePoll(e) {
    e.preventDefault();
    const existingId = document.getElementById('edit-poll-id').value;
    const id = existingId || 'poll-' + Date.now();
    const title = document.getElementById('poll-title').value.trim();
    const status = document.getElementById('poll-status').value;
    const endDate = document.getElementById('poll-end-date').value;
    const isVisible = document.getElementById('poll-visible')?.checked !== false;

    const nominees = [];
    document.querySelectorAll('#poll-nominees-container .poll-nominee-row').forEach(row => {
        const name = row.querySelector('.nominee-name-input')?.value.trim();
        const songLink = row.querySelector('.nominee-song-input')?.value.trim();
        const artistLink = row.querySelector('.nominee-artist-input')?.value.trim();
        if (name) {
            nominees.push({ name, songLink: songLink || '', artistLink: artistLink || '' });
        }
    });

    if (nominees.length === 0 && status !== 'nominating') {
        showToast('Please provide at least one nominee (or set status to Upcoming / Open for Nominations).');
        return;
    }

    const existingPoll = existingId ? musicConfig.polls.find(p => p.id === existingId) : null;
    const existingVotes = existingPoll?.votes || {};
    const votes = {};
    nominees.forEach(n => {
        votes[n.name] = existingVotes[n.name] || 0;
    });

    const poll = {
        id,
        title,
        nominees,
        votes,
        voters: existingPoll?.voters || {},
        status,
        endDate,
        hidden: !isVisible
    };

    if (existingPoll) {
        musicConfig.polls = musicConfig.polls.map(p => (p.id === id ? poll : p));
    } else {
        musicConfig.polls.push(poll);
    }

    closePollModal();
    await persistMusicConfig();
    showToast(existingPoll ? 'Award poll updated!' : 'Award poll created successfully!');
}

async function approvePollNomination(nomId) {
    const nom = musicConfig.pollNominations.find(n => n.id === nomId);
    if (!nom) return;

    let targetPoll = nom.pollId ? musicConfig.polls.find(p => p.id === nom.pollId) : null;
    if (!targetPoll && nom.categoryTitle) {
        targetPoll = musicConfig.polls.find(p => (p.title || '').toLowerCase() === nom.categoryTitle.toLowerCase());
    }
    if (!targetPoll) {
        targetPoll = {
            id: 'poll-' + Date.now(),
            title: nom.categoryTitle || 'Community Choice Awards',
            nominees: [],
            votes: {},
            voters: {},
            status: 'nominating',
            endDate: ''
        };
        musicConfig.polls.push(targetPoll);
    }

    const exists = (targetPoll.nominees || []).some(n => getNomineeLabel(n).toLowerCase() === nom.nomineeName.toLowerCase());
    if (!exists) {
        targetPoll.nominees = targetPoll.nominees || [];
        targetPoll.nominees.push({
            name: nom.nomineeName,
            songLink: nom.songLink || '',
            artistLink: nom.artistLink || ''
        });
        targetPoll.votes = targetPoll.votes || {};
        targetPoll.votes[nom.nomineeName] = targetPoll.votes[nom.nomineeName] || 0;
    }

    nom.status = 'approved';
    await persistMusicConfig();
    showToast(`Added "${nom.nomineeName}" to "${targetPoll.title}"!`);
}

async function deletePollNomination(nomId) {
    musicConfig.pollNominations = musicConfig.pollNominations.filter(n => n.id !== nomId);
    await persistMusicConfig();
    showToast('Nomination removed.');
}

async function togglePollStatus(id) {
    const poll = musicConfig.polls.find(p => p.id === id);
    if (!poll) return;
    poll.status = poll.status === 'open' ? 'closed' : 'open';
    await persistMusicConfig();
    showToast(`Poll "${poll.title}" status updated.`);
}

async function togglePollVisibility(id) {
    const poll = musicConfig.polls.find(p => p.id === id);
    if (!poll) return;
    poll.hidden = !Boolean(poll.hidden);
    await persistMusicConfig();
    showToast(`Poll "${poll.title}" is now ${poll.hidden ? 'hidden from public pages' : 'visible to the public'}.`);
}

function promptDeleteMusicItem(id, type) {
    deleteTarget = { type, id };
    document.getElementById('confirm-title').innerText = 'Delete Entry?';
    document.getElementById('confirm-text').innerText = 'This entry will be removed from the platform.';
    openConfirmModal();
}

function promptDeletePoll(id) {
    deleteTarget = { type: 'poll', id };
    document.getElementById('confirm-title').innerText = 'Delete Poll?';
    document.getElementById('confirm-text').innerText = 'This voting poll and all associated votes will be deleted.';
    openConfirmModal();
}

function openConfirmModal() {
    const modal = document.getElementById('confirm-modal');
    modal.classList.remove('hidden');
    modal.classList.add('flex');

    document.getElementById('confirm-btn').onclick = async function () {
        if (deleteTarget.type === 'spotlight') {
            musicConfig.artistes = musicConfig.artistes.filter(x => x.id !== deleteTarget.id);
        } else if (deleteTarget.type === 'playlist') {
            musicConfig.playlists = musicConfig.playlists.filter(x => x.id !== deleteTarget.id);
        } else if (deleteTarget.type === 'songSpotlight') {
            musicConfig.songSpotlights = musicConfig.songSpotlights.filter(x => x.id !== deleteTarget.id);
        } else if (deleteTarget.type === 'poll') {
            musicConfig.polls = musicConfig.polls.filter(x => x.id !== deleteTarget.id);
        }
        closeConfirmModal();
        await persistMusicConfig();
        showToast('Item deleted successfully.');
    };
}

function closeConfirmModal() {
    const modal = document.getElementById('confirm-modal');
    modal.classList.remove('flex');
    modal.classList.add('hidden');
    deleteTarget = { type: null, id: null };
}

// ==========================================
// EXPORT TO EXCEL
// ==========================================

function exportPollsToExcel() {
    let rows = [];
    musicConfig.polls.forEach(poll => {
        Object.entries(poll.votes || {}).forEach(([nominee, count]) => {
            rows.push({
                Poll_Title: poll.title,
                Status: poll.status.toUpperCase(),
                Nominee: nominee,
                Votes: count,
                End_Date: poll.endDate || ''
            });
        });
    });

    if (rows.length === 0) {
        showToast('No poll data available to export.');
        return;
    }

    const worksheet = XLSX.utils.json_to_sheet(rows);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Award_Poll_Results');
    XLSX.writeFile(workbook, 'Accord_Music_Award_Poll_Results.xlsx');
    showToast('Exported award poll results to Excel!');
}

// ==========================================
// BULK IMPORT PLAYLISTS FROM EXCEL
// ==========================================

let excelPlaylistDrafts = [];

function openExcelPlaylistImportModal() {
    excelPlaylistDrafts = [];
    const fileInput = document.getElementById('playlist-excel-file');
    if (fileInput) fileInput.value = '';
    const filenameEl = document.getElementById('excel-import-filename');
    if (filenameEl) filenameEl.innerText = 'No file selected';
    document.getElementById('excel-import-progress-wrap')?.classList.add('hidden');
    document.getElementById('excel-import-preview-wrap')?.classList.add('hidden');
    const tbody = document.getElementById('excel-import-preview-body');
    if (tbody) tbody.innerHTML = '';
    const confirmBtn = document.getElementById('excel-confirm-import-btn');
    if (confirmBtn) {
        confirmBtn.disabled = true;
        confirmBtn.innerHTML = '<i class="fa-solid fa-check mr-1.5"></i> Create Playlists';
    }
    const modal = document.getElementById('excel-playlist-import-modal');
    if (modal) {
        modal.classList.remove('hidden');
        modal.classList.add('flex');
    }
}

function closeExcelPlaylistImportModal() {
    const modal = document.getElementById('excel-playlist-import-modal');
    if (modal) {
        modal.classList.remove('flex');
        modal.classList.add('hidden');
    }
    excelPlaylistDrafts = [];
}

function downloadPlaylistExcelTemplate() {
    const sampleRows = [
        {
            Title: '',
            'Spotify Link': 'https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M',
            'Apple Music Link': '',
            'Audiomack Link': '',
            Genre: 'Contemporary Gospel',
            Curator: '',
            Description: 'Uplifting gospel & worship favorites.',
            Tracks: '',
            'Cover URL': '',
            Visible: 'Yes'
        }
    ];
    const worksheet = XLSX.utils.json_to_sheet(sampleRows);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Playlists');
    XLSX.writeFile(workbook, 'Accord_Playlists_Import_Template.xlsx');
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

function parseExcelBooleanVisible(val, isHiddenCol = false) {
    const str = String(val ?? '').trim().toLowerCase();
    if (!str) return true;
    const falsy = ['false', 'no', '0', 'hidden', 'n'];
    const truthy = ['true', 'yes', '1', 'visible', 'y'];
    if (isHiddenCol) {
        return !truthy.includes(str);
    }
    return !falsy.includes(str);
}

function mapExcelRowToPlaylistDraft(rawRow, index) {
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

    const rawTracks = pick('tracks', 'tracklist', 'songs');
    const tracks = rawTracks
        ? parseTracksTextarea(rawTracks.includes('\n') ? rawTracks : rawTracks.split(';').join('\n'))
        : [];

    const spotifyLink = pick('spotifylink', 'spotifyurl', 'spotify', 'link', 'url');
    const appleLink = pick('applemusiclink', 'applelink', 'applemusic', 'apple');
    const audiomackLink = pick('audiomacklink', 'audiomackurl', 'audiomack');
    const visible = normalized.hidden !== undefined && normalized.hidden !== ''
        ? parseExcelBooleanVisible(normalized.hidden, true)
        : parseExcelBooleanVisible(normalized.visible, false);

    return {
        rowIndex: index,
        title: pick('title', 'playlistname', 'playlisttitle', 'name', 'playlist'),
        spotifyLink,
        appleLink,
        audiomackLink,
        genre: pick('genre', 'category', 'vibe') || 'Gospel',
        curator: pick('curator', 'author', 'createdby'),
        description: pick('description', 'desc', 'notes', 'bio'),
        image: pick('coverurl', 'cover', 'image', 'imageurl', 'artwork'),
        tracks,
        visible,
        selected: true,
        isDuplicate: false,
        fetchStatus: 'pending'
    };
}

function isDuplicatePlaylistDraft(draft) {
    const draftSpotify = normalizeUrlForDupCheck(draft.spotifyLink);
    const draftApple = normalizeUrlForDupCheck(draft.appleLink);
    const draftAudiomack = normalizeUrlForDupCheck(draft.audiomackLink);
    const draftTitle = String(draft.title || '').trim().toLowerCase();

    return musicConfig.playlists.some(existing => {
        const existingTitle = String(existing.title || '').trim().toLowerCase();
        if (draftTitle && existingTitle && draftTitle === existingTitle) return true;

        const existingLinks = [
            existing.link,
            existing.links?.spotify,
            existing.links?.apple,
            existing.links?.audiomack,
            existing.spotifyLink,
            existing.appleMusicLink,
            existing.audiomackLink
        ].map(normalizeUrlForDupCheck).filter(Boolean);

        return [draftSpotify, draftApple, draftAudiomack]
            .filter(Boolean)
            .some(u => existingLinks.includes(u));
    });
}

function recheckExcelImportDuplicates() {
    const skipDuplicates = document.getElementById('excel-skip-duplicates')?.checked !== false;
    excelPlaylistDrafts.forEach(draft => {
        draft.isDuplicate = isDuplicatePlaylistDraft(draft);
        if (draft.isDuplicate && skipDuplicates) {
            draft.selected = false;
        }
    });
    renderExcelImportPreview();
}

function toggleAllExcelImportRows(checked) {
    const skipDuplicates = document.getElementById('excel-skip-duplicates')?.checked !== false;
    excelPlaylistDrafts.forEach(draft => {
        if (checked && draft.isDuplicate && skipDuplicates) {
            draft.selected = false;
        } else {
            draft.selected = Boolean(checked);
        }
    });
    renderExcelImportPreview();
}

function toggleExcelImportRow(index, checked) {
    if (!excelPlaylistDrafts[index]) return;
    excelPlaylistDrafts[index].selected = Boolean(checked);
    updateExcelImportSummary();
}

function updateExcelImportSummary() {
    const selectedCount = excelPlaylistDrafts.filter(d => d.selected && d.title).length;
    const dupCount = excelPlaylistDrafts.filter(d => d.isDuplicate).length;
    const summaryEl = document.getElementById('excel-import-summary');
    if (summaryEl) {
        summaryEl.innerText = `${selectedCount} of ${excelPlaylistDrafts.length} playlists selected` +
            (dupCount > 0 ? ` (${dupCount} duplicate${dupCount === 1 ? '' : 's'} detected)` : '');
    }
    const confirmBtn = document.getElementById('excel-confirm-import-btn');
    if (confirmBtn) {
        confirmBtn.disabled = selectedCount === 0;
        confirmBtn.innerHTML = `<i class="fa-solid fa-check mr-1.5"></i> Create ${selectedCount || ''} Playlist${selectedCount === 1 ? '' : 's'}`;
    }
}

function renderExcelImportPreview() {
    const previewWrap = document.getElementById('excel-import-preview-wrap');
    const tbody = document.getElementById('excel-import-preview-body');
    if (!tbody || !previewWrap) return;

    previewWrap.classList.remove('hidden');
    tbody.innerHTML = '';

    excelPlaylistDrafts.forEach((draft, idx) => {
        const hasLink = Boolean(draft.spotifyLink || draft.appleLink || draft.audiomackLink);
        let statusBadge = '<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-700">Ready</span>';
        if (draft.fetchStatus === 'loading') {
            statusBadge = '<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-100 text-blue-700"><i class="fa-solid fa-spinner fa-spin mr-1"></i>Fetching</span>';
        } else if (draft.isDuplicate) {
            statusBadge = '<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-800">Duplicate</span>';
        } else if (!draft.title) {
            statusBadge = '<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-100 text-rose-700">Missing Title</span>';
        } else if (!draft.image) {
            statusBadge = '<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-800">No Cover</span>';
        }

        const tr = document.createElement('tr');
        tr.className = draft.isDuplicate ? 'bg-amber-50/40' : 'hover:bg-slate-50/80';
        tr.innerHTML = `
            <td class="py-2.5 px-3">
                <input type="checkbox" ${draft.selected ? 'checked' : ''} onchange="toggleExcelImportRow(${idx}, this.checked)" class="w-4 h-4 accent-emerald-600 rounded">
            </td>
            <td class="py-2.5 px-3">
                ${draft.image
                    ? `<img src="${escapeHTML(draft.image)}" alt="" class="w-10 h-10 rounded-xl object-cover border border-slate-200">`
                    : `<div class="w-10 h-10 rounded-xl bg-slate-100 text-slate-400 flex items-center justify-center border border-slate-200"><i class="fa-solid fa-music"></i></div>`
                }
            </td>
            <td class="py-2.5 px-3">
                <p class="font-bold text-accord-slate">${escapeHTML(draft.title || '(Untitled Playlist)')}</p>
                <p class="text-[11px] text-accord-muted">${escapeHTML(draft.curator || 'No curator')}</p>
            </td>
            <td class="py-2.5 px-3 text-accord-muted">${escapeHTML(draft.genre)}</td>
            <td class="py-2.5 px-3">
                <div class="flex items-center gap-1.5 text-sm">
                    ${draft.spotifyLink ? '<i class="fa-brands fa-spotify text-[#1DB954]" title="Spotify"></i>' : ''}
                    ${draft.appleLink ? '<i class="fa-brands fa-apple text-rose-500" title="Apple Music"></i>' : ''}
                    ${draft.audiomackLink ? '<i class="fa-solid fa-headphones text-amber-500" title="Audiomack"></i>' : ''}
                    ${!hasLink ? '<span class="text-[11px] text-slate-400">No links</span>' : ''}
                </div>
                <p class="text-[10px] text-accord-muted mt-0.5">${draft.tracks.length} track${draft.tracks.length === 1 ? '' : 's'}</p>
            </td>
            <td class="py-2.5 px-3">${statusBadge}</td>
        `;
        tbody.appendChild(tr);
    });

    updateExcelImportSummary();
}

async function handlePlaylistExcelUpload(event) {
    const file = event?.target?.files?.[0];
    if (!file) return;

    const filenameEl = document.getElementById('excel-import-filename');
    if (filenameEl) filenameEl.innerText = file.name;

    try {
        const buffer = await file.arrayBuffer();
        const workbook = XLSX.read(buffer, { type: 'array' });
        const firstSheetName = workbook.SheetNames[0];
        if (!firstSheetName) {
            showToast('The uploaded file has no sheets.');
            return;
        }
        const sheet = workbook.Sheets[firstSheetName];
        const rawRows = XLSX.utils.sheet_to_json(sheet, { defval: '' });

        const drafts = rawRows
            .map((row, idx) => mapExcelRowToPlaylistDraft(row, idx))
            .filter(d => d.title || d.spotifyLink || d.appleLink || d.audiomackLink);

        if (drafts.length === 0) {
            showToast('No valid playlist rows found in the spreadsheet.');
            return;
        }

        excelPlaylistDrafts = drafts;
        recheckExcelImportDuplicates();
        await enrichImportedPlaylistsWithMetadata();
    } catch (err) {
        console.error('Excel parse error:', err);
        showToast('Could not read Excel file. Please check the format.');
    }
}

async function enrichImportedPlaylistsWithMetadata() {
    const progressWrap = document.getElementById('excel-import-progress-wrap');
    const progressText = document.getElementById('excel-import-progress-text');
    const progressCount = document.getElementById('excel-import-progress-count');
    const progressBar = document.getElementById('excel-import-progress-bar');

    const targets = excelPlaylistDrafts.filter(d => {
        const sourceUrl = d.spotifyLink || d.appleLink || d.audiomackLink;
        return sourceUrl && (!d.image || !d.title || !d.curator || d.tracks.length === 0);
    });

    if (targets.length === 0) return;

    progressWrap?.classList.remove('hidden');
    let completed = 0;
    const total = targets.length;
    const updateProgress = () => {
        if (progressCount) progressCount.innerText = `${completed} / ${total}`;
        if (progressBar) progressBar.style.width = `${Math.round((completed / total) * 100)}%`;
        if (progressText) {
            progressText.innerText = completed < total
                ? 'Fetching Spotify covers & metadata...'
                : 'Metadata extraction complete!';
        }
    };
    updateProgress();

    const CONCURRENCY = 3;
    let cursor = 0;

    async function worker() {
        while (cursor < targets.length) {
            const draft = targets[cursor++];
            const sourceUrl = draft.spotifyLink || draft.appleLink || draft.audiomackLink;
            draft.fetchStatus = 'loading';
            renderExcelImportPreview();

            try {
                const resp = await fetch(`/api/music-metadata?url=${encodeURIComponent(sourceUrl)}`);
                if (resp.ok) {
                    const meta = await resp.json();
                    if (!draft.title && meta.title) draft.title = meta.title;
                    if (!draft.image && meta.image) draft.image = meta.image;
                    if (!draft.curator && meta.curator) draft.curator = meta.curator;
                    if (!draft.description && meta.description) draft.description = meta.description;
                    if (draft.tracks.length === 0 && Array.isArray(meta.tracks) && meta.tracks.length > 0) {
                        draft.tracks = meta.tracks.map(t => ({
                            title: t.title || '',
                            artist: t.artist || ''
                        })).filter(t => t.title);
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
            recheckExcelImportDuplicates();
        }
    }

    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, targets.length) }, () => worker()));
}

async function confirmPlaylistExcelImport() {
    const toCreate = excelPlaylistDrafts.filter(d => d.selected && d.title);
    if (toCreate.length === 0) {
        showToast('Select at least one playlist with a title to import.');
        return;
    }

    const baseTime = Date.now();
    toCreate.forEach((draft, idx) => {
        const primaryLink = draft.spotifyLink || draft.appleLink || draft.audiomackLink || '';
        const record = {
            id: `item-${baseTime}-${idx}`,
            title: draft.title,
            genre: draft.genre || 'Gospel',
            curator: draft.curator || '',
            image: draft.image || '',
            link: primaryLink,
            links: {
                spotify: draft.spotifyLink || '',
                audiomack: draft.audiomackLink || '',
                apple: draft.appleLink || ''
            },
            description: draft.description || '',
            article: draft.description || '',
            tracks: Array.isArray(draft.tracks) ? draft.tracks : [],
            songs: [],
            approved: true,
            featured: true,
            hidden: !draft.visible,
            createdAt: new Date().toISOString()
        };
        musicConfig.playlists.push(record);
    });

    closeExcelPlaylistImportModal();
    const synced = await persistMusicConfig();
    if (synced) {
        showToast(`Created ${toCreate.length} playlist${toCreate.length === 1 ? '' : 's'} from Excel!`);
    }
}
