// Accord Sermons Hub
const SUPABASE_URL = 'https://mzblgajftvyyosyrawcx.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im16YmxnYWpmdHZ5eW9zeXJhd2N4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTQ0NzYxNTQsImV4cCI6MjExMDA1MjE1NH0.Xs9MeioNfqb5DzxDYP-9ZqfywBeOlUreAY-yKrcBmJM';
window.supabaseClient = window.supabaseClient || window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const supabaseClient = window.supabaseClient;
const SERMONS_CONFIG_RECORD_NAME = '__ACCORD_SERMONS_CONFIG__';
const DEFAULT_SERMON_COVER_IMAGE = 'https://images.unsplash.com/photo-1507692049790-de58290a4334?auto=format&fit=crop&q=80&w=800';

let currentSermonsUser = null;
let activeTopicFilter = 'all';
let sermonSearchQuery = '';

let sermonsData = {
    pastors: [],
    ministries: [],
    playlists: [],
    sermonSpotlights: []
};

function normalizeSermonsData(parsed) {
    return {
        pastors: Array.isArray(parsed?.pastors) ? parsed.pastors : [],
        ministries: Array.isArray(parsed?.ministries) ? parsed.ministries : [],
        playlists: Array.isArray(parsed?.playlists) ? parsed.playlists : [],
        sermonSpotlights: Array.isArray(parsed?.sermonSpotlights) ? parsed.sermonSpotlights : []
    };
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
    const msgEl = document.getElementById('toast-message');
    if (!toast || !msgEl) return;
    msgEl.textContent = message;
    toast.classList.remove('translate-y-24', 'opacity-0');
    toast.classList.add('translate-y-0', 'opacity-100');
    setTimeout(() => {
        toast.classList.remove('translate-y-0', 'opacity-100');
        toast.classList.add('translate-y-24', 'opacity-0');
    }, 3200);
}

window.onload = async function () {
    const { data: { session } } = await supabaseClient.auth.getSession();
    currentSermonsUser = session?.user || null;

    await fetchSermonsData();
    const profileSermonPlaylists = await fetchPinnedProfileSermonPlaylists(sermonsData.playlists);
    if (profileSermonPlaylists.length > 0) {
        sermonsData.playlists = [...sermonsData.playlists, ...profileSermonPlaylists];
    }
    window.sermonsData = sermonsData;

    if (window.AccordPlaylists) {
        window.AccordPlaylists.registerPlaylists(sermonsData.playlists);
        await window.AccordPlaylists.loadSavedPlaylistIds(currentSermonsUser);
    }

    renderFeaturedSermons();
    renderPastorSpotlights();
    renderSermonSpotlights();
    renderMinistrySpotlights();
    renderTopicFilters();
    renderAllSermonPlaylists();

    const params = new URLSearchParams(window.location.search);
    const sharedPlaylistId = params.get('playlist');
    if (sharedPlaylistId && window.AccordPlaylists) {
        window.AccordPlaylists.openPlaylistPlayerModal(sharedPlaylistId, 'sermons');
    }
};

async function fetchSermonsData() {
    try {
        const { data, error } = await supabaseClient
            .from('books')
            .select('description')
            .eq('title', SERMONS_CONFIG_RECORD_NAME)
            .maybeSingle();

        if (!error && data?.description) {
            sermonsData = normalizeSermonsData(JSON.parse(data.description));
            localStorage.setItem('accord_sermons_config', JSON.stringify(sermonsData));
            return;
        }
    } catch (e) {
        console.warn('Could not load sermons config from Supabase:', e);
    }

    const localSaved = localStorage.getItem('accord_sermons_config');
    if (localSaved) {
        try {
            sermonsData = normalizeSermonsData(JSON.parse(localSaved));
            return;
        } catch {}
    }

    sermonsData = normalizeSermonsData({
        pastors: [],
        ministries: [],
        playlists: [],
        sermonSpotlights: []
    });
}

