// 1. Initialize Supabase
const SUPABASE_URL = 'https://mzblgajftvyyosyrawcx.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im16YmxnYWpmdHZ5eW9zeXJhd2N4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTQ0NzYxNTQsImV4cCI6MjExMDA1MjE1NH0.Xs9MeioNfqb5DzxDYP-9ZqfywBeOlUreAY-yKrcBmJM';
const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const MASTER_ADMIN_EMAIL = 'accordmedia1@gmail.com';
const ROLES_CONFIG_RECORD_NAME = '__ACCORD_ROLES_CONFIG__';
const MUSIC_CONFIG_RECORD_NAME = '__ACCORD_MUSIC_CONFIG__';

let musicConfig = {
    artistes: [],
    playlists: [],
    polls: [],
    submissions: []
};

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

async function loadMusicConfigFromSupabase() {
    const { data, error } = await supabaseClient
        .from('books')
        .select('id, description')
        .eq('title', MUSIC_CONFIG_RECORD_NAME)
        .maybeSingle();

    if (!error && data?.description) {
        try {
            const parsed = JSON.parse(data.description);
            musicConfig = {
                artistes: Array.isArray(parsed.artistes) ? parsed.artistes : [],
                playlists: Array.isArray(parsed.playlists) ? parsed.playlists : [],
                polls: Array.isArray(parsed.polls) ? parsed.polls : [],
                submissions: Array.isArray(parsed.submissions) ? parsed.submissions : []
            };
            localStorage.setItem('accord_music_config', JSON.stringify(musicConfig));
            return;
        } catch (e) {}
    }

    const localSaved = localStorage.getItem('accord_music_config');
    if (localSaved) {
        try {
            const parsed = JSON.parse(localSaved);
            musicConfig = {
                artistes: Array.isArray(parsed.artistes) ? parsed.artistes : [],
                playlists: Array.isArray(parsed.playlists) ? parsed.playlists : [],
                polls: Array.isArray(parsed.polls) ? parsed.polls : [],
                submissions: Array.isArray(parsed.submissions) ? parsed.submissions : []
            };
            return;
        } catch (e) {}
    }

    // Default seed data
    musicConfig = {
        artistes: [
            { id: 'art-1', title: 'RichieO', genre: 'Contemporary Gospel', image: '', link: 'https://open.spotify.com/track/sample', description: 'Featured artiste for the UNVL Project.' }
        ],
        playlists: [
            { id: 'pl-1', title: 'AfroGospel Vol. 1', genre: 'Afrobeat Gospel', image: '', link: 'https://open.spotify.com/playlist/sample', description: 'Curated by DJ ChristCentric.' }
        ],
        polls: [
            { id: 'poll-1', title: 'Song of the Year - 2026 Awards', nominees: ['RichieO - Higher Ground', 'OK Muziq - Gratitude', 'Pacome Ben Elohim - Grace'], votes: { 'RichieO - Higher Ground': 120, 'OK Muziq - Gratitude': 95, 'Pacome Ben Elohim - Grace': 140 }, status: 'open', endDate: '2026-12-31' }
        ],
        submissions: []
    };
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

    if (existing?.id) {
        await supabaseClient.from('books').update(payload).eq('id', existing.id);
    } else {
        await supabaseClient.from('books').insert([payload]);
    }

    renderAll();
}

// ==========================================
// RENDERING UI
// ==========================================

function renderAll() {
    updateStats();
    renderMusicTable();
    renderPollsTable();
}

function updateStats() {
    document.getElementById('stat-spotlights').innerText = musicConfig.artistes.length;
    document.getElementById('stat-playlists').innerText = musicConfig.playlists.length;
    document.getElementById('stat-polls').innerText = musicConfig.polls.filter(p => p.status === 'open').length;
    document.getElementById('stat-submissions').innerText = musicConfig.submissions.length;
}

