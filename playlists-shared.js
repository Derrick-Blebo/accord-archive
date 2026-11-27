/**
 * Accord Music Hub — Shared Playlist Card, Player Modal, Save & Analytics Helpers
 * Used by music.html (music.js) and playlists.html (playlists.js).
 */
(function () {
    const SAVED_PLAYLISTS_STORAGE_KEY = 'accord_saved_playlists';
    const PLAYLIST_ANALYTICS_STORAGE_KEY = 'accord_playlist_analytics_local';
    const PLAYLIST_SESSION_STORAGE_KEY = 'accord_playlist_session_id';

    let _savedPlaylistIds = new Set();
    let _playlistRegistry = new Map();

    function getClient() {
        return window.supabaseClient || null;
    }

    function escapeHTML(str) {
        return String(str || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function getSessionId() {
        try {
            let sid = sessionStorage.getItem(PLAYLIST_SESSION_STORAGE_KEY);
            if (!sid) {
                sid = 'pls_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
                sessionStorage.setItem(PLAYLIST_SESSION_STORAGE_KEY, sid);
            }
            return sid;
        } catch {
            return '';
        }
    }

    function getPlaylistPlatformInfo(url) {
        const raw = String(url || '').toLowerCase();
        if (raw.includes('music.apple.com')) {
            return {
                brandHtml: '<i class="fa-brands fa-apple text-[13px] mr-1"></i><span class="font-semibold tracking-tight">music</span>',
                ctaLabel: 'View in Apple Music',
                platform: 'apple'
            };
        }
        if (raw.includes('spotify.com')) {
            return {
                brandHtml: '<i class="fa-brands fa-spotify text-[#1DB954] text-[13px] mr-1"></i><span class="font-semibold tracking-tight">Spotify</span>',
                ctaLabel: 'View in Spotify',
                platform: 'spotify'
            };
        }
        if (raw.includes('audiomack.com')) {
            return {
                brandHtml: '<i class="fa-solid fa-headphones text-amber-500 text-[12px] mr-1"></i><span class="font-semibold tracking-tight">Audiomack</span>',
                ctaLabel: 'View on Audiomack',
                platform: 'audiomack'
            };
        }
        if (raw.includes('youtube.com') || raw.includes('youtu.be')) {
            return {
                brandHtml: '<i class="fa-brands fa-youtube text-red-600 text-[13px] mr-1"></i><span class="font-semibold tracking-tight">YouTube</span>',
                ctaLabel: 'View on YouTube',
                platform: 'youtube'
            };
        }
        return {
            brandHtml: '<i class="fa-solid fa-music text-accord-blue text-[11px] mr-1"></i><span class="font-semibold tracking-tight">music</span>',
            ctaLabel: 'Open Link',
            platform: 'other'
        };
    }

    function getEmbedUrl(url) {
        const raw = String(url || '').trim();
        if (!raw) return '';

        if (raw.includes('embed.music.apple.com')) return raw;
        if (raw.includes('music.apple.com')) {
            return raw.replace('https://music.apple.com', 'https://embed.music.apple.com').replace('http://music.apple.com', 'https://embed.music.apple.com');
        }
        if (raw.includes('open.spotify.com/embed/')) return raw;
        if (raw.includes('open.spotify.com/')) {
            return raw.replace('open.spotify.com/', 'open.spotify.com/embed/');
        }
        if (raw.includes('youtube.com/watch?v=')) {
            const id = raw.split('v=')[1]?.split('&')[0];
            return id ? `https://www.youtube.com/embed/${id}` : '';
        }
        if (raw.includes('youtu.be/')) {
            const id = raw.split('youtu.be/')[1]?.split(/[?&#]/)[0];
            return id ? `https://www.youtube.com/embed/${id}` : '';
        }
        if (raw.includes('youtube.com/playlist?list=')) {
            const listId = raw.split('list=')[1]?.split('&')[0];
            return listId ? `https://www.youtube.com/embed/videoseries?list=${listId}` : '';
        }
        if (raw.includes('audiomack.com/')) {
            if (raw.includes('/embed/')) return raw;
            return raw.replace('audiomack.com/', 'audiomack.com/embed/');
        }
        return '';
    }

    function getPlaylistPlatformLinks(pl) {
        if (!pl) return [];
        const linksObj = pl.links && typeof pl.links === 'object' ? pl.links : {};
        const legacyLink = String(pl.link || '').trim();
        const legacyLower = legacyLink.toLowerCase();

        const spotifyUrl = String(linksObj.spotify || pl.spotifyLink || (legacyLower.includes('spotify.com') ? legacyLink : '')).trim();
        const audiomackUrl = String(linksObj.audiomack || pl.audiomackLink || (legacyLower.includes('audiomack.com') ? legacyLink : '')).trim();
        const appleUrl = String(linksObj.apple || pl.appleMusicLink || (legacyLower.includes('music.apple.com') ? legacyLink : '')).trim();

        const platforms = [];
        if (spotifyUrl) {
            platforms.push({
                key: 'spotify',
                label: 'Spotify',
                url: spotifyUrl,
                iconHtml: '<i class="fa-brands fa-spotify text-[#1DB954] text-[13px]"></i>'
            });
        }
        if (audiomackUrl) {
            platforms.push({
                key: 'audiomack',
                label: 'Audiomack',
                url: audiomackUrl,
                iconHtml: '<i class="fa-solid fa-headphones text-amber-500 text-[12px]"></i>'
            });
        }
        if (appleUrl) {
            platforms.push({
                key: 'apple',
                label: 'Apple Music',
                url: appleUrl,
                iconHtml: '<i class="fa-brands fa-apple text-slate-900 text-[13px]"></i>'
            });
        }

        if (platforms.length === 0 && legacyLink) {
            const info = getPlaylistPlatformInfo(legacyLink);
            platforms.push({
                key: info.platform || 'other',
                label: info.platform === 'youtube' ? 'YouTube' : 'Listen',
                url: legacyLink,
                iconHtml: '<i class="fa-solid fa-music text-accord-blue text-[11px]"></i>'
            });
        }

        return platforms;
    }

    function recordLocalAnalytics(playlistId, playlistTitle, eventType) {
        try {
            const raw = localStorage.getItem(PLAYLIST_ANALYTICS_STORAGE_KEY);
            const store = raw ? JSON.parse(raw) : {};
            const current = store[playlistId] || {
                playlist_id: playlistId,
                playlist_title: playlistTitle || playlistId,
                save_count: 0,
                play_count: 0,
                platform_click_count: 0,
                engagement_count: 0,
                last_engaged_at: new Date().toISOString()
            };
            if (playlistTitle) current.playlist_title = playlistTitle;
            if (eventType === 'save') {
                current.save_count += 1;
                current.engagement_count += 1;
            } else if (eventType === 'unsave') {
                current.save_count = Math.max(0, current.save_count - 1);
            } else if (eventType === 'play') {
                current.play_count += 1;
                current.engagement_count += 1;
            } else if (eventType === 'platform_click') {
                current.platform_click_count += 1;
                current.engagement_count += 1;
            } else if (eventType === 'share_chat' || eventType === 'share_external') {
                current.engagement_count += 1;
            }
            current.last_engaged_at = new Date().toISOString();
            store[playlistId] = current;
            localStorage.setItem(PLAYLIST_ANALYTICS_STORAGE_KEY, JSON.stringify(store));
        } catch {}
    }

    async function trackPlaylistEvent(playlistId, playlistTitle, eventType, platform = null, pageSource = 'music') {
        if (!playlistId) return;
        recordLocalAnalytics(playlistId, playlistTitle, eventType);

        const client = getClient();
        if (!client) return;

        try {
            const { error } = await client.rpc('record_playlist_event', {
                p_playlist_id: String(playlistId),
                p_playlist_title: String(playlistTitle || ''),
                p_event_type: String(eventType || 'play'),
                p_platform: platform ? String(platform) : null,
                p_page_source: String(pageSource || 'music'),
                p_session_id: getSessionId()
            });
            if (error) {
                await client.from('playlist_events').insert([{
                    playlist_id: String(playlistId),
                    playlist_title: String(playlistTitle || ''),
                    event_type: String(eventType || 'play'),
                    platform: platform ? String(platform) : null,
                    page_source: String(pageSource || 'music'),
                    session_id: getSessionId()
                }]);
            }
        } catch {}
    }

    function readLocalSavedIds() {
        try {
            const raw = localStorage.getItem(SAVED_PLAYLISTS_STORAGE_KEY);
            const arr = raw ? JSON.parse(raw) : [];
            return Array.isArray(arr) ? arr.map(String) : [];
        } catch {
            return [];
        }
    }

    function writeLocalSavedIds(ids) {
        try {
            localStorage.setItem(SAVED_PLAYLISTS_STORAGE_KEY, JSON.stringify(Array.from(ids)));
        } catch {}
    }

    async function loadSavedPlaylistIds(user) {
        const localIds = readLocalSavedIds();
        _savedPlaylistIds = new Set(localIds);

        const client = getClient();
        if (client && user?.id) {
            try {
                const { data, error } = await client
                    .from('user_playlist_bookmarks')
                    .select('playlist_id')
                    .eq('user_id', user.id);

                if (!error && Array.isArray(data)) {
                    const remoteIds = data.map(row => String(row.playlist_id));
                    // Sync any local saves made before signing in
                    const missingRemote = localIds.filter(id => !remoteIds.includes(id));
                    if (missingRemote.length > 0) {
                        const rows = missingRemote.map(id => ({
                            user_id: user.id,
                            playlist_id: id,
                            playlist_title: _playlistRegistry.get(id)?.title || ''
                        }));
                        await client.from('user_playlist_bookmarks').upsert(rows, { onConflict: 'user_id,playlist_id' });
                    }
                    _savedPlaylistIds = new Set([...remoteIds, ...localIds]);
                    writeLocalSavedIds(_savedPlaylistIds);
                }
            } catch {}
        }

        syncSaveButtonsInDom();
        return Array.from(_savedPlaylistIds);
    }

    function isPlaylistSaved(playlistId) {
        return _savedPlaylistIds.has(String(playlistId));
    }

    function syncSaveButtonsInDom() {
        document.querySelectorAll('[data-save-playlist-id]').forEach(btn => {
            const id = btn.getAttribute('data-save-playlist-id');
            const saved = isPlaylistSaved(id);
            const icon = btn.querySelector('i');
            const label = btn.querySelector('[data-save-label]');

            if (saved) {
                btn.className = 'inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-accord-lightBlue text-accord-blue border border-blue-200 text-[10px] font-bold transition-all shrink-0';
                btn.title = 'Remove from Saved Playlists';
                if (icon) icon.className = 'fa-solid fa-bookmark text-[10px]';
                if (label) label.textContent = 'Saved';
            } else {
                btn.className = 'inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-slate-100 hover:bg-accord-lightBlue text-slate-600 hover:text-accord-blue border border-slate-200/80 text-[10px] font-bold transition-all shrink-0';
                btn.title = 'Save Playlist';
                if (icon) icon.className = 'fa-regular fa-bookmark text-[10px]';
                if (label) label.textContent = 'Save';
            }
        });
    }

    async function toggleSavePlaylist(playlistId, pageSource = 'music') {
        const id = String(playlistId || '');
        if (!id) return;

        const pl = _playlistRegistry.get(id) || (window.musicData?.playlists || []).find(p => String(p.id) === id);
        const title = pl?.title || '';
        const currentlySaved = isPlaylistSaved(id);
        const nextSaved = !currentlySaved;

        if (nextSaved) {
            _savedPlaylistIds.add(id);
        } else {
            _savedPlaylistIds.delete(id);
        }
        writeLocalSavedIds(_savedPlaylistIds);
        syncSaveButtonsInDom();

        const client = getClient();
        let activeUser = null;
        if (client) {
            try {
                const { data: { session } } = await client.auth.getSession();
                activeUser = session?.user || null;
                if (activeUser?.id) {
                    if (nextSaved) {
                        await client.from('user_playlist_bookmarks').upsert({
                            user_id: activeUser.id,
                            playlist_id: id,
                            playlist_title: title
                        }, { onConflict: 'user_id,playlist_id' });
                    } else {
                        await client.from('user_playlist_bookmarks')
                            .delete()
                            .eq('user_id', activeUser.id)
                            .eq('playlist_id', id);
                    }
                }
            } catch {}
        }

        trackPlaylistEvent(id, title, nextSaved ? 'save' : 'unsave', null, pageSource);

        if (typeof window.showToast === 'function') {
            if (nextSaved) {
                window.showToast(activeUser
                    ? 'Playlist saved to your library!'
                    : 'Playlist saved on this device. Sign in to sync across devices.');
            } else {
                window.showToast('Playlist removed from saved.');
            }
        }
    }

    function renderPlayerModalBody(url, platformLabel = 'Platform', analyticsCtx = null) {
        const bodyEl = document.getElementById('player-modal-body');
        const extEl = document.getElementById('player-modal-external');
        if (extEl) {
            extEl.href = url || '#';
            extEl.innerHTML = `Open ${escapeHTML(platformLabel)} <i class="fa-solid fa-arrow-up-right-from-square ml-1 text-[10px]"></i>`;
            extEl.onclick = analyticsCtx?.playlistId
                ? () => trackPlaylistEvent(analyticsCtx.playlistId, analyticsCtx.playlistTitle, 'platform_click', platformLabel.toLowerCase(), analyticsCtx.pageSource)
                : null;
        }
        if (!bodyEl) return;

        const embedUrl = getEmbedUrl(url);
        if (!embedUrl) {
            bodyEl.innerHTML = `
                <div class="py-10 px-4 text-center space-y-3 bg-white rounded-2xl border border-slate-200">
                    <p class="text-xs font-semibold text-accord-slate">Embedded player is unavailable for this link.</p>
                    <a href="${escapeHTML(url || '#')}" target="_blank" rel="noopener noreferrer" class="inline-flex items-center gap-2 px-5 py-2.5 rounded-full bg-accord-blue hover:bg-accord-darkBlue text-white text-xs font-bold shadow-sm transition-all">
                        <span>Listen on ${escapeHTML(platformLabel)}</span>
                        <i class="fa-solid fa-arrow-up-right-from-square text-[10px]"></i>
                    </a>
                </div>
            `;
            return;
        }

        const height = embedUrl.includes('embed.music.apple.com') ? '420' : '380';
        bodyEl.innerHTML = `<iframe src="${escapeHTML(embedUrl)}" allow="autoplay *; encrypted-media *; fullscreen *; clipboard-write" frameborder="0" height="${height}" style="width:100%;overflow:hidden;border-radius:12px;background:transparent;" sandbox="allow-forms allow-popups allow-same-origin allow-scripts allow-storage-access-by-user-activation allow-top-navigation-by-user-activation"></iframe>`;
    }

    function openMediaPlayerModal(title, subtitle, link, platformLinks = null, analyticsCtx = null) {
        const hasPlatforms = Array.isArray(platformLinks) && platformLinks.length > 0;
        const activeUrl = hasPlatforms ? platformLinks[0].url : link;
        const activeLabel = hasPlatforms ? platformLinks[0].label : 'App';
        const embedUrl = getEmbedUrl(activeUrl);

        if (!hasPlatforms && !embedUrl) {
            if (activeUrl) window.open(activeUrl, '_blank', 'noopener,noreferrer');
            return;
        }

        const modal = document.getElementById('playlist-player-modal');
        const titleEl = document.getElementById('player-modal-title');
        const subEl = document.getElementById('player-modal-subtitle');
        const platformsEl = document.getElementById('player-modal-platforms');
        const bodyEl = document.getElementById('player-modal-body');

        if (!modal || !bodyEl) {
            if (activeUrl) window.open(activeUrl, '_blank', 'noopener,noreferrer');
            return;
        }

        if (titleEl) titleEl.innerText = title || 'Music Player';
        if (subEl) subEl.innerText = subtitle || 'Accord Music Hub';

        if (platformsEl) {
            if (hasPlatforms) {
                platformsEl.classList.remove('hidden');
                platformsEl.innerHTML = `<span class="text-[10px] font-bold uppercase tracking-wider text-slate-400 mr-1">Choose Platform:</span>` +
                    platformLinks.map((p, idx) => `
                        <button type="button" data-platform-url="${escapeHTML(p.url)}" data-platform-label="${escapeHTML(p.label)}" class="player-platform-tab inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold border transition-all ${idx === 0 ? 'bg-slate-900 text-white border-slate-900 shadow-xs' : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'}">
                            ${p.iconHtml}
                            <span>${escapeHTML(p.label)}</span>
                        </button>
                    `).join('');

                platformsEl.querySelectorAll('.player-platform-tab').forEach(btn => {
                    btn.addEventListener('click', () => {
                        platformsEl.querySelectorAll('.player-platform-tab').forEach(other => {
                            other.className = 'player-platform-tab inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold border transition-all bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100';
                        });
                        btn.className = 'player-platform-tab inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold border transition-all bg-slate-900 text-white border-slate-900 shadow-xs';
                        if (analyticsCtx?.playlistId) {
                            trackPlaylistEvent(analyticsCtx.playlistId, analyticsCtx.playlistTitle, 'platform_click', btn.dataset.platformLabel.toLowerCase(), analyticsCtx.pageSource);
                        }
                        renderPlayerModalBody(btn.dataset.platformUrl, btn.dataset.platformLabel, analyticsCtx);
                    });
                });
            } else {
                platformsEl.classList.add('hidden');
                platformsEl.innerHTML = '';
            }
        }

        renderPlayerModalBody(activeUrl, activeLabel, analyticsCtx);

        modal.classList.remove('hidden');
        modal.classList.add('flex');
    }

    function openPlaylistPlayerModal(playlistId, pageSource = 'music') {
        const id = String(playlistId || '');
        const pl = _playlistRegistry.get(id) || (window.musicData?.playlists || []).find(p => String(p.id) === id);
        if (!pl) return;

        trackPlaylistEvent(pl.id, pl.title, 'play', null, pageSource);

        const platformLinks = getPlaylistPlatformLinks(pl);
        openMediaPlayerModal(
            pl.title || 'Playlist Player',
            pl.curator || pl.genre || 'Curated Gospel Playlist',
            platformLinks[0]?.url || pl.link,
            platformLinks,
            { playlistId: pl.id, playlistTitle: pl.title, pageSource }
        );
    }

    function closePlaylistPlayerModal() {
        const modal = document.getElementById('playlist-player-modal');
        const bodyEl = document.getElementById('player-modal-body');
        const platformsEl = document.getElementById('player-modal-platforms');
        if (bodyEl) bodyEl.innerHTML = '';
        if (platformsEl) {
            platformsEl.classList.add('hidden');
            platformsEl.innerHTML = '';
        }
        if (modal) {
            modal.classList.remove('flex');
            modal.classList.add('hidden');
        }
    }

    function buildPlaylistTracksHtml(tracks, coverSrc, subtitle, pl) {
        if (Array.isArray(tracks) && tracks.length > 0) {
            const visibleTracks = tracks.slice(0, 5);
            return `
                <div class="divide-y divide-slate-200/80">
                    ${visibleTracks.map(track => `
                        <div class="flex items-center gap-2.5 py-1.5 first:pt-0">
                            <div class="w-7 h-7 rounded bg-white border border-slate-200/70 overflow-hidden shrink-0 flex items-center justify-center">
                                <img src="${escapeHTML(track.image || coverSrc)}" alt="${escapeHTML(track.title)}" class="w-full h-full object-cover">
                            </div>
                            <div class="min-w-0 flex-1">
                                <p class="text-[11px] font-semibold text-slate-900 truncate leading-tight">${escapeHTML(track.title)}</p>
                                <p class="text-[10px] text-slate-500 truncate leading-tight mt-0.5">${escapeHTML(track.artist || subtitle)}</p>
                            </div>
                        </div>
                    `).join('')}
                </div>
            `;
        }

        return `
            <div class="space-y-2.5">
                <span class="inline-block bg-white border border-slate-200/80 text-slate-700 text-[10px] font-bold uppercase tracking-wider px-2.5 py-0.5 rounded-full">
                    ${escapeHTML(pl.genre || 'Curated Playlist')}
                </span>
                <p class="text-[11px] text-slate-600 leading-relaxed line-clamp-5">
                    ${escapeHTML(pl.description || 'Stream this curated gospel playlist on your favorite music platform.')}
                </p>
            </div>
        `;
    }

    async function hydratePlaylistTracks(pl, cardEl, coverSrc, subtitle) {
        const metaUrl = pl?.links?.apple || pl?.links?.spotify || pl?.links?.audiomack || pl?.link;
        if (!metaUrl) return;
        const cacheKey = `accord_pl_tracks_${metaUrl}`;
        try {
            const cached = sessionStorage.getItem(cacheKey);
            if (cached) {
                const parsed = JSON.parse(cached);
                if (Array.isArray(parsed) && parsed.length > 0) {
                    const slot = cardEl.querySelector('[data-tracks-slot]');
                    if (slot) slot.innerHTML = buildPlaylistTracksHtml(parsed, coverSrc, subtitle, pl);
                    return;
                }
            }
        } catch {}

        try {
            const resp = await fetch(`/api/music-metadata?url=${encodeURIComponent(metaUrl)}`);
            if (!resp.ok) return;
            const meta = await resp.json();
            if (Array.isArray(meta?.tracks) && meta.tracks.length > 0) {
                try { sessionStorage.setItem(cacheKey, JSON.stringify(meta.tracks)); } catch {}
                const slot = cardEl.querySelector('[data-tracks-slot]');
                if (slot) slot.innerHTML = buildPlaylistTracksHtml(meta.tracks, coverSrc, subtitle, pl);
            }
        } catch {}
    }

    function createPlaylistCardElement(pl, options = {}) {
        const pageSource = options.pageSource || 'music';
        const extraClass = options.cardClass || '';
        const safeId = escapeHTML(pl.id).replace(/'/g, "\\'");
        const safeTitle = escapeHTML(pl.title || '').replace(/'/g, "\\'");
        const safeSource = escapeHTML(pageSource).replace(/'/g, "\\'");

        _playlistRegistry.set(String(pl.id), pl);

        const fallbackImg = 'https://images.unsplash.com/photo-1470225620780-dba8ba36b745?auto=format&fit=crop&q=80&w=800';
        const coverSrc = pl.image || fallbackImg;
        const subtitle = pl.curator || pl.genre || 'SoundSpace PR';
        const platformLinks = getPlaylistPlatformLinks(pl);
        const primaryPlatform = getPlaylistPlatformInfo(platformLinks[0]?.url || pl.link);
        const tracks = Array.isArray(pl.tracks) ? pl.tracks.filter(t => t && t.title) : [];
        const rightContentHtml = buildPlaylistTracksHtml(tracks, coverSrc, subtitle, pl);
        const saved = isPlaylistSaved(pl.id);

        const brandBadgeHtml = platformLinks.length > 1
            ? `<div class="flex items-center gap-1.5 text-slate-700 text-[11px]">${platformLinks.map(p => p.iconHtml).join('')}<span class="font-semibold tracking-tight text-slate-600 ml-0.5">${platformLinks.length} Platforms</span></div>`
            : `<div class="flex items-center text-slate-800 text-[11px]">${primaryPlatform.brandHtml}</div>`;

        const platformButtonsHtml = platformLinks.length > 0
            ? `
                <div class="space-y-1.5 w-full">
                    <p class="text-[10px] font-bold uppercase tracking-wider text-slate-400">Listen on</p>
                    <div class="flex flex-wrap items-center gap-1.5">
                        ${platformLinks.map(p => `
                            <a href="${escapeHTML(p.url)}" target="_blank" rel="noopener noreferrer" onclick="window.AccordPlaylists.trackPlaylistEvent('${safeId}', '${safeTitle}', 'platform_click', '${escapeHTML(p.key)}', '${safeSource}')" class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-white hover:bg-slate-900 hover:text-white border border-slate-200/90 text-[11px] font-semibold text-slate-800 shadow-xs transition-all">
                                ${p.iconHtml}
                                <span>${escapeHTML(p.label)}</span>
                            </a>
                        `).join('')}
                    </div>
                </div>
            `
            : `<span class="text-[11px] text-slate-400">Streaming links coming soon</span>`;

        const saveBtnHtml = `
            <div class="flex items-center gap-1 shrink-0">
                <button type="button" data-save-playlist-id="${escapeHTML(pl.id)}" onclick="toggleSavePlaylist('${safeId}', '${safeSource}')" title="${saved ? 'Remove from Saved Playlists' : 'Save Playlist'}" class="${saved
                    ? 'inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-accord-lightBlue text-accord-blue border border-blue-200 text-[10px] font-bold transition-all shrink-0'
                    : 'inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-slate-100 hover:bg-accord-lightBlue text-slate-600 hover:text-accord-blue border border-slate-200/80 text-[10px] font-bold transition-all shrink-0'}">
                    <i class="${saved ? 'fa-solid' : 'fa-regular'} fa-bookmark text-[10px]"></i>
                    <span data-save-label>${saved ? 'Saved' : 'Save'}</span>
                </button>
                <button type="button" onclick="openSharePlaylistModal('${safeId}', '${safeSource}')" title="Share Playlist" class="w-6 h-6 rounded-full bg-slate-100 hover:bg-accord-lightBlue text-slate-600 hover:text-accord-blue border border-slate-200/80 flex items-center justify-center transition-all shrink-0">
                    <i class="fa-solid fa-share-nodes text-[10px]"></i>
                </button>
            </div>
        `;

        const card = document.createElement('div');
        card.className = `bg-white border border-slate-200/90 rounded-2xl overflow-hidden shadow-sm hover:shadow-md transition-all flex flex-col sm:flex-row min-h-[268px] ${extraClass}`.trim();
        card.innerHTML = `
            <div class="w-full sm:w-[46%] p-3.5 flex flex-col justify-between bg-white">
                <div>
                    <div class="mb-2 flex items-center justify-between gap-2">
                        <div class="min-w-0 truncate">${brandBadgeHtml}</div>
                        ${saveBtnHtml}
                    </div>
                    <div class="aspect-square w-full rounded-xl overflow-hidden bg-slate-100 shadow-sm">
                        <img src="${escapeHTML(coverSrc)}" alt="${escapeHTML(pl.title)}" class="w-full h-full object-cover hover:scale-105 transition-transform duration-500">
                    </div>
                    <div class="mt-2.5 flex items-start justify-between gap-2">
                        <div class="min-w-0">
                            <h3 class="text-[13px] font-bold text-slate-900 leading-tight truncate">${escapeHTML(pl.title)}</h3>
                            <p class="text-[11px] text-slate-500 truncate mt-0.5">${escapeHTML(subtitle)}</p>
                        </div>
                        <button type="button" onclick="openPlaylistPlayerModal('${safeId}', '${safeSource}')" title="Choose Platform / Play" class="w-5 h-5 rounded-full bg-slate-200/80 hover:bg-slate-300 text-slate-600 flex items-center justify-center shrink-0 text-[9px] mt-0.5 transition-colors">
                            <i class="fa-solid fa-ellipsis"></i>
                        </button>
                    </div>
                </div>
                <button type="button" onclick="openPlaylistPlayerModal('${safeId}', '${safeSource}')" class="mt-3 w-full bg-[#1C1C1E] hover:bg-black text-white text-[11px] font-semibold py-2 rounded-full transition-colors flex items-center justify-center gap-1.5 shadow-sm">
                    <i class="fa-solid fa-play text-[9px]"></i>
                    <span>Play</span>
                </button>
            </div>
            <div class="w-full sm:w-[54%] bg-[#F5F5F7] p-3.5 flex flex-col justify-between border-t sm:border-t-0 sm:border-l border-slate-200/70">
                <div data-tracks-slot>
                    ${rightContentHtml}
                </div>
                <div class="pt-3 mt-2 border-t border-slate-200/60 flex items-center justify-between">
                    ${platformButtonsHtml}
                </div>
            </div>
        `;

        if (tracks.length === 0 && platformLinks.length > 0) {
            hydratePlaylistTracks(pl, card, coverSrc, subtitle);
        }

        return card;
    }

    // ==========================================
    // SHARE PLAYLIST (CHATS & OUTSIDE THE APP)
    // ==========================================

    let _activeShareContext = { playlist: null, pageSource: 'music', shareUrl: '' };

    function getPlaylistShareUrl(playlistId) {
        const origin = window.location.origin && window.location.origin !== 'null'
            ? window.location.origin
            : 'https://www.accordarchives.com';
        return `${origin}/playlists.html?playlist=${encodeURIComponent(playlistId)}`;
    }

    function ensureShareModalDom() {
        let modal = document.getElementById('accord-playlist-share-modal');
        if (modal) return modal;

        modal = document.createElement('div');
        modal.id = 'accord-playlist-share-modal';
        modal.className = 'fixed inset-0 z-50 bg-accord-slate/75 backdrop-blur-sm hidden items-center justify-center p-4';
        modal.onclick = (e) => {
            if (e.target === modal) closeSharePlaylistModal();
        };
        modal.innerHTML = `
            <div class="bg-white rounded-3xl max-w-md w-full shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
                <div class="px-5 py-4 border-b border-slate-200 flex items-center justify-between bg-slate-50">
                    <div class="min-w-0 pr-3">
                        <h3 class="font-bold text-accord-slate text-sm truncate">Share Playlist</h3>
                        <p id="share-playlist-subtitle" class="text-[11px] text-accord-muted truncate"></p>
                    </div>
                    <button type="button" onclick="closeSharePlaylistModal()" class="w-8 h-8 rounded-full bg-slate-200 hover:bg-slate-300 text-slate-700 flex items-center justify-center shrink-0">
                        <i class="fa-solid fa-xmark"></i>
                    </button>
                </div>

                <div class="p-5 space-y-5 overflow-y-auto">
                    <!-- Share Outside the App -->
                    <div class="space-y-2.5">
                        <p class="text-[11px] font-extrabold uppercase tracking-wider text-accord-slate">Share Outside Accord</p>
                        <div class="grid grid-cols-2 gap-2">
                            <button type="button" id="share-native-btn" onclick="window.AccordPlaylists.sharePlaylistNative()" class="px-3 py-2.5 rounded-xl bg-accord-blue hover:bg-accord-darkBlue text-white text-xs font-bold transition-all flex items-center justify-center gap-1.5">
                                <i class="fa-solid fa-arrow-up-from-bracket text-[11px]"></i>
                                <span>Share App...</span>
                            </button>
                            <button type="button" onclick="window.AccordPlaylists.copyPlaylistShareLink()" class="px-3 py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-accord-slate text-xs font-bold transition-all flex items-center justify-center gap-1.5">
                                <i class="fa-regular fa-copy text-[11px]"></i>
                                <span>Copy Link</span>
                            </button>
                        </div>
                        <div class="flex flex-wrap items-center gap-2 pt-0.5">
                            <a id="share-whatsapp-link" href="#" target="_blank" rel="noopener noreferrer" onclick="window.AccordPlaylists.markExternalShare('whatsapp')" class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-emerald-50 hover:bg-emerald-100 text-emerald-700 text-[11px] font-bold transition-colors">
                                <i class="fa-brands fa-whatsapp text-xs"></i>
                                <span>WhatsApp</span>
                            </a>
                            <a id="share-x-link" href="#" target="_blank" rel="noopener noreferrer" onclick="window.AccordPlaylists.markExternalShare('x')" class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-800 text-[11px] font-bold transition-colors">
                                <i class="fa-brands fa-x-twitter text-xs"></i>
                                <span>X</span>
                            </a>
                            <a id="share-telegram-link" href="#" target="_blank" rel="noopener noreferrer" onclick="window.AccordPlaylists.markExternalShare('telegram')" class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-sky-50 hover:bg-sky-100 text-sky-700 text-[11px] font-bold transition-colors">
                                <i class="fa-brands fa-telegram text-xs"></i>
                                <span>Telegram</span>
                            </a>
                        </div>
                    </div>

                    <div class="border-t border-slate-200 pt-4 space-y-2.5">
                        <div class="flex items-center justify-between">
                            <p class="text-[11px] font-extrabold uppercase tracking-wider text-accord-slate">Share to Accord Chats</p>
                            <a href="messages.html" class="text-[11px] font-bold text-accord-blue hover:underline">Open Messages</a>
                        </div>
                        <input type="text" id="share-chat-note" placeholder="Add an optional message..." class="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2 text-xs focus:outline-none focus:border-accord-blue focus:bg-white">
                        <div id="share-chat-targets" class="space-y-2 max-h-56 overflow-y-auto pr-1">
                            <p class="text-xs text-accord-muted py-3 text-center">Loading your chats...</p>
                        </div>
                    </div>
                </div>
            </div>
        `;
        document.body.appendChild(modal);
        return modal;
    }

    async function openSharePlaylistModal(playlistId, pageSource = 'music') {
        const id = String(playlistId || '');
        const pl = _playlistRegistry.get(id) || (window.musicData?.playlists || []).find(p => String(p.id) === id);
        if (!pl) return;

        const modal = ensureShareModalDom();
        const shareUrl = getPlaylistShareUrl(pl.id);
        _activeShareContext = { playlist: pl, pageSource, shareUrl };

        const subEl = document.getElementById('share-playlist-subtitle');
        if (subEl) subEl.innerText = pl.title || 'Curated Gospel Playlist';

        const noteEl = document.getElementById('share-chat-note');
        if (noteEl) noteEl.value = '';

        const shareText = `Listen to "${pl.title}" on Accord Music Hub`;
        const waEl = document.getElementById('share-whatsapp-link');
        const xEl = document.getElementById('share-x-link');
        const tgEl = document.getElementById('share-telegram-link');
        if (waEl) waEl.href = `https://wa.me/?text=${encodeURIComponent(`${shareText} ${shareUrl}`)}`;
        if (xEl) xEl.href = `https://twitter.com/intent/tweet?text=${encodeURIComponent(shareText)}&url=${encodeURIComponent(shareUrl)}`;
        if (tgEl) tgEl.href = `https://t.me/share/url?url=${encodeURIComponent(shareUrl)}&text=${encodeURIComponent(shareText)}`;

        const nativeBtn = document.getElementById('share-native-btn');
        if (nativeBtn) {
            nativeBtn.classList.toggle('hidden', typeof navigator.share !== 'function');
        }

        modal.classList.remove('hidden');
        modal.classList.add('flex');

        await loadShareChatTargets();
    }

    function closeSharePlaylistModal() {
        const modal = document.getElementById('accord-playlist-share-modal');
        if (modal) {
            modal.classList.remove('flex');
            modal.classList.add('hidden');
        }
    }

    async function loadShareChatTargets() {
        const listEl = document.getElementById('share-chat-targets');
        if (!listEl) return;

        const client = getClient();
        if (!client) {
            listEl.innerHTML = `<p class="text-xs text-accord-muted py-2">Chat sharing unavailable right now.</p>`;
            return;
        }

        const { data: { session } } = await client.auth.getSession();
        const user = session?.user || null;
        if (!user?.id) {
            const next = encodeURIComponent(window.location.pathname.split('/').pop() || 'music.html');
            listEl.innerHTML = `
                <div class="p-3.5 rounded-2xl bg-accord-lightBlue/60 border border-blue-200 text-center space-y-2">
                    <p class="text-xs text-accord-slate font-medium">Sign in to share this playlist directly to your Accord DMs and group chats.</p>
                    <a href="signin.html?next=${next}" class="inline-block px-4 py-2 rounded-xl bg-accord-blue hover:bg-accord-darkBlue text-white text-xs font-bold transition-all">Sign In</a>
                </div>
            `;
            return;
        }

        listEl.innerHTML = `<p class="text-xs text-accord-muted py-3 text-center"><i class="fa-solid fa-spinner fa-spin mr-1"></i> Loading chats...</p>`;

        try {
            const [membershipsRes, profilesRes] = await Promise.all([
                client
                    .from('conversation_members')
                    .select('conversation_id, conversations(id, is_group, title, last_message_at)')
                    .eq('user_id', user.id),
                client
                    .from('profiles')
                    .select('id, full_name')
                    .neq('id', user.id)
                    .order('full_name', { ascending: true })
                    .limit(25)
            ]);

            const validConvs = (membershipsRes.data || [])
                .filter(m => m.conversations)
                .map(m => m.conversations)
                .sort((a, b) => new Date(b.last_message_at || 0) - new Date(a.last_message_at || 0));

            let partnerNamesByConv = {};
            const dmConvIds = validConvs.filter(c => !c.is_group).map(c => c.id);
            if (dmConvIds.length > 0) {
                const { data: dmMembers } = await client
                    .from('conversation_members')
                    .select('conversation_id, user_id, profiles(full_name)')
                    .in('conversation_id', dmConvIds);
                (dmMembers || []).forEach(m => {
                    if (m.user_id !== user.id && m.profiles?.full_name) {
                        partnerNamesByConv[m.conversation_id] = m.profiles.full_name;
                    }
                });
            }

            let html = '';
            if (validConvs.length > 0) {
                html += validConvs.slice(0, 10).map(c => {
                    const label = c.is_group ? (c.title || 'Group Chat') : (partnerNamesByConv[c.id] || 'Direct Message');
                    const icon = c.is_group ? 'fa-users' : 'fa-user';
                    return `
                        <div class="flex items-center justify-between gap-2 p-2.5 rounded-2xl bg-slate-50 border border-slate-200/80">
                            <div class="flex items-center gap-2.5 min-w-0">
                                <span class="w-8 h-8 rounded-full bg-accord-lightBlue text-accord-blue flex items-center justify-center text-xs shrink-0">
                                    <i class="fa-solid ${icon}"></i>
                                </span>
                                <div class="min-w-0">
                                    <p class="text-xs font-bold text-accord-slate truncate">${escapeHTML(label)}</p>
                                    <p class="text-[10px] text-accord-muted">${c.is_group ? 'Group Chat' : 'Direct Message'}</p>
                                </div>
                            </div>
                            <button type="button" onclick="window.AccordPlaylists.sendPlaylistToChat('${escapeHTML(c.id)}', this)" class="px-3 py-1.5 rounded-xl bg-accord-blue hover:bg-accord-darkBlue text-white text-[11px] font-bold transition-all shrink-0">
                                Send
                            </button>
                        </div>
                    `;
                }).join('');
            }

            const members = (profilesRes.data || []).slice(0, 8);
            if (members.length > 0) {
                html += `<p class="text-[10px] font-bold uppercase tracking-wider text-accord-muted pt-2">Or Start a DM</p>`;
                html += members.map(p => `
                    <div class="flex items-center justify-between gap-2 p-2.5 rounded-2xl bg-white border border-slate-200/80">
                        <div class="flex items-center gap-2.5 min-w-0">
                            <span class="w-8 h-8 rounded-full bg-slate-100 text-accord-slate flex items-center justify-center text-xs font-bold shrink-0">
                                ${escapeHTML((p.full_name || 'M').charAt(0).toUpperCase())}
                            </span>
                            <p class="text-xs font-semibold text-accord-slate truncate">${escapeHTML(p.full_name || 'Member')}</p>
                        </div>
                        <button type="button" onclick="window.AccordPlaylists.sendPlaylistToDmUser('${escapeHTML(p.id)}', this)" class="px-3 py-1.5 rounded-xl bg-slate-900 hover:bg-black text-white text-[11px] font-bold transition-all shrink-0">
                            Send DM
                        </button>
                    </div>
                `).join('');
            }

            listEl.innerHTML = html || `<p class="text-xs text-accord-muted py-3 text-center">No chats or members found yet.</p>`;
        } catch {
            listEl.innerHTML = `<p class="text-xs text-red-600 py-3 text-center">Could not load chats.</p>`;
        }
    }

    async function sendPlaylistToChat(convId, btnEl) {
        const client = getClient();
        const pl = _activeShareContext.playlist;
        if (!client || !pl || !convId) return;

        if (btnEl) {
            btnEl.disabled = true;
            btnEl.innerText = 'Sending...';
        }

        try {
            const { data: { session } } = await client.auth.getSession();
            const user = session?.user;
            if (!user?.id) return;

            const note = (document.getElementById('share-chat-note')?.value || '').trim();
            const fallbackImg = 'https://images.unsplash.com/photo-1470225620780-dba8ba36b745?auto=format&fit=crop&q=80&w=800';
            const { error } = await client.from('chat_messages').insert([{
                conversation_id: convId,
                sender_id: user.id,
                message_type: 'shared_playlist',
                body: note,
                attachment_meta: {
                    id: pl.id,
                    title: pl.title || 'Curated Playlist',
                    author_name: pl.curator || pl.genre || 'SoundSpace PR',
                    subtitle: pl.description || 'Listen on Accord Music Hub',
                    image_url: pl.image || fallbackImg,
                    url: `playlists.html?playlist=${encodeURIComponent(pl.id)}`
                }
            }]);

            if (error) throw error;

            trackPlaylistEvent(pl.id, pl.title, 'share_chat', 'accord_chat', _activeShareContext.pageSource);
            if (btnEl) {
                btnEl.innerText = 'Sent!';
                btnEl.className = 'px-3 py-1.5 rounded-xl bg-emerald-600 text-white text-[11px] font-bold shrink-0';
            }
            if (typeof window.showToast === 'function') {
                window.showToast('Playlist shared to chat!');
            }
        } catch (err) {
            if (btnEl) {
                btnEl.disabled = false;
                btnEl.innerText = 'Send';
            }
            if (typeof window.showToast === 'function') {
                window.showToast('Could not send playlist to chat.');
            }
        }
    }

    async function sendPlaylistToDmUser(targetUserId, btnEl) {
        const client = getClient();
        if (!client || !targetUserId) return;
        if (btnEl) {
            btnEl.disabled = true;
            btnEl.innerText = 'Opening...';
        }
        try {
            const { data: convId, error } = await client.rpc('get_or_create_dm', { target_user_id: targetUserId });
            if (error || !convId) throw error || new Error('Could not create DM');
            await sendPlaylistToChat(convId, btnEl);
        } catch {
            if (btnEl) {
                btnEl.disabled = false;
                btnEl.innerText = 'Send DM';
            }
            if (typeof window.showToast === 'function') {
                window.showToast('Could not start DM to share playlist.');
            }
        }
    }

    async function sharePlaylistNative() {
        const pl = _activeShareContext.playlist;
        const url = _activeShareContext.shareUrl;
        if (!pl || typeof navigator.share !== 'function') return;
        try {
            await navigator.share({
                title: pl.title || 'Curated Gospel Playlist',
                text: `Listen to "${pl.title}" on Accord Music Hub`,
                url
            });
            trackPlaylistEvent(pl.id, pl.title, 'share_external', 'native_share', _activeShareContext.pageSource);
        } catch {}
    }

    async function copyPlaylistShareLink() {
        const pl = _activeShareContext.playlist;
        const url = _activeShareContext.shareUrl;
        if (!url) return;
        try {
            await navigator.clipboard.writeText(url);
            if (pl) trackPlaylistEvent(pl.id, pl.title, 'share_external', 'copy_link', _activeShareContext.pageSource);
            if (typeof window.showToast === 'function') {
                window.showToast('Playlist link copied! Share it anywhere.');
            }
        } catch {
            if (typeof window.showToast === 'function') {
                window.showToast('Could not copy link.');
            }
        }
    }

    function markExternalShare(platform) {
        const pl = _activeShareContext.playlist;
        if (pl) {
            trackPlaylistEvent(pl.id, pl.title, 'share_external', platform, _activeShareContext.pageSource);
        }
    }

    window.AccordPlaylists = {
        getPlaylistPlatformInfo,
        getEmbedUrl,
        getPlaylistPlatformLinks,
        openMediaPlayerModal,
        openPlaylistPlayerModal,
        closePlaylistPlayerModal,
        loadSavedPlaylistIds,
        isPlaylistSaved,
        toggleSavePlaylist,
        trackPlaylistEvent,
        createPlaylistCardElement,
        openSharePlaylistModal,
        closeSharePlaylistModal,
        sendPlaylistToChat,
        sendPlaylistToDmUser,
        sharePlaylistNative,
        copyPlaylistShareLink,
        markExternalShare,
        registerPlaylists(list) {
            (list || []).forEach(pl => {
                if (pl && pl.id) _playlistRegistry.set(String(pl.id), pl);
            });
        }
    };

    window.openMediaPlayerModal = openMediaPlayerModal;
    window.openPlaylistPlayerModal = openPlaylistPlayerModal;
    window.closePlaylistPlayerModal = closePlaylistPlayerModal;
    window.toggleSavePlaylist = toggleSavePlaylist;
    window.openSharePlaylistModal = openSharePlaylistModal;
    window.closeSharePlaylistModal = closeSharePlaylistModal;
})();
