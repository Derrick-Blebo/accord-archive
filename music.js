// 1. Initialize Supabase
const SUPABASE_URL = 'https://mzblgajftvyyosyrawcx.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im16YmxnYWpmdHZ5eW9zeXJhd2N4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTQ0NzYxNTQsImV4cCI6MjExMDA1MjE1NH0.Xs9MeioNfqb5DzxDYP-9ZqfywBeOlUreAY-yKrcBmJM';
window.supabaseClient = window.supabaseClient || window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const supabaseClient = window.supabaseClient;
const MUSIC_CONFIG_RECORD_NAME = '__ACCORD_MUSIC_CONFIG__';

let currentMusicUser = null;

let musicData = {
    artistes: [],
    playlists: [],
    songSpotlights: [],
    polls: [],
    submissions: [],
    spotlightSubmissions: [],
    pollNominations: []
};

function normalizeMusicData(parsed) {
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

// ==========================================
// INITIALIZATION
// ==========================================

window.onload = async function () {
    const { data: { session } } = await supabaseClient.auth.getSession();
    currentMusicUser = session?.user || null;
    updatePollsAuthBanner();

    await fetchMusicData();
    renderSpotlights();
    renderSongSpotlights();
    renderPlaylists();
    renderPollResults();
    renderPolls();
};

function updatePollsAuthBanner() {
    const banner = document.getElementById('polls-auth-banner');
    if (!banner) return;
    if (currentMusicUser) {
        banner.classList.add('hidden');
    } else {
        banner.classList.remove('hidden');
    }
}

async function fetchMusicData() {
    try {
        const { data, error } = await supabaseClient
            .from('books')
            .select('description')
            .eq('title', MUSIC_CONFIG_RECORD_NAME)
            .maybeSingle();

        if (!error && data?.description) {
            const parsed = JSON.parse(data.description);
            musicData = normalizeMusicData(parsed);
            localStorage.setItem('accord_music_config', JSON.stringify(musicData));
            return;
        }
    } catch (e) {
        console.warn('Could not load music config from Supabase:', e);
    }

    const localSaved = localStorage.getItem('accord_music_config');
    if (localSaved) {
        try {
            musicData = normalizeMusicData(JSON.parse(localSaved));
            return;
        } catch (e) {}
    }

    musicData = normalizeMusicData({
        artistes: [
            {
                id: 'art-1',
                title: 'RichieO',
                genre: 'Contemporary AfroGospel',
                image: 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?auto=format&fit=crop&q=80&w=800',
                link: 'https://open.spotify.com/',
                description: 'Featured lead artist for the UNVL Project. Bringing vibrant contemporary AfroGospel sounds with deep spiritual messages.',
                approved: true,
                featured: true,
                songs: [{ title: 'Higher Ground', link: 'https://open.spotify.com/' }]
            },
            {
                id: 'art-2',
                title: 'OK Muziq',
                genre: 'Urban Gospel & Soul',
                image: 'https://images.unsplash.com/photo-1514525253161-7a46d19cd819?auto=format&fit=crop&q=80&w=800',
                link: 'https://open.spotify.com/',
                description: 'Known for soulful melodies and inspiring lyricism that bridge contemporary urban culture and faith.',
                approved: true,
                featured: true,
                songs: [{ title: 'Gratitude', link: 'https://open.spotify.com/' }]
            },
            {
                id: 'art-3',
                title: 'Pacome Ben Elohim',
                genre: 'Worship & Praise',
                image: 'https://images.unsplash.com/photo-1465847899084-d164df4dedc6?auto=format&fit=crop&q=80&w=800',
                link: 'https://open.spotify.com/',
                description: 'Passionate worship leader delivering powerful acoustic and live ministry records.',
                approved: true,
                featured: true,
                songs: [{ title: 'Grace', link: 'https://open.spotify.com/' }]
            }
        ],
        playlists: [
            {
                id: 'pl-1',
                title: 'AfroGospel Vol. 1',
                genre: 'Afrobeat Gospel',
                image: 'https://images.unsplash.com/photo-1470225620780-dba8ba36b745?auto=format&fit=crop&q=80&w=800',
                link: 'https://open.spotify.com/',
                description: 'Curated by DJ ChristCentric. High-energy Afrobeat rhythms infused with uplifting gospel declarations.'
            },
            {
                id: 'pl-2',
                title: 'SoundSpace Sanctuary',
                genre: 'Meditation & Devotional',
                image: 'https://images.unsplash.com/photo-1508700115892-45ecd05ae2ad?auto=format&fit=crop&q=80&w=800',
                link: 'https://open.spotify.com/',
                description: 'Soothing instrumental and vocal worship designed for prayer, study, and quiet time.'
            }
        ],
        polls: [
            {
                id: 'poll-1',
                title: 'Song of the Year - 2026 Awards',
                nominees: [
                    { name: 'RichieO - Higher Ground', songLink: 'https://open.spotify.com/', artistLink: 'artist.html?id=art-1' },
                    { name: 'OK Muziq - Gratitude', songLink: 'https://open.spotify.com/', artistLink: 'artist.html?id=art-2' },
                    { name: 'Pacome Ben Elohim - Grace', songLink: 'https://open.spotify.com/', artistLink: 'artist.html?id=art-3' }
                ],
                votes: { 'RichieO - Higher Ground': 120, 'OK Muziq - Gratitude': 95, 'Pacome Ben Elohim - Grace': 140 },
                voters: {},
                status: 'open'
            }
        ]
    });
}

async function saveMusicDataToSupabase() {
    localStorage.setItem('accord_music_config', JSON.stringify(musicData));

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
        description: JSON.stringify(musicData),
        is_visible: false,
        status: 'system_config',
        is_for_sale: false,
        price: 0
    };

    if (existing?.id) {
        const { error } = await supabaseClient.from('books').update(payload).eq('id', existing.id);
        return !error;
    } else {
        const { error } = await supabaseClient.from('books').insert([payload]);
        return !error;
    }
}