function renderMusicTable() {
    const tbody = document.getElementById('music-table-body');
    if (!tbody) return;

    const allItems = [
        ...musicConfig.artistes.map(a => ({ ...a, entryType: 'spotlight', typeLabel: 'Artiste Spotlight' })),
        ...musicConfig.playlists.map(p => ({ ...p, entryType: 'playlist', typeLabel: 'Curated Playlist' }))
    ];

    tbody.innerHTML = '';
    if (allItems.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5" class="py-10 text-center text-accord-muted">No spotlights or playlists added yet.</td></tr>`;
        return;
    }

    allItems.forEach(item => {
        const safeId = item.id;
        const tr = document.createElement('tr');
        tr.className = "hover:bg-slate-50/80 transition-colors border-b border-slate-100 last:border-0";
        tr.innerHTML = `
            <td class="py-4 px-6">
                <div class="flex items-center space-x-3">
                    <div class="w-9 h-9 rounded-xl bg-emerald-50 text-emerald-600 font-bold flex items-center justify-center text-xs shrink-0">
                        <i class="fa-solid ${item.entryType === 'spotlight' ? 'fa-microphone' : 'fa-list-music'}"></i>
                    </div>
                    <div>
                        <p class="font-bold text-accord-slate">${escapeHTML(item.title)}</p>
                        <p class="text-[11px] text-accord-muted truncate max-w-xs">${escapeHTML(item.description || '')}</p>
                    </div>
                </div>
            </td>
            <td class="py-4 px-6"><span class="bg-slate-100 text-accord-slate text-[10px] font-bold px-2.5 py-1 rounded-lg">${item.typeLabel}</span></td>
            <td class="py-4 px-6 text-accord-muted">${escapeHTML(item.genre || 'General')}</td>
            <td class="py-4 px-6 text-accord-blue truncate max-w-xs"><a href="${escapeHTML(item.link || '#')}" target="_blank" class="hover:underline">${escapeHTML(item.link || 'No link')}</a></td>
            <td class="py-4 px-6 text-right space-x-1.5 whitespace-nowrap">
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

function renderPollsTable() {
    const tbody = document.getElementById('polls-table-body');
    if (!tbody) return;

    tbody.innerHTML = '';
    if (musicConfig.polls.length === 0) {
        tbody.innerHTML = `<tr><td colspan="4" class="py-10 text-center text-accord-muted">No award voting polls created yet.</td></tr>`;
        return;
    }

    musicConfig.polls.forEach(poll => {
        const totalVotes = Object.values(poll.votes || {}).reduce((a, b) => a + b, 0);
        const isOpen = poll.status === 'open';
        const safeId = poll.id;

        const statusBadge = isOpen
            ? `<span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-700">Open</span>`
            : `<span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-amber-50 text-amber-700">Closed</span>`;

        const tr = document.createElement('tr');
        tr.className = "hover:bg-slate-50/80 transition-colors border-b border-slate-100 last:border-0";
        tr.innerHTML = `
            <td class="py-4 px-6">
                <div>
                    <p class="font-bold text-accord-slate">${escapeHTML(poll.title)}</p>
                    <p class="text-[11px] text-accord-muted">Nominees: ${(poll.nominees || []).join(', ')}</p>
                </div>
            </td>
            <td class="py-4 px-6 text-center font-bold text-accord-slate">${totalVotes}</td>
            <td class="py-4 px-6 text-center">${statusBadge}</td>
            <td class="py-4 px-6 text-right space-x-1.5 whitespace-nowrap">
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

// ==========================================
// MODAL & FORM HANDLERS
// ==========================================

function openMusicModal(mode = 'add', id = null) {
    const modal = document.getElementById('music-item-modal');
    const heading = document.getElementById('music-modal-heading');
    document.getElementById('music-item-form').reset();
    document.getElementById('edit-music-id').value = '';

    if (mode === 'edit' && id) {
        heading.innerText = 'Edit Spotlight or Playlist';
        const item = [...musicConfig.artistes, ...musicConfig.playlists].find(x => x.id === id);
        if (item) {
            document.getElementById('edit-music-id').value = item.id;
            document.getElementById('item-type').value = musicConfig.artistes.some(a => a.id === id) ? 'spotlight' : 'playlist';
            document.getElementById('item-title').value = item.title || '';
            document.getElementById('item-genre').value = item.genre || '';
            document.getElementById('item-image').value = item.image || '';
            document.getElementById('item-link').value = item.link || '';
            document.getElementById('item-description').value = item.description || '';
        }
    } else {
        heading.innerText = 'Add Spotlight or Playlist';
    }

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
    const id = document.getElementById('edit-music-id').value || 'item-' + Date.now();
    const type = document.getElementById('item-type').value;
    const title = document.getElementById('item-title').value.trim();
    const genre = document.getElementById('item-genre').value.trim();
    const image = document.getElementById('item-image').value.trim();
    const link = document.getElementById('item-link').value.trim();
    const description = document.getElementById('item-description').value.trim();

    const record = { id, title, genre, image, link, description };

    // Remove from both first
    musicConfig.artistes = musicConfig.artistes.filter(x => x.id !== id);
    musicConfig.playlists = musicConfig.playlists.filter(x => x.id !== id);

    if (type === 'spotlight') {
        musicConfig.artistes.push(record);
    } else {
        musicConfig.playlists.push(record);
    }

    closeMusicModal();
    await persistMusicConfig();
    showToast('Music entry saved successfully!');
}

function openPollModal() {
    const modal = document.getElementById('poll-modal');
    document.getElementById('poll-form').reset();
    document.getElementById('edit-poll-id').value = '';
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
    const id = 'poll-' + Date.now();
    const title = document.getElementById('poll-title').value.trim();
    const rawNominees = document.getElementById('poll-nominees').value.trim();
    const status = document.getElementById('poll-status').value;
    const endDate = document.getElementById('poll-end-date').value;

    const nominees = rawNominees.split('\n').map(n => n.trim()).filter(Boolean);
    if (nominees.length === 0) {
        showToast('Please provide at least one nominee.');
        return;
    }

    const votes = {};
    nominees.forEach(n => { votes[n] = 0; });

    const poll = { id, title, nominees, votes, status, endDate };
    musicConfig.polls.push(poll);

    closePollModal();
    await persistMusicConfig();
    showToast('Award poll created successfully!');
}

async function togglePollStatus(id) {
    const poll = musicConfig.polls.find(p => p.id === id);
    if (!poll) return;
    poll.status = poll.status === 'open' ? 'closed' : 'open';
    await persistMusicConfig();
    showToast(`Poll "${poll.title}" status updated.`);
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

function escapeHTML(str) {
    return String(str || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function showToast(message) {
    const toast = document.getElementById('toast');
    if (!toast) return;
    document.getElementById('toast-message').innerText = message;
    toast.classList.remove('translate-y-24', 'opacity-0');
    toast.classList.add('translate-y-0', 'opacity-100');
    setTimeout(() => {
        toast.classList.remove('translate-y-0', 'opacity-100');
        toast.classList.add('translate-y-24', 'opacity-0');
    }, 3500);
}