function collectNormalizedPlaylistUrls(playlists) {
    const urls = new Set();
    (playlists || []).forEach(pl => {
        const candidates = [
            pl?.link,
            pl?.spotifyLink,
            pl?.audiomackLink,
            pl?.appleMusicLink,
            pl?.links?.spotify,
            pl?.links?.audiomack,
            pl?.links?.apple
        ];
        candidates.forEach(raw => {
            const normalized = String(raw || '').trim().toLowerCase().replace(/\/+$/, '');
            if (normalized) urls.add(normalized);
        });
    });
    return urls;
}

const SERMON_CALLING_CATEGORIES = new Set([
    'church / ministry',
    'preacher',
    'church / local assembly',
    'christian ministry / fellowship',
    'pastor / ordained minister',
    'evangelist / missionary'
]);

function getSermonCategoryGenre(ministryRole, audioStreamType) {
    const roleLower = String(ministryRole || '').trim().toLowerCase();
    if (roleLower === 'church / ministry' || roleLower === 'church / local assembly' || roleLower === 'christian ministry / fellowship') {
        return 'Church / Ministry Sermons';
    }
    if (roleLower === 'preacher' || roleLower === 'pastor / ordained minister' || roleLower === 'evangelist / missionary') {
        return 'Preacher Sermons';
    }
    if (String(audioStreamType || '').trim().toLowerCase() === 'podcast') {
        return 'Podcast & Teaching';
    }
    return 'Creator & Ministry Sermons';
}

async function fetchPinnedProfileSermonPlaylists(existingPlaylists = []) {
    try {
        let { data, error } = await supabaseClient
            .from('profiles')
            .select('id, full_name, handle, bio, avatar_url, account_type, upgrade_status, ministry_role, audio_stream_url, audio_stream_type')
            .not('audio_stream_url', 'is', null);

        if (error && /ministry_role|upgrade_status|account_type/i.test(error.message || '')) {
            const fallbackRes = await supabaseClient
                .from('profiles')
                .select('id, full_name, handle, bio, avatar_url, audio_stream_url, audio_stream_type')
                .in('audio_stream_type', ['sermons', 'podcast'])
                .not('audio_stream_url', 'is', null);
            data = fallbackRes.data;
            error = fallbackRes.error;
        }

        if (error || !Array.isArray(data)) {
            if (error && !/audio_stream_/i.test(error.message || '')) {
                console.warn('Could not load pinned profile sermon links:', error);
            }
            return [];
        }

        const existingUrls = collectNormalizedPlaylistUrls(existingPlaylists);
        const derived = [];

        data.forEach(profile => {
            if (String(profile?.upgrade_status || '').toLowerCase() === 'revoked') return;

            const url = String(profile?.audio_stream_url || '').trim();
            if (!url) return;

            const streamType = String(profile?.audio_stream_type || '').trim().toLowerCase();
            // Music links never feed into the Sermons page.
            if (streamType === 'music') return;

            const roleLower = String(profile?.ministry_role || '').trim().toLowerCase();
            const isSermonCalling = SERMON_CALLING_CATEGORIES.has(roleLower);
            const isSermonOrPodcastStream = streamType === 'sermons' || streamType === 'podcast';

            // Feed pinned audio links from Church / Ministry and Preacher profiles,
            // as well as any profile explicitly categorized as sermons or podcast.
            if (!isSermonCalling && !isSermonOrPodcastStream) return;

            const normalizedUrl = url.toLowerCase().replace(/\/+$/, '');
            if (existingUrls.has(normalizedUrl)) return;
            existingUrls.add(normalizedUrl);

            const displayName = String(profile.full_name || '').trim()
                || (profile.handle ? `@${String(profile.handle).replace(/^@/, '')}` : 'Accord Creator');
            const handleLabel = profile.handle
                ? `@${String(profile.handle).replace(/^@/, '')}`
                : displayName;

            const avatarUrl = String(profile.avatar_url || '').trim();
            const bioText = String(profile.bio || '').trim();

            derived.push({
                id: `profile_sermon_${profile.id}`,
                title: `${displayName} — Sermons`,
                genre: getSermonCategoryGenre(profile.ministry_role, streamType),
                curator: handleLabel,
                image: avatarUrl || DEFAULT_SERMON_COVER_IMAGE,
                description: bioText || `Pinned sermon stream from ${displayName}.`,
                link: url,
                featured: false,
                hidden: false,
                sourceProfileId: profile.id,
                hasDefaultCover: !avatarUrl,
                hasDefaultTitle: true,
                hasDefaultDesc: !bioText
            });
        });

        return derived;
    } catch (e) {
        console.warn('Could not load pinned profile sermon links:', e);
        return [];
    }
}