// ==========================================
// 1. ARTISTE SPOTLIGHTS (CIRCULAR PORTRAITS)
// ==========================================

function renderSpotlights() {
    const grid = document.getElementById('spotlight-grid');
    if (!grid) return;

    grid.innerHTML = '';
    const featuredArtistes = musicData.artistes.filter(a => a.approved !== false && a.featured !== false && !a.hidden);

    if (featuredArtistes.length === 0) {
        grid.innerHTML = `<p class="text-xs text-accord-muted">No featured artiste spotlights currently available. <a href="artist-blog.html" class="text-accord-blue font-bold hover:underline">View all artiste articles</a>.</p>`;
        return;
    }

    const fallbackImg = 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?auto=format&fit=crop&q=80&w=800';
    featuredArtistes.forEach(artist => {
        const link = document.createElement('a');
        link.href = `artist.html?id=${encodeURIComponent(artist.id)}`;
        link.className = "group flex flex-col items-center text-center w-32 sm:w-40 shrink-0";
        link.innerHTML = `
            <div class="relative p-1 rounded-full bg-gradient-to-tr from-accord-blue via-sky-400 to-accord-gold shadow-md group-hover:shadow-xl transition-all duration-300">
                <div class="w-28 h-28 sm:w-36 sm:h-36 rounded-full overflow-hidden bg-slate-100 ring-2 ring-white">
                    <img src="${escapeHTML(artist.image || fallbackImg)}" alt="${escapeHTML(artist.title)}" class="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500">
                </div>
                <span class="absolute bottom-1 right-1 w-7 h-7 rounded-full bg-white shadow-md border border-slate-100 flex items-center justify-center text-accord-blue text-[11px] group-hover:bg-accord-blue group-hover:text-white transition-colors">
                    <i class="fa-solid fa-play ml-0.5"></i>
                </span>
            </div>
            <h3 class="mt-3 text-sm sm:text-base font-bold text-accord-slate group-hover:text-accord-blue transition-colors leading-tight line-clamp-1">${escapeHTML(artist.title)}</h3>
            <p class="text-[11px] text-accord-muted mt-0.5 line-clamp-1">${escapeHTML(artist.genre || 'Gospel Artiste')}</p>
        `;
        grid.appendChild(link);
    });
}

// ==========================================
// 2. SONG SPOTLIGHT
// ==========================================

