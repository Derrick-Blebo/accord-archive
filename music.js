// 1. Initialize Supabase
const SUPABASE_URL = 'https://mzblgajftvyyosyrawcx.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im16YmxnYWpmdHZ5eW9zeXJhd2N4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTQ0NzYxNTQsImV4cCI6MjExMDA1MjE1NH0.Xs9MeioNfqb5DzxDYP-9ZqfywBeOlUreAY-yKrcBmJM';
const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const MUSIC_CONFIG_RECORD_NAME = '__ACCORD_MUSIC_CONFIG__';

let musicData = {
    artistes: [],
    playlists: [],
    polls: []
};

// ==========================================
// INITIALIZATION
// ==========================================

window.onload = async function () {
    await fetchMusicData();
    renderSpotlights();
    renderPlaylists();
    renderPolls();
};

async function fetchMusicData() {
    const { data, error } = await supabaseClient
        .from('books')
        .select('description')
        .eq('title', MUSIC_CONFIG_RECORD_NAME)
        .maybeSingle();

    if (!error && data?.description) {
        try {
            const parsed = JSON.parse(data.description);
            musicData = {
                artistes: Array.isArray(parsed.artistes) ? parsed.artistes : [],
                playlists: Array.isArray(parsed.playlists) ? parsed.playlists : [],
                polls: Array.isArray(parsed.polls) ? parsed.polls : []
            };
            return;
        } catch (e) {}
    }

    // Fallback to localStorage or default seed data if offline/unconfigured
    const localSaved = localStorage.getItem('accord_music_config');
    if (localSaved) {
        try {
            const parsed = JSON.parse(localSaved);
            musicData = {
                artistes: Array.isArray(parsed.artistes) ? parsed.artistes : [],
                playlists: Array.isArray(parsed.playlists) ? parsed.playlists : [],
                polls: Array.isArray(parsed.polls) ? parsed.polls : []
            };
            return;
        } catch (e) {}
    }

    // Default Seed Data matching SoundSpace PR editorial standards
    musicData = {
        artistes: [
            {
                id: 'art-1',
                title: 'RichieO',
                genre: 'Contemporary AfroGospel',
                image: 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?auto=format&fit=crop&q=80&w=800',
                link: 'https://open.spotify.com/',
                description: 'Featured lead artist for the UNVL Project. Bringing vibrant contemporary AfroGospel sounds with deep spiritual messages.'
            },
            {
                id: 'art-2',
                title: 'OK Muziq',
                genre: 'Urban Gospel & Soul',
                image: 'https://images.unsplash.com/photo-1514525253161-7a46d19cd819?auto=format&fit=crop&q=80&w=800',
                link: 'https://open.spotify.com/',
                description: 'Known for soulful melodies and inspiring lyricism that bridge contemporary urban culture and faith.'
            },
            {
                id: 'art-3',
                title: 'Pacome Ben Elohim',
                genre: 'Worship & Praise',
                image: 'https://images.unsplash.com/photo-1465847899084-d164df4dedc6?auto=format&fit=crop&q=80&w=800',
                link: 'https://open.spotify.com/',
                description: 'Passionate worship leader delivering powerful acoustic and live ministry records.'
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
                nominees: ['RichieO - Higher Ground', 'OK Muziq - Gratitude', 'Pacome Ben Elohim - Grace'],
                votes: { 'RichieO - Higher Ground': 120, 'OK Muziq - Gratitude': 95, 'Pacome Ben Elohim - Grace': 140 },
                status: 'open'
            }
        ]
    };
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
        await supabaseClient.from('books').update(payload).eq('id', existing.id);
    } else {
        await supabaseClient.from('books').insert([payload]);
    }
}

// ==========================================
// RENDER UI
// ==========================================