function renderFeaturedSermons() {
    const grid = document.getElementById('featured-sermons-grid');
    if (!grid) return;

    const visible = sermonsData.playlists.filter(p => !p.hidden);
    const featured = visible.filter(p => p.featured !== false);
    const toShow = (featured.length > 0 ? featured : visible).slice(0, 6);

    if (toShow.length === 0) {
        grid.innerHTML = `<div class="col-span-full bg-white border border-slate-200 rounded-2xl p-8 text-center text-xs text-accord-muted">No featured sermon audios yet. Admins can add sermon audios from the Sermons Admin panel.</div>`;
        return;
    }

    grid.innerHTML = '';
    toShow.forEach(pl => {
        if (window.AccordPlaylists?.createPlaylistCardElement) {
            grid.appendChild(window.AccordPlaylists.createPlaylistCardElement(pl, { pageSource: 'sermons' }));
        }
    });
}

function renderCircularSpotlightGrid(containerId, items, kind, emptyMessage) {
    const grid = document.getElementById(containerId);
    if (!grid) return;

    grid.innerHTML = '';
    const featured = items.filter(a => a.approved !== false && a.featured !== false && !a.hidden);

    if (featured.length === 0) {
        grid.innerHTML = `<p class="text-xs text-accord-muted">${escapeHTML(emptyMessage)} <a href="artist-blog.html" class="text-accord-blue font-bold hover:underline">View all articles on the blog</a>.</p>`;
        return;
    }

    const fallbackImg = 'https://images.unsplash.com/photo-1507692049790-de58290a4334?auto=format&fit=crop&q=80&w=800';
    featured.forEach(item => {
        const link = document.createElement('a');
        link.href = `artist.html?id=${encodeURIComponent(item.id)}&hub=sermons&kind=${encodeURIComponent(kind)}`;
        link.className = 'group flex flex-col items-center text-center w-32 sm:w-40 shrink-0';
        link.innerHTML = `
            <div class="relative p-1 rounded-full bg-gradient-to-tr from-accord-blue via-sky-400 to-accord-gold shadow-md group-hover:shadow-xl transition-all duration-300">
                <div class="w-28 h-28 sm:w-36 sm:h-36 rounded-full overflow-hidden bg-slate-100 ring-2 ring-white">
                    <img src="${escapeHTML(item.image || fallbackImg)}" alt="${escapeHTML(item.title)}" class="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500">
                </div>
                <span class="absolute bottom-1 right-1 w-7 h-7 rounded-full bg-white shadow-md border border-slate-100 flex items-center justify-center text-accord-blue text-[11px] group-hover:bg-accord-blue group-hover:text-white transition-colors">
                    <i class="fa-solid fa-play ml-0.5"></i>
                </span>
            </div>
            <h3 class="mt-3 text-sm sm:text-base font-bold text-accord-slate group-hover:text-accord-blue transition-colors leading-tight line-clamp-1">${escapeHTML(item.title)}</h3>
            <p class="text-[11px] text-accord-muted mt-0.5 line-clamp-1">${escapeHTML(item.genre || (kind === 'pastor' ? 'Pastor' : 'Ministry'))}</p>
        `;
        grid.appendChild(link);
    });
}