function renderSongSpotlights() {
    const grid = document.getElementById('song-spotlight-grid');
    if (!grid) return;

    grid.innerHTML = '';
    const songs = (musicData.songSpotlights || []).filter(s => !s.hidden);
    if (songs.length === 0) {
        grid.innerHTML = `<p class="text-xs text-accord-muted col-span-full">No featured songs in Song Spotlight yet.</p>`;
        return;
    }

    songs.forEach(song => {
        const platform = getPlaylistPlatformInfo(song.link);
        const card = document.createElement('div');
        card.className = "bg-white border border-slate-200/90 rounded-2xl p-4 shadow-sm hover:shadow-md transition-all flex items-center justify-between gap-3";
        card.innerHTML = `
            <div class="flex items-center gap-3 min-w-0">
                <button type="button" onclick="openMediaPlayerModal('${escapeHTML(song.title).replace(/'/g, "\\'")}', 'Song Spotlight', '${escapeHTML(song.link).replace(/'/g, "\\'")}')" class="w-11 h-11 rounded-2xl bg-accord-lightBlue hover:bg-accord-blue text-accord-blue hover:text-white flex items-center justify-center transition-all shrink-0 shadow-sm" title="Play Song">
                    <i class="fa-solid fa-play text-xs ml-0.5"></i>
                </button>
                <div class="min-w-0">
                    <h3 class="text-sm font-bold text-accord-slate truncate">${escapeHTML(song.title)}</h3>
                    <div class="text-[11px] text-accord-muted flex items-center gap-1 mt-0.5">
                        ${platform.brandHtml}
                    </div>
                </div>
            </div>
            <a href="${escapeHTML(song.link || '#')}" target="_blank" rel="noopener noreferrer" class="px-3 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-accord-slate text-[11px] font-bold transition-colors shrink-0">
                Open <i class="fa-solid fa-arrow-up-right-from-square ml-1 text-[9px]"></i>
            </a>
        `;
        grid.appendChild(card);
    });
}

// ==========================================
// 3. CURATED PLAYLISTS & MEDIA PLAYER
// ==========================================

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

function renderPlayerModalBody(url, platformLabel = 'Platform') {
    const bodyEl = document.getElementById('player-modal-body');
    const extEl = document.getElementById('player-modal-external');
    if (extEl) {
        extEl.href = url || '#';
        extEl.innerHTML = `Open ${escapeHTML(platformLabel)} <i class="fa-solid fa-arrow-up-right-from-square ml-1 text-[10px]"></i>`;
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

function openMediaPlayerModal(title, subtitle, link, platformLinks = null) {
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
                    renderPlayerModalBody(btn.dataset.platformUrl, btn.dataset.platformLabel);
                });
            });
        } else {
            platformsEl.classList.add('hidden');
            platformsEl.innerHTML = '';
        }
    }

    renderPlayerModalBody(activeUrl, activeLabel);

    modal.classList.remove('hidden');
    modal.classList.add('flex');
}

