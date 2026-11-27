// ==========================================
// ACCORD GOSPEL MUSIC & POLLS ADMIN
// ==========================================



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
                    ${item.image
                        ? `<img src="${escapeHTML(item.image)}" alt="${escapeHTML(item.title)}" class="w-9 h-9 rounded-xl object-cover shrink-0 border border-slate-200">`
                        : `<div class="w-9 h-9 rounded-xl bg-emerald-50 text-emerald-600 font-bold flex items-center justify-center text-xs shrink-0"><i class="fa-solid ${item.entryType === 'spotlight' ? 'fa-microphone' : 'fa-list-music'}"></i></div>`
                    }
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

function togglePlaylistFields() {
    const type = document.getElementById('item-type')?.value;
    const tracksGroup = document.getElementById('playlist-tracks-group');
    if (!tracksGroup) return;
    if (type === 'playlist') {
        tracksGroup.classList.remove('hidden');
    } else {
        tracksGroup.classList.add('hidden');
    }
}

function updateCoverPreview(url) {
    const preview = document.getElementById('item-cover-preview');
    const placeholder = document.getElementById('item-cover-placeholder');
    if (!preview || !placeholder) return;
    const clean = String(url || '').trim();
    if (clean) {
        preview.src = clean;
        preview.classList.remove('hidden');
        placeholder.classList.add('hidden');
    } else {
        preview.src = '';
        preview.classList.add('hidden');
        placeholder.classList.remove('hidden');
    }
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
        if (statusEl) statusEl.innerText = 'Uploaded!';
        showToast('Cover photo uploaded!');
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
    const linkInput = document.getElementById('item-link');
    const btn = document.getElementById('autofill-meta-btn');
    const rawUrl = String(linkInput?.value || '').trim();
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
        if (meta.image) {
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
            showToast('Playlist details picked up! Review and save.');
        } else {
            showToast('Could not auto-fetch cover/name. Please upload a cover photo and type the name.');
        }
    } catch (err) {
        showToast('Could not auto-fetch from link. Please upload a cover photo and type the name.');
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
    const statusEl = document.getElementById('cover-upload-status');
    if (statusEl) statusEl.innerText = '';
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
            document.getElementById('item-description').value = item.description || '';
            if (Array.isArray(item.tracks)) {
                document.getElementById('item-tracks').value = item.tracks
                    .map(t => (t.artist ? `${t.title} - ${t.artist}` : t.title))
                    .join('\n');
            }
        }
    } else {
        heading.innerText = 'Add Spotlight or Playlist';
    }

    togglePlaylistFields();
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
    const curator = document.getElementById('item-curator').value.trim();
    const image = document.getElementById('item-image').value.trim();
    const link = document.getElementById('item-link').value.trim();
    const description = document.getElementById('item-description').value.trim();
    const tracks = type === 'playlist' ? parseTracksTextarea(document.getElementById('item-tracks').value) : [];

    const record = { id, title, genre, curator, image, link, description, tracks };

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