function renderPastorSpotlights() {
    renderCircularSpotlightGrid(
        'pastor-spotlight-grid',
        sermonsData.pastors,
        'pastor',
        'No featured pastor spotlights currently available.'
    );
}

function renderMinistrySpotlights() {
    renderCircularSpotlightGrid(
        'ministry-spotlight-grid',
        sermonsData.ministries,
        'ministry',
        'No featured ministry spotlights currently available.'
    );
}

function renderSermonSpotlights() {
    const grid = document.getElementById('sermon-spotlight-grid');
    if (!grid) return;

    grid.innerHTML = '';
    const items = (sermonsData.sermonSpotlights || []).filter(s => !s.hidden);
    if (items.length === 0) {
        grid.innerHTML = `<p class="text-xs text-accord-muted col-span-full">No featured sermons in Sermon Spotlight yet.</p>`;
        return;
    }

    items.forEach(sermon => {
        const card = document.createElement('div');
        card.className = 'bg-accord-blue border border-white/20 text-white rounded-2xl p-4 shadow-md hover:shadow-lg transition-all flex items-center justify-between gap-3';
        card.innerHTML = `
            <div class="flex items-center gap-3 min-w-0">
                <button type="button" onclick="openSermonSpotlightPlayer('${escapeHTML(sermon.id)}')" class="w-11 h-11 rounded-full bg-white hover:bg-accord-lightBlue text-accord-blue flex items-center justify-center shrink-0 transition-all shadow-sm" title="Play ${escapeHTML(sermon.title)}">
                    <i class="fa-solid fa-play text-sm ml-0.5"></i>
                </button>
                <div class="min-w-0">
                    <h3 class="text-sm font-bold text-white truncate">${escapeHTML(sermon.title)}</h3>
                    <p class="text-xs text-blue-100 truncate">${escapeHTML(sermon.artist || 'Guest Preacher')}</p>
                </div>
            </div>
            <div class="flex items-center gap-1.5 shrink-0">
                <a href="${escapeHTML(sermon.link || '#')}" target="_blank" rel="noopener noreferrer" class="w-8 h-8 rounded-lg bg-white/15 hover:bg-white/25 text-white flex items-center justify-center text-xs transition-colors" title="Open External Stream">
                    <i class="fa-solid fa-arrow-up-right-from-square"></i>
                </a>
                <button type="button" onclick="shareSermonSpotlight('${escapeHTML(sermon.id)}')" class="w-8 h-8 rounded-lg bg-white/15 hover:bg-white/25 text-white flex items-center justify-center text-xs transition-colors" title="Share Sermon">
                    <i class="fa-solid fa-share-nodes"></i>
                </button>
            </div>
        `;
        grid.appendChild(card);
    });
}

function renderTopicFilters() {
    const container = document.getElementById('sermon-playlist-filters');
    if (!container) return;

    const visible = sermonsData.playlists.filter(p => !p.hidden);
    const topics = Array.from(new Set(visible.map(p => String(p.genre || '').trim()).filter(Boolean)));
    const pills = ['all', ...topics];

    container.innerHTML = pills.map(topic => {
        const isActive = activeTopicFilter === topic;
        const label = topic === 'all' ? 'All Topics & Series' : topic;
        return `
            <button type="button" onclick="setSermonTopicFilter('${escapeHTML(topic).replace(/'/g, "\\'")}')" class="shrink-0 px-3.5 py-1.5 rounded-full text-xs font-bold transition-all ${isActive ? 'bg-accord-blue text-white shadow-sm' : 'bg-white hover:bg-accord-lightBlue text-accord-slate border border-slate-200'}">
                ${escapeHTML(label)}
            </button>
        `;
    }).join('');
}

function setSermonTopicFilter(topic) {
    activeTopicFilter = topic;
    renderTopicFilters();
    renderAllSermonPlaylists();
}

