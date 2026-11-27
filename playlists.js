const SUPABASE_URL = 'https://mzblgajftvyyosyrawcx.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im16YmxnYWpmdHZ5eW9zeXJhd2N4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTQ0NzYxNTQsImV4cCI6MjExMDA1MjE1NH0.Xs9MeioNfqb5DzxDYP-9ZqfywBeOlUreAY-yKrcBmJM';
window.supabaseClient = window.supabaseClient || window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const supabaseClient = window.supabaseClient;
const MUSIC_CONFIG_RECORD_NAME = '__ACCORD_MUSIC_CONFIG__';

let allPlaylists = [];
let activeGenreFilter = 'all';
let searchQuery = '';

window.onload = async function () {
    const { data: { session } } = await supabaseClient.auth.getSession();
    const currentUser = session?.user || null;

    await fetchAllPlaylists();
    if (window.AccordPlaylists) {
        window.AccordPlaylists.registerPlaylists(allPlaylists);
        await window.AccordPlaylists.loadSavedPlaylistIds(currentUser);
    }

    const loadingEl = document.getElementById('playlists-loading');
    if (loadingEl) loadingEl.classList.add('hidden');

    renderGenreFilters();
    renderPlaylistChunks();

    const params = new URLSearchParams(window.location.search);
    const sharedPlaylistId = params.get('playlist');
    if (sharedPlaylistId && window.AccordPlaylists) {
        window.AccordPlaylists.openPlaylistPlayerModal(sharedPlaylistId, 'playlists');
    }
};

async function fetchAllPlaylists() {
    try {
        const { data, error } = await supabaseClient
            .from('books')
            .select('description')
            .eq('title', MUSIC_CONFIG_RECORD_NAME)
            .maybeSingle();

        if (!error && data?.description) {
            const parsed = JSON.parse(data.description);
            const playlists = Array.isArray(parsed?.playlists) ? parsed.playlists : [];
            allPlaylists = playlists.filter(p => !p.hidden);
            window.musicData = { playlists: allPlaylists };
            return;
        }
    } catch (e) {
        console.warn('Could not load playlists from Supabase:', e);
    }

    const localSaved = localStorage.getItem('accord_music_config');
    if (localSaved) {
        try {
            const parsed = JSON.parse(localSaved);
            const playlists = Array.isArray(parsed?.playlists) ? parsed.playlists : [];
            allPlaylists = playlists.filter(p => !p.hidden);
            window.musicData = { playlists: allPlaylists };
        } catch {}
    }
}

function renderGenreFilters() {
    const container = document.getElementById('playlist-genre-filters');
    if (!container) return;

    const genres = Array.from(new Set(
        allPlaylists.map(p => String(p.genre || '').trim()).filter(Boolean)
    ));

    const pills = ['all', ...genres];
    container.innerHTML = pills.map(genre => {
        const isActive = activeGenreFilter === genre;
        const label = genre === 'all' ? 'All Genres' : genre;
        return `
            <button type="button" onclick="setGenreFilter('${escapeHTML(genre).replace(/'/g, "\\'")}')" class="shrink-0 px-3 py-1.5 rounded-full text-[11px] font-bold transition-all ${isActive ? 'bg-white text-accord-darkBlue shadow-sm' : 'bg-white/15 hover:bg-white/25 text-white border border-white/15'}">
                ${escapeHTML(label)}
            </button>
        `;
    }).join('');
}

function setGenreFilter(genre) {
    activeGenreFilter = genre;
    renderGenreFilters();
    renderPlaylistChunks();
}

function handlePlaylistSearch() {
    const input = document.getElementById('playlist-search-input');
    searchQuery = (input?.value || '').trim().toLowerCase();
    renderPlaylistChunks();
}

function buildPlaylistChunks(playlists) {
    if (playlists.length === 0) return [];
    if (playlists.length === 1) {
        return [{ title: 'Curated Selection', subtitle: 'Editorial pick for your listening', mode: 'horizontal', items: playlists }];
    }

    const chunkTitles = [
        { title: 'Featured & Trending Mixes', subtitle: 'Swipe horizontally through our highlighted gospel selections' },
        { title: 'Editorial Vertical Collection', subtitle: 'Scroll vertically through curated worship & praise playlists' },
        { title: 'More SoundSpace Selections', subtitle: 'Discover additional mixes across genres' },
        { title: 'Archive & Community Picks', subtitle: 'Explore more curated gospel collections' }
    ];

    // Ensure at least one horizontal and one vertical chunk when >= 2 playlists
    const chunkSize = playlists.length <= 6 ? Math.ceil(playlists.length / 2) : 4;
    const chunks = [];
    for (let i = 0; i < playlists.length; i += chunkSize) {
        const idx = chunks.length;
        const meta = chunkTitles[idx % chunkTitles.length];
        chunks.push({
            title: meta.title,
            subtitle: meta.subtitle,
            mode: idx % 2 === 0 ? 'horizontal' : 'vertical',
            items: playlists.slice(i, i + chunkSize)
        });
    }
    return chunks;
}