function renderSpotlights() {
    const grid = document.getElementById('spotlight-grid');
    if (!grid) return;

    grid.innerHTML = '';
    if (musicData.artistes.length === 0) {
        grid.innerHTML = `<p class="text-xs text-accord-muted col-span-full">No artiste spotlights currently available.</p>`;
        return;
    }

    musicData.artistes.forEach(artist => {
        const fallbackImg = 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?auto=format&fit=crop&q=80&w=800';
        const card = document.createElement('div');
        card.className = "bg-white border border-slate-200/90 rounded-3xl overflow-hidden shadow-sm hover:shadow-md transition-all flex flex-col justify-between";
        card.innerHTML = `
            <div>
                <div class="h-48 overflow-hidden bg-slate-100">
                    <img src="${escapeHTML(artist.image || fallbackImg)}" alt="${escapeHTML(artist.title)}" class="w-full h-full object-cover hover:scale-105 transition-transform duration-500">
                </div>
                <div class="p-6 space-y-2">
                    <span class="inline-block bg-accord-lightBlue text-accord-blue text-[10px] font-extrabold uppercase tracking-wider px-2.5 py-1 rounded-full">${escapeHTML(artist.genre || 'Gospel')}</span>
                    <h3 class="serif-heading text-xl font-bold text-accord-slate">${escapeHTML(artist.title)}</h3>
                    <p class="text-xs text-accord-muted leading-relaxed">${escapeHTML(artist.description || '')}</p>
                </div>
            </div>
            <div class="px-6 pb-6 pt-2">
                <a href="${escapeHTML(artist.link || '#')}" target="_blank" class="w-full bg-slate-100 hover:bg-accord-blue hover:text-white text-accord-slate text-xs font-bold py-3 rounded-xl transition-all flex items-center justify-center space-x-2">
                    <i class="fa-solid fa-play text-[10px]"></i>
                    <span>Listen / Stream</span>
                </a>
            </div>
        `;
        grid.appendChild(card);
    });
}

function renderPlaylists() {
    const grid = document.getElementById('playlist-grid');
    if (!grid) return;

    grid.innerHTML = '';
    if (musicData.playlists.length === 0) {
        grid.innerHTML = `<p class="text-xs text-accord-muted col-span-full">No curated playlists currently available.</p>`;
        return;
    }

    musicData.playlists.forEach(pl => {
        const fallbackImg = 'https://images.unsplash.com/photo-1470225620780-dba8ba36b745?auto=format&fit=crop&q=80&w=800';
        const card = document.createElement('div');
        card.className = "bg-white border border-slate-200/90 rounded-3xl overflow-hidden shadow-sm hover:shadow-md transition-all flex flex-col justify-between";
        card.innerHTML = `
            <div>
                <div class="h-48 overflow-hidden bg-slate-100">
                    <img src="${escapeHTML(pl.image || fallbackImg)}" alt="${escapeHTML(pl.title)}" class="w-full h-full object-cover hover:scale-105 transition-transform duration-500">
                </div>
                <div class="p-6 space-y-2">
                    <span class="inline-block bg-amber-50 text-accord-gold text-[10px] font-extrabold uppercase tracking-wider px-2.5 py-1 rounded-full">${escapeHTML(pl.genre || 'Playlist')}</span>
                    <h3 class="serif-heading text-xl font-bold text-accord-slate">${escapeHTML(pl.title)}</h3>
                    <p class="text-xs text-accord-muted leading-relaxed">${escapeHTML(pl.description || '')}</p>
                </div>
            </div>
            <div class="px-6 pb-6 pt-2">
                <a href="${escapeHTML(pl.link || '#')}" target="_blank" class="w-full bg-accord-blue hover:bg-accord-darkBlue text-white text-xs font-bold py-3 rounded-xl shadow-md transition-all flex items-center justify-center space-x-2">
                    <i class="fa-solid fa-headphones text-[10px]"></i>
                    <span>Open Playlist</span>
                </a>
            </div>
        `;
        grid.appendChild(card);
    });
}