function openPlaylistPlayerModal(playlistId) {
    const pl = musicData.playlists.find(p => p.id === playlistId);
    if (!pl) return;
    const platformLinks = getPlaylistPlatformLinks(pl);
    openMediaPlayerModal(
        pl.title || 'Playlist Player',
        pl.curator || pl.genre || 'Curated Gospel Playlist',
        platformLinks[0]?.url || pl.link,
        platformLinks
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

function renderPlaylists() {
    const grid = document.getElementById('playlist-grid');
    if (!grid) return;

    grid.innerHTML = '';
    const visiblePlaylists = (musicData.playlists || []).filter(p => !p.hidden);
    if (visiblePlaylists.length === 0) {
        grid.innerHTML = `<p class="text-xs text-accord-muted col-span-full">No curated playlists currently available.</p>`;
        return;
    }

    visiblePlaylists.forEach(pl => {
        const fallbackImg = 'https://images.unsplash.com/photo-1470225620780-dba8ba36b745?auto=format&fit=crop&q=80&w=800';
        const coverSrc = pl.image || fallbackImg;
        const subtitle = pl.curator || pl.genre || 'SoundSpace PR';
        const platformLinks = getPlaylistPlatformLinks(pl);
        const primaryPlatform = getPlaylistPlatformInfo(platformLinks[0]?.url || pl.link);
        const tracks = Array.isArray(pl.tracks) ? pl.tracks.filter(t => t && t.title) : [];
        const rightContentHtml = buildPlaylistTracksHtml(tracks, coverSrc, subtitle, pl);

        const brandBadgeHtml = platformLinks.length > 1
            ? `<div class="flex items-center gap-1.5 text-slate-700 text-[11px]">${platformLinks.map(p => p.iconHtml).join('')}<span class="font-semibold tracking-tight text-slate-600 ml-0.5">${platformLinks.length} Platforms</span></div>`
            : `<div class="flex items-center text-slate-800 text-[11px]">${primaryPlatform.brandHtml}</div>`;

        const platformButtonsHtml = platformLinks.length > 0
            ? `
                <div class="space-y-1.5 w-full">
                    <p class="text-[10px] font-bold uppercase tracking-wider text-slate-400">Listen on</p>
                    <div class="flex flex-wrap items-center gap-1.5">
                        ${platformLinks.map(p => `
                            <a href="${escapeHTML(p.url)}" target="_blank" rel="noopener noreferrer" class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-white hover:bg-slate-900 hover:text-white border border-slate-200/90 text-[11px] font-semibold text-slate-800 shadow-xs transition-all">
                                ${p.iconHtml}
                                <span>${escapeHTML(p.label)}</span>
                            </a>
                        `).join('')}
                    </div>
                </div>
            `
            : `<span class="text-[11px] text-slate-400">Streaming links coming soon</span>`;

        const card = document.createElement('div');
        card.className = "bg-white border border-slate-200/90 rounded-2xl overflow-hidden shadow-sm hover:shadow-md transition-all flex flex-col sm:flex-row min-h-[268px]";
        card.innerHTML = `
            <div class="w-full sm:w-[46%] p-3.5 flex flex-col justify-between bg-white">
                <div>
                    <div class="mb-2">
                        ${brandBadgeHtml}
                    </div>
                    <div class="aspect-square w-full rounded-xl overflow-hidden bg-slate-100 shadow-sm">
                        <img src="${escapeHTML(coverSrc)}" alt="${escapeHTML(pl.title)}" class="w-full h-full object-cover hover:scale-105 transition-transform duration-500">
                    </div>
                    <div class="mt-2.5 flex items-start justify-between gap-2">
                        <div class="min-w-0">
                            <h3 class="text-[13px] font-bold text-slate-900 leading-tight truncate">${escapeHTML(pl.title)}</h3>
                            <p class="text-[11px] text-slate-500 truncate mt-0.5">${escapeHTML(subtitle)}</p>
                        </div>
                        <button type="button" onclick="openPlaylistPlayerModal('${escapeHTML(pl.id).replace(/'/g, "\\'")}')" title="Choose Platform / Play" class="w-5 h-5 rounded-full bg-slate-200/80 hover:bg-slate-300 text-slate-600 flex items-center justify-center shrink-0 text-[9px] mt-0.5 transition-colors">
                            <i class="fa-solid fa-ellipsis"></i>
                        </button>
                    </div>
                </div>
                <button type="button" onclick="openPlaylistPlayerModal('${escapeHTML(pl.id).replace(/'/g, "\\'")}')" class="mt-3 w-full bg-[#1C1C1E] hover:bg-black text-white text-[11px] font-semibold py-2 rounded-full transition-colors flex items-center justify-center gap-1.5 shadow-sm">
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
        grid.appendChild(card);

        if (tracks.length === 0 && platformLinks.length > 0) {
            hydratePlaylistTracks(pl, card, coverSrc, subtitle);
        }
    });
}

// ==========================================
// 4. POLL RESULTS & VOTING
// ==========================================

function normalizeNominee(nominee) {
    if (typeof nominee === 'string') {
        return { name: nominee, songLink: '', artistLink: '' };
    }
    return {
        name: nominee?.name || '',
        songLink: nominee?.songLink || '',
        artistLink: nominee?.artistLink || ''
    };
}

function findMatchingArtistPage(nomineeName, explicitArtistLink) {
    if (explicitArtistLink) return explicitArtistLink;
    const lower = String(nomineeName || '').toLowerCase();
    const matched = musicData.artistes.find(a => a.approved !== false && !a.hidden && a.title && lower.includes(a.title.toLowerCase()));
    return matched ? `artist.html?id=${encodeURIComponent(matched.id)}` : '';
}

function getLocalUserVotes() {
    if (!currentMusicUser?.id) return {};
    try {
        return JSON.parse(localStorage.getItem(`accord_poll_votes_${currentMusicUser.id}`) || '{}');
    } catch {
        return {};
    }
}

function saveLocalUserVote(pollId, nomineeName) {
    if (!currentMusicUser?.id) return;
    const current = getLocalUserVotes();
    current[pollId] = nomineeName;
    localStorage.setItem(`accord_poll_votes_${currentMusicUser.id}`, JSON.stringify(current));
}

function getUserVoteForPoll(poll) {
    if (!currentMusicUser?.id) return null;
    if (poll?.voters && poll.voters[currentMusicUser.id]) {
        return poll.voters[currentMusicUser.id];
    }
    const localVotes = getLocalUserVotes();
    return localVotes[poll.id] || null;
}

function renderPollResults() {
    const grid = document.getElementById('poll-results-grid');
    if (!grid) return;

    grid.innerHTML = '';
    const pollsWithNominees = (musicData.polls || []).filter(p => !p.hidden && (p.nominees || []).length > 0 && p.status !== 'nominating');

    if (pollsWithNominees.length === 0) {
        grid.innerHTML = `<p class="text-xs text-accord-muted col-span-full">Poll results will appear here once voting begins.</p>`;
        return;
    }

    pollsWithNominees.forEach(poll => {
        const nominees = (poll.nominees || []).map(normalizeNominee).filter(n => n.name);
        const totalVotes = Object.values(poll.votes || {}).reduce((a, b) => a + b, 0);

        const ranked = nominees
            .map(n => ({ name: n.name, count: (poll.votes || {})[n.name] || 0 }))
            .sort((a, b) => b.count - a.count);

        const topCount = ranked[0]?.count || 0;
        const leaders = ranked.filter(r => r.count === topCount);
        const isClosed = poll.status === 'closed';
        const leaderNames = topCount > 0 ? leaders.map(l => l.name).join(' & ') : 'No votes yet';
        const pct = totalVotes > 0 ? Math.round((topCount / totalVotes) * 100) : 0;

        const card = document.createElement('div');
        card.className = "bg-gradient-to-br from-accord-blue to-accord-darkBlue border border-blue-400/40 text-white rounded-3xl p-6 shadow-md hover:shadow-lg transition-all flex flex-col justify-between space-y-4";
        card.innerHTML = `
            <div class="space-y-3">
                <div class="flex items-center justify-between gap-2">
                    <span class="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[10px] font-extrabold uppercase tracking-wider ${isClosed ? 'bg-accord-gold text-accord-slate' : 'bg-white/15 text-white border border-white/20'}">
                        <i class="fa-solid ${isClosed ? 'fa-trophy text-accord-slate' : 'fa-chart-line text-emerald-300'}"></i>
                        <span>${isClosed ? 'Category Winner' : 'Leading Now'}</span>
                    </span>
                    <span class="text-[11px] font-bold text-blue-100/90">${totalVotes} total votes</span>
                </div>
                <p class="text-xs font-bold text-blue-100/90 uppercase tracking-wider">${escapeHTML(poll.title)}</p>
                <h3 class="serif-heading text-xl font-bold text-white">${escapeHTML(leaderNames)}</h3>
            </div>
            <div class="pt-3 border-t border-white/15 flex items-center justify-between text-xs">
                <span class="font-bold text-white">${topCount} votes (${pct}%)</span>
                <a href="#polls" class="text-[11px] font-bold text-blue-100 hover:text-white transition-colors">View Poll →</a>
            </div>
        `;
        grid.appendChild(card);
    });
}

function renderPolls() {
    const container = document.getElementById('polls-container');
    if (!container) return;

    container.innerHTML = '';
    const visiblePolls = (musicData.polls || []).filter(p => !p.hidden);
    if (visiblePolls.length === 0) {
        container.innerHTML = `<p class="text-xs text-accord-muted col-span-full">No active award polls right now.</p>`;
        return;
    }

    visiblePolls.forEach(poll => {
        const isOpen = poll.status === 'open';
        const isNominating = poll.status === 'nominating';
        const totalVotes = Object.values(poll.votes || {}).reduce((a, b) => a + b, 0);
        const userVotedNominee = getUserVoteForPoll(poll);
        const hasVoted = Boolean(userVotedNominee);

        const statusBadge = isOpen
            ? `<span class="inline-block bg-emerald-50 text-emerald-700 text-[10px] font-extrabold uppercase tracking-wider px-2.5 py-0.5 rounded-full">Open</span>`
            : isNominating
                ? `<span class="inline-block bg-blue-50 text-accord-blue text-[10px] font-extrabold uppercase tracking-wider px-2.5 py-0.5 rounded-full">Nominating</span>`
                : `<span class="inline-block bg-amber-50 text-amber-700 text-[10px] font-extrabold uppercase tracking-wider px-2.5 py-0.5 rounded-full">Closed</span>`;

        let nomineesHtml = '';
        const nominees = (poll.nominees || []).map(normalizeNominee).filter(n => n.name);

        if (nominees.length === 0) {
            nomineesHtml = `
                <div class="p-3 rounded-xl bg-slate-50 border border-slate-200/80 text-xs text-accord-muted text-center space-y-1.5">
                    <p>No nominees yet.</p>
                    <button type="button" onclick="openNominationModal('${escapeHTML(poll.id).replace(/'/g, "\\'")}')" class="text-accord-blue font-bold hover:underline">Nominate →</button>
                </div>
            `;
        } else {
            nominees.forEach(nom => {
                const votesForNom = (poll.votes || {})[nom.name] || 0;
                const pct = totalVotes > 0 ? Math.round((votesForNom / totalVotes) * 100) : 0;
                const isUserChoice = userVotedNominee === nom.name;
                const artistPageUrl = findMatchingArtistPage(nom.name, nom.artistLink);

                nomineesHtml += `
                    <div class="space-y-1.5 p-2.5 rounded-xl border ${isUserChoice ? 'border-accord-blue bg-accord-lightBlue/30' : 'border-slate-200/80 bg-slate-50/60'} hover:border-accord-blue/60 transition-all">
                        <div class="flex items-center justify-between gap-2 text-xs">
                            <span class="font-semibold text-accord-slate truncate">${escapeHTML(nom.name)}</span>
                            <div class="flex items-center gap-1.5 shrink-0">
                                ${nom.songLink ? `
                                    <button type="button" onclick="openMediaPlayerModal('${escapeHTML(nom.name).replace(/'/g, "\\'")}', '${escapeHTML(poll.title).replace(/'/g, "\\'")}', '${escapeHTML(nom.songLink).replace(/'/g, "\\'")}')" title="Play Song" class="w-5 h-5 rounded-md bg-white border border-slate-200 hover:border-accord-blue text-accord-slate hover:text-accord-blue flex items-center justify-center transition-colors">
                                        <i class="fa-solid fa-play text-[8px]"></i>
                                    </button>
                                ` : ''}
                                ${artistPageUrl ? `
                                    <a href="${escapeHTML(artistPageUrl)}" ${artistPageUrl.startsWith('http') ? 'target="_blank" rel="noopener noreferrer"' : ''} title="Artiste Page" class="w-5 h-5 rounded-md bg-white border border-slate-200 hover:border-accord-blue text-accord-slate hover:text-accord-blue flex items-center justify-center transition-colors">
                                        <i class="fa-solid fa-user text-[8px]"></i>
                                    </a>
                                ` : ''}
                                <span class="text-[11px] text-accord-muted font-bold tabular-nums">${pct}%</span>
                            </div>
                        </div>
                        <div class="w-full bg-slate-200 h-1.5 rounded-full overflow-hidden">
                            <div class="bg-accord-blue h-full rounded-full transition-all duration-500" style="width: ${pct}%"></div>
                        </div>
                        ${isOpen ? (
                            !currentMusicUser ? `
                                <a href="signin.html?next=music.html" class="mt-1 w-full bg-white hover:bg-accord-blue hover:text-white text-accord-slate border border-slate-200 text-[11px] font-bold py-1 rounded-lg transition-all flex items-center justify-center gap-1">
                                    <span>Sign in to vote</span>
                                </a>
                            ` : hasVoted ? (
                                isUserChoice ? `
                                    <div class="mt-1 w-full text-center py-1 rounded-lg text-[11px] font-bold bg-accord-blue text-white">
                                        <i class="fa-solid fa-check mr-1"></i> Your Vote
                                    </div>
                                ` : ''
                            ) : `
                                <button type="button" onclick="castVote('${escapeHTML(poll.id).replace(/'/g, "\\'")}', '${escapeHTML(nom.name).replace(/'/g, "\\'")}')" class="mt-1 w-full bg-white hover:bg-accord-blue hover:text-white text-accord-slate border border-slate-200 text-[11px] font-bold py-1 rounded-lg transition-all">
                                    Vote
                                </button>
                            `
                        ) : ''}
                    </div>
                `;
            });
        }

        const card = document.createElement('div');
        card.className = "bg-white border border-slate-200/90 rounded-2xl p-4 shadow-sm space-y-3 flex flex-col justify-between";
        card.innerHTML = `
            <div class="space-y-2.5">
                <div class="flex items-center justify-between gap-2">
                    ${statusBadge}
                    <span class="text-[11px] text-accord-muted font-semibold">${totalVotes} votes</span>
                </div>
                <h3 class="serif-heading text-base font-bold text-accord-slate leading-snug">${escapeHTML(poll.title)}</h3>
                <div class="space-y-2 pt-0.5">
                    ${nomineesHtml}
                </div>
            </div>
        `;
        container.appendChild(card);
    });
}

async function castVote(pollId, nomineeName) {
    if (!currentMusicUser?.id) {
        showToast('Please sign in to vote in award polls.');
        setTimeout(() => { window.location.href = 'signin.html?next=music.html'; }, 900);
        return;
    }

    const poll = musicData.polls.find(p => p.id === pollId);
    if (!poll || poll.status !== 'open') return;

    if (getUserVoteForPoll(poll)) {
        showToast('You have already voted in this poll.');
        return;
    }

    if (!poll.votes) poll.votes = {};
    if (!poll.voters) poll.voters = {};

    poll.votes[nomineeName] = (poll.votes[nomineeName] || 0) + 1;
    poll.voters[currentMusicUser.id] = nomineeName;
    saveLocalUserVote(pollId, nomineeName);

    await saveMusicDataToSupabase();
    renderPollResults();
    renderPolls();
    showToast(`Vote recorded for ${nomineeName}!`);
}

// ==========================================
// 5. USER POLL NOMINATIONS (REGISTERED USERS)
// ==========================================

function openNominationModal(preselectedPollId = '') {
    if (!currentMusicUser?.id) {
        showToast('Please sign in to submit a poll nomination.');
        setTimeout(() => { window.location.href = 'signin.html?next=music.html'; }, 900);
        return;
    }

    const modal = document.getElementById('nomination-modal');
    const select = document.getElementById('nom-category-select');
    document.getElementById('nomination-form').reset();

    if (select) {
        const upcomingPolls = musicData.polls.filter(p => !p.hidden && (p.status === 'nominating' || p.status === 'open'));
        select.innerHTML = upcomingPolls.map(p => `<option value="${escapeHTML(p.id)}">${escapeHTML(p.title)}</option>`).join('')
            + `<option value="__new__">+ Suggest a New Category</option>`;
        if (preselectedPollId && upcomingPolls.some(p => p.id === preselectedPollId)) {
            select.value = preselectedPollId;
        }
    }
    toggleCustomNominationCategory();

    modal.classList.remove('hidden');
    modal.classList.add('flex');
}

function closeNominationModal() {
    const modal = document.getElementById('nomination-modal');
    modal.classList.remove('flex');
    modal.classList.add('hidden');
}

function toggleCustomNominationCategory() {
    const select = document.getElementById('nom-category-select');
    const wrap = document.getElementById('nom-custom-category-wrap');
    const input = document.getElementById('nom-custom-category');
    if (!select || !wrap) return;
    const isNew = select.value === '__new__';
    wrap.classList.toggle('hidden', !isNew);
    if (input) input.required = isNew;
}

async function handlePollNominationSubmit(e) {
    e.preventDefault();
    if (!currentMusicUser?.id) return;

    const select = document.getElementById('nom-category-select');
    const selectedVal = select.value;
    const customCat = document.getElementById('nom-custom-category').value.trim();
    const nomineeName = document.getElementById('nom-name').value.trim();
    const songLink = document.getElementById('nom-song-link').value.trim();
    const artistLink = document.getElementById('nom-artist-link').value.trim();

    const matchedPoll = selectedVal !== '__new__' ? musicData.polls.find(p => p.id === selectedVal) : null;
    const categoryTitle = matchedPoll ? matchedPoll.title : customCat;

    if (!categoryTitle) {
        showToast('Please enter a category name.');
        return;
    }

    musicData.pollNominations.unshift({
        id: 'nom-' + Date.now(),
        pollId: matchedPoll ? matchedPoll.id : '',
        categoryTitle,
        nomineeName,
        songLink,
        artistLink,
        submittedBy: currentMusicUser.id,
        submittedByEmail: currentMusicUser.email || '',
        status: 'pending',
        createdAt: new Date().toISOString()
    });

    await saveMusicDataToSupabase();
    closeNominationModal();
    showToast('Nomination submitted! Admins will review it for the upcoming poll.');
}

// ==========================================
// 6. USER ARTIST SPOTLIGHT SUBMISSIONS
// ==========================================

function openSpotlightSubmissionModal() {
    if (!currentMusicUser?.id) {
        showToast('Please sign in to submit an artiste spotlight.');
        setTimeout(() => { window.location.href = 'signin.html?next=music.html'; }, 900);
        return;
    }

    const modal = document.getElementById('spotlight-submission-modal');
    document.getElementById('spotlight-submission-form').reset();
    document.getElementById('sub-spotlight-image').value = '';
    document.getElementById('sub-spotlight-preview').classList.add('hidden');
    document.getElementById('sub-spotlight-placeholder').classList.remove('hidden');
    document.getElementById('sub-spotlight-upload-status').innerText = 'Square or portrait image works best.';
    document.getElementById('sub-spotlight-songs-container').innerHTML = '';
    addUserSpotlightSongRow();

    modal.classList.remove('hidden');
    modal.classList.add('flex');
}

function closeSpotlightSubmissionModal() {
    const modal = document.getElementById('spotlight-submission-modal');
    modal.classList.remove('flex');
    modal.classList.add('hidden');
}

function addUserSpotlightSongRow() {
    const container = document.getElementById('sub-spotlight-songs-container');
    if (!container) return;
    const row = document.createElement('div');
    row.className = 'grid grid-cols-1 sm:grid-cols-[1fr_1fr_auto] gap-2 items-center user-song-row';
    row.innerHTML = `
        <input type="text" placeholder="Song Title" class="user-song-title bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs focus:outline-none focus:border-accord-blue">
        <input type="url" placeholder="Streaming Link (Spotify, Apple, YouTube)" class="user-song-link bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs focus:outline-none focus:border-accord-blue">
        <button type="button" onclick="this.closest('.user-song-row').remove()" class="w-8 h-8 rounded-xl bg-slate-100 hover:bg-red-50 text-slate-500 hover:text-red-500 flex items-center justify-center text-xs" title="Remove">
            <i class="fa-solid fa-xmark"></i>
        </button>
    `;
    container.appendChild(row);
}

function compressImageFile(file, maxDim = 800, quality = 0.84) {
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
                canvas.getContext('2d').drawImage(img, 0, 0, width, height);
                canvas.toBlob(
                    blob => blob ? resolve({ blob, ext: 'webp', contentType: 'image/webp' }) : reject(new Error('Compression failed.')),
                    'image/webp',
                    quality
                );
            };
            img.src = reader.result;
        };
        reader.readAsDataURL(file);
    });
}

async function handleUserSpotlightCoverUpload(event) {
    const file = event?.target?.files?.[0];
    if (!file) return;

    const statusEl = document.getElementById('sub-spotlight-upload-status');
    const labelEl = document.getElementById('sub-spotlight-upload-label');
    if (statusEl) statusEl.innerText = 'Uploading...';
    if (labelEl) labelEl.classList.add('opacity-60', 'pointer-events-none');

    try {
        const { blob, ext, contentType } = await compressImageFile(file);
        const fileName = `spotlight_${Date.now()}_${Math.random().toString(36).slice(2, 7)}.${ext}`;
        let uploadRes = await supabaseClient.storage
            .from('archive-files')
            .upload(`music-covers/${fileName}`, blob, { cacheControl: '3600', contentType, upsert: false });

        if (uploadRes.error) {
            uploadRes = await supabaseClient.storage
                .from('archive-files')
                .upload(`avatars/${fileName}`, blob, { cacheControl: '3600', contentType, upsert: false });
        }

        if (uploadRes.error) throw new Error(uploadRes.error.message || 'Upload failed.');

        const { data: pub } = supabaseClient.storage.from('archive-files').getPublicUrl(uploadRes.data.path);
        const publicUrl = pub?.publicUrl || '';
        document.getElementById('sub-spotlight-image').value = publicUrl;
        const preview = document.getElementById('sub-spotlight-preview');
        const placeholder = document.getElementById('sub-spotlight-placeholder');
        if (preview && placeholder) {
            preview.src = publicUrl;
            preview.classList.remove('hidden');
            placeholder.classList.add('hidden');
        }
        if (statusEl) statusEl.innerText = 'Photo uploaded!';
        showToast('Cover photo uploaded!');
    } catch (err) {
        if (statusEl) statusEl.innerText = 'Upload failed';
        showToast(`Upload failed: ${err.message}`);
    } finally {
        if (labelEl) labelEl.classList.remove('opacity-60', 'pointer-events-none');
        event.target.value = '';
    }
}

async function handleSpotlightSubmission(e) {
    e.preventDefault();
    if (!currentMusicUser?.id) return;

    const title = document.getElementById('sub-spotlight-name').value.trim();
    const genre = document.getElementById('sub-spotlight-genre').value.trim() || 'Gospel';
    const image = document.getElementById('sub-spotlight-image').value.trim();
    const article = document.getElementById('sub-spotlight-article').value.trim();

    if (!image) {
        showToast('Please upload an artiste cover photo.');
        return;
    }

    const songs = [];
    document.querySelectorAll('#sub-spotlight-songs-container .user-song-row').forEach(row => {
        const sTitle = row.querySelector('.user-song-title')?.value.trim();
        const sLink = row.querySelector('.user-song-link')?.value.trim();
        if (sTitle || sLink) {
            songs.push({ title: sTitle || title, link: sLink || '' });
        }
    });

    musicData.spotlightSubmissions.unshift({
        id: 'subspot-' + Date.now(),
        title,
        genre,
        image,
        article,
        description: article,
        songs,
        submittedBy: currentMusicUser.id,
        submittedByEmail: currentMusicUser.email || '',
        status: 'pending',
        createdAt: new Date().toISOString()
    });

    await saveMusicDataToSupabase();
    closeSpotlightSubmissionModal();
    showToast('Artiste spotlight submitted! It will appear once approved by an admin.');
}

// ==========================================
// HELPERS
// ==========================================

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