function scrollPlaylistShelf(shelfId, direction) {
    const shelf = document.getElementById(shelfId);
    if (!shelf) return;
    const distance = Math.max(320, Math.round(shelf.clientWidth * 0.78));
    shelf.scrollBy({ left: direction * distance, behavior: 'smooth' });
}

function renderPlaylistChunks() {
    const container = document.getElementById('playlists-chunks-container');
    if (!container) return;

    const filtered = allPlaylists.filter(pl => {
        if (activeGenreFilter !== 'all' && String(pl.genre || '').trim() !== activeGenreFilter) {
            return false;
        }
        if (searchQuery) {
            const haystack = `${pl.title || ''} ${pl.curator || ''} ${pl.genre || ''} ${pl.description || ''}`.toLowerCase();
            if (!haystack.includes(searchQuery)) return false;
        }
        return true;
    });

    if (filtered.length === 0) {
        container.innerHTML = `
            <div class="bg-white border border-slate-200 rounded-3xl p-10 text-center space-y-2">
                <i class="fa-solid fa-headphones text-2xl text-accord-blue"></i>
                <h3 class="text-sm font-bold text-accord-slate">No matching playlists found</h3>
                <p class="text-xs text-accord-muted">Try clearing your search or selecting a different genre filter.</p>
            </div>
        `;
        return;
    }

    container.innerHTML = '';
    const chunks = buildPlaylistChunks(filtered);

    chunks.forEach((chunk, idx) => {
        const section = document.createElement('section');
        section.className = 'space-y-4';

        if (chunk.mode === 'horizontal') {
            const shelfId = `playlist-shelf-${idx}`;
            section.innerHTML = `
                <div class="flex items-end justify-between gap-3">
                    <div>
                        <span class="inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-accord-blue">
                            <i class="fa-solid fa-arrows-left-right text-[9px]"></i>
                            Horizontal Shelf
                        </span>
                        <h2 class="serif-heading text-xl font-bold text-accord-slate mt-0.5">${escapeHTML(chunk.title)}</h2>
                        <p class="text-xs text-accord-muted">${escapeHTML(chunk.subtitle)}</p>
                    </div>
                    <div class="hidden sm:flex items-center gap-2 shrink-0">
                        <button type="button" onclick="scrollPlaylistShelf('${shelfId}', -1)" class="w-9 h-9 rounded-full bg-white hover:bg-accord-lightBlue border border-slate-200 text-accord-slate hover:text-accord-blue flex items-center justify-center shadow-xs transition-all" aria-label="Scroll left">
                            <i class="fa-solid fa-chevron-left text-xs"></i>
                        </button>
                        <button type="button" onclick="scrollPlaylistShelf('${shelfId}', 1)" class="w-9 h-9 rounded-full bg-white hover:bg-accord-lightBlue border border-slate-200 text-accord-slate hover:text-accord-blue flex items-center justify-center shadow-xs transition-all" aria-label="Scroll right">
                            <i class="fa-solid fa-chevron-right text-xs"></i>
                        </button>
                    </div>
                </div>
                <div id="${shelfId}" class="flex gap-5 overflow-x-auto pb-3 snap-x snap-mandatory scroll-smooth no-scrollbar"></div>
            `;
            const shelf = section.querySelector(`#${shelfId}`);
            chunk.items.forEach(pl => {
                const card = window.AccordPlaylists.createPlaylistCardElement(pl, {
                    pageSource: 'playlists',
                    cardClass: 'w-[86vw] sm:w-[440px] lg:w-[470px] shrink-0 snap-start'
                });
                shelf.appendChild(card);
            });
        } else {
            const gridId = `playlist-vertical-${idx}`;
            section.className = 'rounded-3xl bg-gradient-to-br from-[#E8F1FF]/80 via-[#F4F8FF] to-white border border-blue-200/70 p-5 sm:p-7 space-y-4';
            section.innerHTML = `
                <div>
                    <span class="inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-accord-blue">
                        <i class="fa-solid fa-arrows-up-down text-[9px]"></i>
                        Vertical Collection
                    </span>
                    <h2 class="serif-heading text-xl font-bold text-accord-slate mt-0.5">${escapeHTML(chunk.title)}</h2>
                    <p class="text-xs text-accord-muted">${escapeHTML(chunk.subtitle)}</p>
                </div>
                <div id="${gridId}" class="max-h-[680px] overflow-y-auto pr-1 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6"></div>
            `;
            const grid = section.querySelector(`#${gridId}`);
            chunk.items.forEach(pl => {
                const card = window.AccordPlaylists.createPlaylistCardElement(pl, {
                    pageSource: 'playlists'
                });
                grid.appendChild(card);
            });
        }

        container.appendChild(section);
    });
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