function handleSermonPlaylistSearch() {
    sermonSearchQuery = (document.getElementById('sermon-playlist-search')?.value || '').trim().toLowerCase();
    renderAllSermonPlaylists();
}

function renderAllSermonPlaylists() {
    const container = document.getElementById('sermon-playlists-container');
    if (!container) return;

    const filtered = sermonsData.playlists.filter(p => {
        if (p.hidden) return false;
        if (activeTopicFilter !== 'all' && String(p.genre || '').trim() !== activeTopicFilter) return false;
        if (!sermonSearchQuery) return true;
        return (p.title || '').toLowerCase().includes(sermonSearchQuery)
            || (p.genre || '').toLowerCase().includes(sermonSearchQuery)
            || (p.curator || '').toLowerCase().includes(sermonSearchQuery)
            || (p.description || '').toLowerCase().includes(sermonSearchQuery);
    });

    if (filtered.length === 0) {
        container.innerHTML = `<div class="bg-white border border-slate-200 rounded-3xl p-10 text-center text-xs text-accord-muted">No sermon audios match your filter.</div>`;
        return;
    }

    // Group by topic/genre when viewing 'all' and no search query, otherwise show unified grid
    const grouped = new Map();
    filtered.forEach(pl => {
        const groupName = String(pl.genre || '').trim() || 'General Sermon Series';
        if (!grouped.has(groupName)) grouped.set(groupName, []);
        grouped.get(groupName).push(pl);
    });

    container.innerHTML = '';
    grouped.forEach((items, groupName) => {
        const section = document.createElement('div');
        section.className = 'space-y-4';
        section.innerHTML = `
            <div class="flex items-center justify-between border-b border-slate-200/80 pb-2">
                <h3 class="serif-heading text-lg font-bold text-accord-slate flex items-center gap-2">
                    <span class="w-2 h-2 rounded-full bg-accord-blue"></span>
                    <span>${escapeHTML(groupName)}</span>
                </h3>
                <span class="text-[11px] font-bold text-accord-muted">${items.length} ${items.length === 1 ? 'sermon' : 'sermons'}</span>
            </div>
            <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6"></div>
        `;
        const grid = section.querySelector('.grid');
        items.forEach(pl => {
            if (window.AccordPlaylists?.createPlaylistCardElement) {
                grid.appendChild(window.AccordPlaylists.createPlaylistCardElement(pl, { pageSource: 'sermons' }));
            }
        });
        container.appendChild(section);
    });
}

function openSermonSpotlightPlayer(id) {
    const sermon = (sermonsData.sermonSpotlights || []).find(s => s.id === id);
    if (!sermon) return;
    if (window.AccordPlaylists?.openMediaPlayerModal) {
        window.AccordPlaylists.openMediaPlayerModal(sermon.title, sermon.artist || 'Sermon Spotlight', sermon.link);
    } else if (sermon.link) {
        window.open(sermon.link, '_blank', 'noopener,noreferrer');
    }
}

async function shareSermonSpotlight(id) {
    const sermon = (sermonsData.sermonSpotlights || []).find(s => s.id === id);
    if (!sermon) return;
    const shareUrl = sermon.link || window.location.href;
    if (navigator.share) {
        try {
            await navigator.share({
                title: `${sermon.title} — ${sermon.artist || 'Accord Sermons'}`,
                text: `Listen to "${sermon.title}" on Accord Sermons Hub`,
                url: shareUrl
            });
            return;
        } catch {}
    }
    try {
        await navigator.clipboard.writeText(shareUrl);
        showToast('Sermon link copied to clipboard!');
    } catch {
        showToast('Unable to copy link.');
    }
}

function closePlaylistPlayerModal() {
    if (window.AccordPlaylists?.closePlaylistPlayerModal) {
        window.AccordPlaylists.closePlaylistPlayerModal();
    } else {
        const modal = document.getElementById('playlist-player-modal');
        modal?.classList.add('hidden');
        modal?.classList.remove('flex');
    }
}
