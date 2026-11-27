const SUPABASE_URL = 'https://mzblgajftvyyosyrawcx.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im16YmxnYWpmdHZ5eW9zeXJhd2N4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTQ0NzYxNTQsImV4cCI6MjExMDA1MjE1NH0.Xs9MeioNfqb5DzxDYP-9ZqfywBeOlUreAY-yKrcBmJM';
window.supabaseClient = window.supabaseClient || window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const supabaseClient = window.supabaseClient;
const MUSIC_CONFIG_RECORD_NAME = '__ACCORD_MUSIC_CONFIG__';

function escapeHTML(str) {
    return String(str || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function getEmbedUrl(url) {
    const raw = String(url || '').trim();
    if (!raw) return '';

    if (raw.includes('embed.podcasts.apple.com')) return raw;
    if (raw.includes('podcasts.apple.com')) {
        return raw.replace('https://podcasts.apple.com', 'https://embed.podcasts.apple.com').replace('http://podcasts.apple.com', 'https://embed.podcasts.apple.com');
    }
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

async function fetchMusicConfig() {
    try {
        const { data, error } = await supabaseClient
            .from('books')
            .select('description')
            .eq('title', MUSIC_CONFIG_RECORD_NAME)
            .maybeSingle();

        if (!error && data?.description) {
            const parsed = JSON.parse(data.description);
            localStorage.setItem('accord_music_config', JSON.stringify(parsed));
            return parsed;
        }
    } catch (e) {
        console.warn('Failed to fetch music config:', e);
    }

    const localSaved = localStorage.getItem('accord_music_config');
    if (localSaved) {
        try {
            return JSON.parse(localSaved);
        } catch {}
    }
    return { artistes: [] };
}

function renderSongs(artist) {
    const container = document.getElementById('artist-songs-list');
    if (!container) return;

    const songs = Array.isArray(artist.songs) && artist.songs.length > 0
        ? artist.songs.filter(s => s && (s.link || s.title))
        : (artist.link ? [{ title: `${artist.title} — Featured Release`, link: artist.link }] : []);

    if (songs.length === 0) {
        container.innerHTML = `
            <div class="bg-white border border-slate-200/80 rounded-2xl p-6 text-center text-xs text-accord-muted">
                No song embeds added for this artiste yet.
            </div>
        `;
        return;
    }

    container.innerHTML = songs.map((song, idx) => {
        const songTitle = song.title || `Track ${idx + 1}`;
        const songLink = song.link || '';
        const embedUrl = getEmbedUrl(songLink);
        const height = embedUrl.includes('embed.music.apple.com') ? '175' : (embedUrl.includes('youtube.com/embed') ? '315' : '152');

        return `
            <div class="bg-white border border-slate-200/90 rounded-3xl p-5 sm:p-6 shadow-sm space-y-4">
                <div class="flex flex-wrap items-center justify-between gap-3">
                    <div class="flex items-center gap-3 min-w-0">
                        <div class="w-9 h-9 rounded-xl bg-accord-lightBlue text-accord-blue flex items-center justify-center text-sm shrink-0">
                            <i class="fa-solid fa-music"></i>
                        </div>
                        <div class="min-w-0">
                            <h3 class="text-sm font-bold text-accord-slate truncate">${escapeHTML(songTitle)}</h3>
                            <p class="text-[11px] text-accord-muted truncate">${escapeHTML(artist.title)}</p>
                        </div>
                    </div>
                    ${songLink ? `
                        <a href="${escapeHTML(songLink)}" target="_blank" rel="noopener noreferrer" class="px-3.5 py-2 rounded-xl bg-slate-100 hover:bg-accord-blue hover:text-white text-accord-slate text-[11px] font-bold transition-all inline-flex items-center gap-1.5">
                            <span>Open Stream</span>
                            <i class="fa-solid fa-arrow-up-right-from-square text-[10px]"></i>
                        </a>
                    ` : ''}
                </div>
                ${embedUrl ? `
                    <div class="rounded-2xl overflow-hidden bg-slate-50 border border-slate-200/70">
                        <iframe src="${escapeHTML(embedUrl)}" allow="autoplay *; encrypted-media *; fullscreen *; clipboard-write" frameborder="0" height="${height}" style="width:100%;overflow:hidden;border-radius:12px;background:transparent;" loading="lazy" sandbox="allow-forms allow-popups allow-same-origin allow-scripts allow-storage-access-by-user-activation allow-top-navigation-by-user-activation"></iframe>
                    </div>
                ` : `
                    <p class="text-xs text-accord-muted">Direct embed unavailable for this link. Use "Open Stream" above to listen.</p>
                `}
            </div>
        `;
    }).join('');
}

window.onload = async function () {
    const params = new URLSearchParams(window.location.search);
    const artistId = params.get('id');
    const hub = params.get('hub');
    const loadingEl = document.getElementById('artist-loading');
    const notFoundEl = document.getElementById('artist-not-found');
    const contentEl = document.getElementById('artist-content');

    let artist = null;
    if (hub === 'sermons') {
        try {
            const { data } = await supabaseClient
                .from('books')
                .select('description')
                .eq('title', '__ACCORD_SERMONS_CONFIG__')
                .maybeSingle();
            const parsed = data?.description ? JSON.parse(data.description) : JSON.parse(localStorage.getItem('accord_sermons_config') || '{}');
            const pool = [
                ...(Array.isArray(parsed?.pastors) ? parsed.pastors : []),
                ...(Array.isArray(parsed?.ministries) ? parsed.ministries : [])
            ];
            artist = pool.find(a => a.id === artistId && a.approved !== false && !a.hidden) || null;
        } catch {}
    }

    if (!artist) {
        const config = await fetchMusicConfig();
        const artistes = Array.isArray(config?.artistes) ? config.artistes : [];
        artist = artistes.find(a => a.id === artistId && a.approved !== false && !a.hidden) || null;
    }

    if (loadingEl) loadingEl.classList.add('hidden');

    if (!artist) {
        if (notFoundEl) notFoundEl.classList.remove('hidden');
        return;
    }

    document.title = `${artist.title} — Artiste Spotlight | Accord Music Hub`;
    const fallbackImg = 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?auto=format&fit=crop&q=80&w=800';
    document.getElementById('artist-avatar').src = artist.image || fallbackImg;
    document.getElementById('artist-avatar').alt = artist.title || 'Artiste';
    document.getElementById('artist-genre').innerText = artist.genre || 'Gospel';
    document.getElementById('artist-name').innerText = artist.title || 'Artiste';

    const metaParts = [];
    if (artist.curator) metaParts.push(`Curated by ${artist.curator}`);
    if (artist.approvedAt || artist.createdAt) {
        const d = new Date(artist.approvedAt || artist.createdAt);
        if (!Number.isNaN(d.getTime())) {
            metaParts.push(d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }));
        }
    }
    document.getElementById('artist-meta').innerText = metaParts.join(' • ') || 'Accord Music Hub Editorial';

    if (artist.featured !== false) {
        document.getElementById('artist-featured-badge').classList.remove('hidden');
    }

    if (artist.link) {
        const extWrap = document.getElementById('artist-external-wrap');
        const extLink = document.getElementById('artist-external-link');
        extLink.href = artist.link;
        extWrap.classList.remove('hidden');
    }

    const articleEl = document.getElementById('artist-article-body');
    const articleText = artist.article || artist.description || 'No biography available yet.';
    articleEl.textContent = articleText;

    renderSongs(artist);

    if (contentEl) contentEl.classList.remove('hidden');
};