function renderPolls() {
    const container = document.getElementById('polls-container');
    if (!container) return;

    container.innerHTML = '';
    if (musicData.polls.length === 0) {
        container.innerHTML = `<p class="text-xs text-accord-muted col-span-full">No active award polls right now.</p>`;
        return;
    }

    musicData.polls.forEach(poll => {
        const isOpen = poll.status === 'open';
        const totalVotes = Object.values(poll.votes || {}).reduce((a, b) => a + b, 0);

        let nomineesHtml = '';
        (poll.nominees || []).forEach(nominee => {
            const votesForNom = (poll.votes || {})[nominee] || 0;
            const pct = totalVotes > 0 ? Math.round((votesForNom / totalVotes) * 100) : 0;

            nomineesHtml += `
                <div class="space-y-1.5 p-3.5 rounded-2xl border border-slate-200/80 bg-slate-50/70 hover:border-accord-blue transition-all">
                    <div class="flex items-center justify-between text-xs">
                        <span class="font-bold text-accord-slate">${escapeHTML(nominee)}</span>
                        <span class="text-accord-muted font-semibold">${votesForNom} votes (${pct}%)</span>
                    </div>
                    <div class="w-full bg-slate-200 h-2 rounded-full overflow-hidden">
                        <div class="bg-accord-blue h-full rounded-full transition-all duration-500" style="width: ${pct}%"></div>
                    </div>
                    ${isOpen ? `
                        <button type="button" onclick="castVote('${poll.id}', '${escapeHTML(nominee).replace(/'/g, "\\'")}')" class="mt-2 w-full bg-white hover:bg-accord-blue hover:text-white text-accord-slate border border-slate-200 text-[11px] font-bold py-2 rounded-xl transition-all shadow-sm">
                            Vote for this Nominee
                        </button>
                    ` : ''}
                </div>
            `;
        });

        const card = document.createElement('div');
        card.className = "bg-white border border-slate-200/90 rounded-3xl p-6 sm:p-8 shadow-sm space-y-5 flex flex-col justify-between";
        card.innerHTML = `
            <div class="space-y-4">
                <div class="flex items-center justify-between">
                    <span class="inline-block ${isOpen ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'} text-[10px] font-extrabold uppercase tracking-widest px-3 py-1 rounded-full">
                        ${isOpen ? 'Voting Open' : 'Poll Closed'}
                    </span>
                    <span class="text-xs text-accord-muted font-bold">${totalVotes} Total Votes</span>
                </div>
                <h3 class="serif-heading text-xl font-bold text-accord-slate">${escapeHTML(poll.title)}</h3>
                <div class="space-y-3 pt-1">
                    ${nomineesHtml}
                </div>
            </div>
        `;
        container.appendChild(card);
    });
}

async function castVote(pollId, nomineeName) {
    const poll = musicData.polls.find(p => p.id === pollId);
    if (!poll || poll.status !== 'open') return;

    if (!poll.votes) poll.votes = {};
    poll.votes[nomineeName] = (poll.votes[nomineeName] || 0) + 1;

    await saveMusicDataToSupabase();
    renderPolls();
    showToast(`Successfully voted for ${nomineeName}!`);
}

// ==========================================
// SONG SUBMISSIONS MODAL HANDLERS
// ==========================================

function openSubmissionModal() {
    const modal = document.getElementById('submission-modal');
    modal.classList.remove('hidden');
    modal.classList.add('flex');
}

function closeSubmissionModal() {
    const modal = document.getElementById('submission-modal');
    modal.classList.remove('flex');
    modal.classList.add('hidden');
    document.getElementById('submission-form').reset();
}

async function handleSongSubmission(e) {
    e.preventDefault();
    const artist = document.getElementById('sub-artist').value.trim();
    const title = document.getElementById('sub-title').value.trim();
    const email = document.getElementById('sub-email').value.trim();
    const genre = document.getElementById('sub-genre').value.trim() || 'Gospel';
    const link = document.getElementById('sub-link').value.trim();
    const bio = document.getElementById('sub-bio').value.trim();

    const submission = {
        id: 'sub-' + Date.now(),
        artist,
        title,
        email,
        genre,
        link,
        bio,
        date: new Date().toISOString()
    };

    if (!musicData.submissions) musicData.submissions = [];
    musicData.submissions.push(submission);

    await saveMusicDataToSupabase();
    closeSubmissionModal();
    showToast('Song submitted successfully! SoundSpace PR team will review your track.');
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