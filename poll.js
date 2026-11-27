const SUPABASE_URL = 'https://mzblgajftvyyosyrawcx.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im16YmxnYWpmdHZ5eW9zeXJhd2N4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTQ0NzYxNTQsImV4cCI6MjExMDA1MjE1NH0.Xs9MeioNfqb5DzxDYP-9ZqfywBeOlUreAY-yKrcBmJM';
window.supabaseClient = window.supabaseClient || window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const supabaseClient = window.supabaseClient;
const MUSIC_CONFIG_RECORD_NAME = '__ACCORD_MUSIC_CONFIG__';

let currentUser = null;
let musicData = { artistes: [], playlists: [], songSpotlights: [], polls: [], submissions: [], spotlightSubmissions: [], pollNominations: [] };
let activePollId = '';
let activePoll = null;

function escapeHTML(str) {
    return String(str || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function showToast(message, isError = false) {
    const toast = document.getElementById('toast');
    const msgEl = document.getElementById('toast-message');
    const iconEl = document.getElementById('toast-icon');
    if (!toast || !msgEl) return;

    msgEl.textContent = message;
    if (iconEl) {
        iconEl.className = isError
            ? 'fa-solid fa-circle-exclamation text-red-400 text-base'
            : 'fa-solid fa-circle-check text-accord-gold text-base';
    }
    toast.classList.remove('translate-y-24', 'opacity-0');
    setTimeout(() => toast.classList.add('translate-y-24', 'opacity-0'), 3200);
}
window.showToast = showToast;

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

function findMatchingArtistPage(nomineeName, explicitArtistLink = '') {
    if (explicitArtistLink) return explicitArtistLink;
    const lower = String(nomineeName || '').toLowerCase();
    const matched = (musicData.artistes || []).find(a => a.approved !== false && !a.hidden && a.title && lower.includes(a.title.toLowerCase()));
    return matched ? `artist.html?id=${encodeURIComponent(matched.id)}` : '';
}

function getLocalUserVotes() {
    if (!currentUser?.id) return {};
    try {
        return JSON.parse(localStorage.getItem(`accord_poll_votes_${currentUser.id}`) || '{}');
    } catch {
        return {};
    }
}

function saveLocalUserVote(pollId, nomineeName) {
    if (!currentUser?.id) return;
    const current = getLocalUserVotes();
    current[pollId] = nomineeName;
    localStorage.setItem(`accord_poll_votes_${currentUser.id}`, JSON.stringify(current));
}

function getUserVoteForPoll(poll) {
    if (!currentUser?.id) return null;
    if (poll?.voters && poll.voters[currentUser.id]) {
        return poll.voters[currentUser.id];
    }
    const localVotes = getLocalUserVotes();
    return localVotes[poll.id] || null;
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
            musicData = {
                artistes: Array.isArray(parsed?.artistes) ? parsed.artistes : [],
                playlists: Array.isArray(parsed?.playlists) ? parsed.playlists : [],
                songSpotlights: Array.isArray(parsed?.songSpotlights) ? parsed.songSpotlights : [],
                polls: Array.isArray(parsed?.polls) ? parsed.polls : [],
                submissions: Array.isArray(parsed?.submissions) ? parsed.submissions : [],
                spotlightSubmissions: Array.isArray(parsed?.spotlightSubmissions) ? parsed.spotlightSubmissions : [],
                pollNominations: Array.isArray(parsed?.pollNominations) ? parsed.pollNominations : []
            };
            localStorage.setItem('accord_music_config', JSON.stringify(musicData));
            return;
        }
    } catch (e) {
        console.warn('Could not load poll from Supabase:', e);
    }

    const localSaved = localStorage.getItem('accord_music_config');
    if (localSaved) {
        try {
            const parsed = JSON.parse(localSaved);
            musicData = {
                artistes: Array.isArray(parsed?.artistes) ? parsed.artistes : [],
                playlists: Array.isArray(parsed?.playlists) ? parsed.playlists : [],
                songSpotlights: Array.isArray(parsed?.songSpotlights) ? parsed.songSpotlights : [],
                polls: Array.isArray(parsed?.polls) ? parsed.polls : [],
                submissions: Array.isArray(parsed?.submissions) ? parsed.submissions : [],
                spotlightSubmissions: Array.isArray(parsed?.spotlightSubmissions) ? parsed.spotlightSubmissions : [],
                pollNominations: Array.isArray(parsed?.pollNominations) ? parsed.pollNominations : []
            };
        } catch (e) {}
    }
}

async function saveMusicConfig() {
    localStorage.setItem('accord_music_config', JSON.stringify(musicData));
    try {
        const { data: existing } = await supabaseClient
            .from('books')
            .select('id')
            .eq('title', MUSIC_CONFIG_RECORD_NAME)
            .maybeSingle();

        if (existing?.id) {
            await supabaseClient
                .from('books')
                .update({ description: JSON.stringify(musicData) })
                .eq('id', existing.id);
        }
    } catch (e) {
        console.warn('Could not persist poll vote:', e);
    }
}

function getEmbedInfo(url) {
    if (!url) return null;
    const str = url.trim();
    if (str.includes('youtube.com') || str.includes('youtu.be')) {
        let videoId = '';
        if (str.includes('youtu.be/')) videoId = str.split('youtu.be/')[1]?.split(/[?&#]/)[0];
        else if (str.includes('v=')) videoId = str.split('v=')[1]?.split(/[?&#]/)[0];
        else if (str.includes('embed/')) videoId = str.split('embed/')[1]?.split(/[?&#]/)[0];
        if (videoId) {
            return { type: 'youtube', embedUrl: `https://www.youtube.com/embed/${videoId}?autoplay=1` };
        }
    }
    if (str.includes('open.spotify.com')) {
        const embedUrl = str.includes('/embed/') ? str : str.replace('open.spotify.com/', 'open.spotify.com/embed/');
        return { type: 'spotify', embedUrl };
    }
    if (str.includes('music.apple.com')) {
        return { type: 'apple', embedUrl: str.replace('music.apple.com', 'embed.music.apple.com') };
    }
    if (str.includes('audiomack.com')) {
        const embedUrl = str.includes('/embed/') ? str : str.replace('audiomack.com/', 'audiomack.com/embed/');
        return { type: 'audiomack', embedUrl };
    }
    return { type: 'external', embedUrl: str };
}

function openMediaPlayerModal(title, subtitle, url) {
    const modal = document.getElementById('playlist-player-modal');
    const titleEl = document.getElementById('player-modal-title');
    const subEl = document.getElementById('player-modal-subtitle');
    const extEl = document.getElementById('player-modal-external');
    const bodyEl = document.getElementById('player-modal-body');
    if (!modal || !bodyEl) return;

    titleEl.innerText = title || 'Song Preview';
    subEl.innerText = subtitle || 'Accord Music Hub';
    extEl.href = url || '#';

    const info = getEmbedInfo(url);
    if (!info || info.type === 'external') {
        bodyEl.innerHTML = `
            <div class="bg-white rounded-2xl p-8 text-center space-y-4">
                <i class="fa-solid fa-headphones text-3xl text-accord-blue"></i>
                <p class="text-sm font-bold text-accord-slate">Open this track directly on the streaming platform.</p>
                <a href="${escapeHTML(url)}" target="_blank" rel="noopener noreferrer" class="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-accord-blue hover:bg-accord-darkBlue text-white text-xs font-bold">
                    <span>Listen Now</span>
                    <i class="fa-solid fa-arrow-up-right-from-square"></i>
                </a>
            </div>
        `;
    } else {
        const heightClass = info.type === 'youtube' ? 'h-80 sm:h-96' : 'h-[360px]';
        bodyEl.innerHTML = `
            <iframe src="${escapeHTML(info.embedUrl)}" class="w-full ${heightClass} rounded-2xl border-0 bg-white" allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture" loading="lazy"></iframe>
        `;
    }

    modal.classList.remove('hidden');
    modal.classList.add('flex');
}
window.openMediaPlayerModal = openMediaPlayerModal;

function closePlaylistPlayerModal() {
    const modal = document.getElementById('playlist-player-modal');
    const bodyEl = document.getElementById('player-modal-body');
    if (bodyEl) bodyEl.innerHTML = '';
    modal?.classList.add('hidden');
    modal?.classList.remove('flex');
}
window.closePlaylistPlayerModal = closePlaylistPlayerModal;

function shareCurrentPoll() {
    if (!activePoll || !window.AccordPolls) return;
    window.AccordPolls.openShareModal(activePoll);
}
window.shareCurrentPoll = shareCurrentPoll;

function renderPollDetail() {
    const root = document.getElementById('poll-detail-root');
    const topShareBtn = document.getElementById('top-share-poll-btn');
    if (!root) return;

    if (!activePoll) {
        if (topShareBtn) topShareBtn.classList.add('hidden');
        root.innerHTML = `
            <div class="bg-white border border-slate-200 rounded-3xl p-10 text-center space-y-4 shadow-sm">
                <div class="w-14 h-14 rounded-2xl bg-slate-100 text-slate-400 flex items-center justify-center mx-auto">
                    <i class="fa-solid fa-square-poll-vertical text-2xl"></i>
                </div>
                <div class="space-y-1">
                    <h1 class="serif-heading text-xl font-bold text-accord-slate">Poll Not Found</h1>
                    <p class="text-xs text-accord-muted">This award poll may have been removed or the link is invalid.</p>
                </div>
                <div class="flex flex-wrap items-center justify-center gap-3 pt-1">
                    <a href="polls.html" class="px-5 py-2.5 rounded-xl bg-accord-blue hover:bg-accord-darkBlue text-white text-xs font-bold transition-all">Browse All Polls</a>
                    <a href="music.html#polls" class="px-5 py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-accord-slate text-xs font-bold transition-all">Go to Music Hub</a>
                </div>
            </div>
        `;
        return;
    }

    if (topShareBtn) topShareBtn.classList.remove('hidden');
    document.title = `${activePoll.title} — Accord Music Awards`;

    const isClosed = activePoll.status === 'closed';
    const isOpen = activePoll.status === 'open';
    const isNominating = activePoll.status === 'nominating';

    const nominees = (activePoll.nominees || []).map(normalizeNominee).filter(n => n.name);
    const totalVotes = Object.values(activePoll.votes || {}).reduce((a, b) => a + (Number(b) || 0), 0);

    const ranked = nominees
        .map(n => ({
            ...n,
            count: Number((activePoll.votes || {})[n.name] || 0)
        }))
        .sort((a, b) => b.count - a.count);

    const topCount = ranked[0]?.count || 0;
    const leaders = ranked.filter(r => r.count === topCount);
    const hasWinner = topCount > 0 && leaders.length > 0;
    const leaderNames = hasWinner ? leaders.map(l => l.name).join(' & ') : (nominees.length ? 'No votes cast yet' : 'Awaiting nominees');
    const leaderPct = totalVotes > 0 ? Math.round((topCount / totalVotes) * 100) : 0;

    const runnerUp = ranked.find(r => r.count < topCount) || null;
    const leadMargin = hasWinner && runnerUp ? topCount - runnerUp.count : 0;

    let marginText = '';
    if (hasWinner) {
        if (leaders.length > 1) {
            marginText = `Tied at the top (${topCount} votes each)`;
        } else if (runnerUp) {
            marginText = `${isClosed ? 'Won' : 'Leading'} ${runnerUp.name} by ${leadMargin} ${leadMargin === 1 ? 'vote' : 'votes'}`;
        } else {
            marginText = `${topCount} ${topCount === 1 ? 'vote' : 'votes'} (${leaderPct}%)`;
        }
    }

    const userVotedNominee = getUserVoteForPoll(activePoll);
    const hasVoted = Boolean(userVotedNominee);
    const nextParam = encodeURIComponent(`poll.html?id=${activePoll.id}`);

    const statusBadge = isClosed
        ? `<span class="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-extrabold uppercase tracking-wider bg-accord-gold text-accord-slate"><i class="fa-solid fa-trophy"></i> Official Winner</span>`
        : isOpen
            ? `<span class="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-extrabold uppercase tracking-wider bg-emerald-400/20 text-emerald-200 border border-emerald-300/30"><i class="fa-solid fa-circle text-[7px] animate-pulse"></i> Live Voting Open</span>`
            : `<span class="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-extrabold uppercase tracking-wider bg-white/15 text-blue-100 border border-white/20">Upcoming Nominations</span>`;

    const headToHeadHtml = ranked.length >= 2 && hasWinner ? `
        <div class="bg-white/10 backdrop-blur-sm border border-white/15 rounded-2xl p-4 space-y-2.5">
            <p class="text-[10px] font-extrabold uppercase tracking-wider text-blue-100/90">Head-to-Head Top Contenders</p>
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div class="rounded-xl bg-white/15 border border-accord-gold/50 px-3.5 py-2.5 flex items-center justify-between gap-2">
                    <div class="flex items-center gap-2 min-w-0">
                        <i class="fa-solid fa-trophy text-accord-gold text-sm shrink-0"></i>
                        <div class="min-w-0">
                            <p class="text-[10px] font-bold text-accord-gold uppercase">#1 ${isClosed ? 'Winner' : 'Leading'}</p>
                            <p class="text-sm font-extrabold text-white truncate">${escapeHTML(ranked[0].name)}</p>
                        </div>
                    </div>
                    <span class="text-xs font-extrabold text-white shrink-0">${ranked[0].count} (${totalVotes > 0 ? Math.round((ranked[0].count / totalVotes) * 100) : 0}%)</span>
                </div>
                <div class="rounded-xl bg-white/10 border border-white/15 px-3.5 py-2.5 flex items-center justify-between gap-2">
                    <div class="min-w-0">
                        <p class="text-[10px] font-bold text-blue-200 uppercase">#2 Challenger</p>
                        <p class="text-sm font-bold text-white truncate">${escapeHTML(ranked[1].name)}</p>
                    </div>
                    <span class="text-xs font-bold text-blue-100 shrink-0">${ranked[1].count} (${totalVotes > 0 ? Math.round((ranked[1].count / totalVotes) * 100) : 0}%)</span>
                </div>
            </div>
        </div>
    ` : '';

    const standingsHtml = ranked.length > 0
        ? ranked.map((nom, idx) => {
            const pct = totalVotes > 0 ? Math.round((nom.count / totalVotes) * 100) : 0;
            const isLeader = hasWinner && nom.count === topCount;
            const isUserChoice = userVotedNominee === nom.name;
            const behindCount = hasWinner && !isLeader ? topCount - nom.count : 0;
            const artistPageUrl = findMatchingArtistPage(nom.name, nom.artistLink);

            let actionHtml = '';
            if (isOpen) {
                if (!currentUser) {
                    actionHtml = `
                        <a href="signin.html?next=${nextParam}" class="px-4 py-2 rounded-xl bg-accord-blue hover:bg-accord-darkBlue text-white text-xs font-bold transition-all inline-flex items-center gap-1.5 shrink-0">
                            <i class="fa-solid fa-right-to-bracket text-[11px]"></i>
                            <span>Sign in to Vote</span>
                        </a>
                    `;
                } else if (hasVoted) {
                    actionHtml = isUserChoice
                        ? `<span class="px-3.5 py-2 rounded-xl bg-accord-blue text-white text-xs font-bold inline-flex items-center gap-1.5 shrink-0"><i class="fa-solid fa-check"></i> Your Vote</span>`
                        : '';
                } else {
                    actionHtml = `
                        <button type="button" onclick="castDedicatedVote('${escapeHTML(nom.name).replace(/'/g, "\\'")}')" class="px-4 py-2 rounded-xl bg-accord-blue hover:bg-accord-darkBlue text-white text-xs font-bold shadow-sm transition-all shrink-0">
                            Vote
                        </button>
                    `;
                }
            }

            return `
                <div class="rounded-2xl border p-4 sm:p-5 transition-all space-y-3 ${isLeader ? 'bg-accord-goldLight/60 border-amber-300 shadow-sm' : isUserChoice ? 'bg-accord-lightBlue/40 border-accord-blue' : 'bg-white border-slate-200'}">
                    <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                        <div class="flex items-center gap-3 min-w-0">
                            <div class="w-9 h-9 rounded-xl flex items-center justify-center shrink-0 font-extrabold text-xs ${isLeader ? 'bg-accord-gold text-accord-slate shadow-sm' : 'bg-slate-100 text-accord-muted'}">
                                ${isLeader ? '<i class="fa-solid fa-trophy text-sm"></i>' : `#${idx + 1}`}
                            </div>
                            <div class="min-w-0">
                                <div class="flex items-center gap-2 flex-wrap">
                                    <h3 class="text-sm sm:text-base font-extrabold text-accord-slate truncate">${escapeHTML(nom.name)}</h3>
                                    ${isLeader ? `<span class="px-2 py-0.5 rounded-full text-[10px] font-extrabold uppercase tracking-wider bg-amber-100 text-amber-800">${isClosed ? 'Winner' : 'Winning'}</span>` : ''}
                                </div>
                                <p class="text-[11px] font-semibold text-accord-muted mt-0.5">
                                    ${nom.count.toLocaleString()} ${nom.count === 1 ? 'vote' : 'votes'} · ${pct}%
                                    ${behindCount > 0 ? `<span class="text-slate-400">· ${behindCount} behind #1</span>` : ''}
                                </p>
                            </div>
                        </div>

                        <div class="flex items-center gap-2 shrink-0 flex-wrap">
                            ${nom.songLink ? `
                                <button type="button" onclick="openMediaPlayerModal('${escapeHTML(nom.name).replace(/'/g, "\\'")}', '${escapeHTML(activePoll.title).replace(/'/g, "\\'")}', '${escapeHTML(nom.songLink).replace(/'/g, "\\'")}')" class="px-3 py-2 rounded-xl bg-white border border-slate-200 hover:border-accord-blue text-accord-slate hover:text-accord-blue text-xs font-bold inline-flex items-center gap-1.5 transition-colors">
                                    <i class="fa-solid fa-play text-[10px]"></i>
                                    <span>Listen</span>
                                </button>
                            ` : ''}
                            ${artistPageUrl ? `
                                <a href="${escapeHTML(artistPageUrl)}" ${artistPageUrl.startsWith('http') ? 'target="_blank" rel="noopener noreferrer"' : ''} class="px-3 py-2 rounded-xl bg-white border border-slate-200 hover:border-accord-blue text-accord-slate hover:text-accord-blue text-xs font-bold inline-flex items-center gap-1.5 transition-colors">
                                    <i class="fa-solid fa-user text-[10px]"></i>
                                    <span>Artiste</span>
                                </a>
                            ` : ''}
                            ${actionHtml}
                        </div>
                    </div>

                    <div class="w-full bg-slate-200/80 h-2.5 rounded-full overflow-hidden">
                        <div class="${isLeader ? 'bg-accord-gold' : 'bg-accord-blue'} h-full rounded-full transition-all duration-500" style="width: ${pct}%"></div>
                    </div>
                </div>
            `;
        }).join('')
        : `
            <div class="bg-white border border-slate-200 rounded-2xl p-8 text-center space-y-2">
                <p class="text-sm font-bold text-accord-slate">Nominees are not finalized yet</p>
                <p class="text-xs text-accord-muted">Visit Music Hub to submit a nomination for this category.</p>
                <a href="music.html#polls" class="inline-block mt-2 px-4 py-2 rounded-xl bg-accord-blue text-white text-xs font-bold">Go to Nominations →</a>
            </div>
        `;

    root.innerHTML = `
        <!-- Hero Leader Card -->
        <section class="rounded-3xl bg-gradient-to-br from-accord-blue via-accord-darkBlue to-accord-slate text-white p-6 sm:p-8 shadow-lg space-y-5">
            <div class="flex flex-wrap items-center justify-between gap-3">
                ${statusBadge}
                <div class="flex items-center gap-3 text-xs font-bold text-blue-100">
                    <span>${totalVotes.toLocaleString()} total votes</span>
                    ${activePoll.endDate ? `<span>• Ends ${escapeHTML(activePoll.endDate)}</span>` : ''}
                </div>
            </div>

            <div class="space-y-2">
                <p class="text-xs font-bold uppercase tracking-wider text-blue-200">Accord Music Awards Poll</p>
                <h1 class="serif-heading text-2xl sm:text-3xl font-extrabold leading-tight">${escapeHTML(activePoll.title)}</h1>
            </div>

            <div class="rounded-2xl bg-white/10 border border-white/20 p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div class="flex items-center gap-3.5 min-w-0">
                    <div class="w-12 h-12 rounded-2xl ${hasWinner ? 'bg-accord-gold text-accord-slate' : 'bg-white/15 text-white'} flex items-center justify-center shrink-0 shadow-md">
                        <i class="fa-solid fa-trophy text-xl"></i>
                    </div>
                    <div class="min-w-0">
                        <p class="text-[10px] font-extrabold uppercase tracking-wider text-blue-200">
                            ${isClosed ? (leaders.length > 1 && hasWinner ? 'Co-Winners' : 'Official Winner') : isOpen ? 'Currently Winning' : 'Upcoming Category'}
                        </p>
                        <p class="serif-heading text-lg sm:text-xl font-extrabold text-white truncate">${escapeHTML(leaderNames)}</p>
                        ${marginText ? `<p class="text-xs text-blue-100/90 mt-0.5">${escapeHTML(marginText)}</p>` : ''}
                    </div>
                </div>
                <div class="flex flex-wrap items-center gap-2 shrink-0">
                    <button type="button" onclick="shareCurrentPoll()" class="px-4 py-2.5 rounded-xl bg-accord-gold hover:bg-amber-400 text-accord-slate text-xs font-extrabold shadow-sm transition-all inline-flex items-center gap-1.5">
                        <i class="fa-solid fa-share-nodes"></i>
                        <span>Share to Vote</span>
                    </button>
                </div>
            </div>

            ${headToHeadHtml}
        </section>

        <!-- Auth Notice -->
        ${isOpen && !currentUser ? `
            <div class="bg-accord-lightBlue/80 border border-blue-200 rounded-2xl px-5 py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div class="flex items-center gap-2.5 text-xs text-accord-slate">
                    <i class="fa-solid fa-circle-info text-accord-blue text-base"></i>
                    <span><strong>Sign in to cast your vote:</strong> Registered Accord members get one vote per category.</span>
                </div>
                <a href="signin.html?next=${nextParam}" class="px-4 py-2 rounded-xl bg-accord-blue hover:bg-accord-darkBlue text-white text-xs font-bold text-center shrink-0">Sign In to Vote</a>
            </div>
        ` : ''}

        <!-- Standings & Voting List -->
        <section class="space-y-3">
            <div class="flex items-center justify-between gap-2">
                <h2 class="serif-heading text-lg font-bold text-accord-slate">Full Standings &amp; Voting</h2>
                <span class="text-xs font-semibold text-accord-muted">${ranked.length} ${ranked.length === 1 ? 'nominee' : 'nominees'}</span>
            </div>
            <div class="space-y-3">
                ${standingsHtml}
            </div>
        </section>
    `;
}

function renderOtherPolls() {
    const section = document.getElementById('other-polls-section');
    const grid = document.getElementById('other-polls-grid');
    if (!section || !grid) return;

    const others = (musicData.polls || [])
        .filter(p => !p.hidden && String(p.id) !== String(activePollId))
        .slice(0, 4);

    if (others.length === 0) {
        section.classList.add('hidden');
        return;
    }

    section.classList.remove('hidden');
    grid.innerHTML = others.map(poll => {
        const votes = Object.values(poll.votes || {}).reduce((a, b) => a + (Number(b) || 0), 0);
        const statusText = poll.status === 'closed' ? 'Winner Declared' : poll.status === 'open' ? 'Vote Now' : 'Upcoming';
        return `
            <a href="poll.html?id=${encodeURIComponent(poll.id)}" class="bg-white border border-slate-200 hover:border-accord-blue rounded-2xl p-4 shadow-sm transition-all flex items-center justify-between gap-3">
                <div class="min-w-0">
                    <p class="text-[10px] font-extrabold uppercase tracking-wider text-accord-blue">${statusText} · ${votes} votes</p>
                    <h3 class="text-sm font-bold text-accord-slate truncate mt-0.5">${escapeHTML(poll.title)}</h3>
                </div>
                <i class="fa-solid fa-arrow-right text-xs text-accord-muted shrink-0"></i>
            </a>
        `;
    }).join('');
}

async function castDedicatedVote(nomineeName) {
    if (!currentUser?.id) {
        showToast('Please sign in to vote in award polls.');
        setTimeout(() => {
            window.location.href = `signin.html?next=${encodeURIComponent(`poll.html?id=${activePollId}`)}`;
        }, 800);
        return;
    }

    if (!activePoll || activePoll.status !== 'open') return;
    if (getUserVoteForPoll(activePoll)) {
        showToast('You have already voted in this poll.');
        return;
    }

    if (!activePoll.votes) activePoll.votes = {};
    if (!activePoll.voters) activePoll.voters = {};

    activePoll.votes[nomineeName] = (Number(activePoll.votes[nomineeName]) || 0) + 1;
    activePoll.voters[currentUser.id] = nomineeName;
    saveLocalUserVote(activePoll.id, nomineeName);

    await saveMusicConfig();
    if (window.AccordPolls) {
        window.AccordPolls.registerPolls(musicData.polls);
    }
    renderPollDetail();
    showToast(`Vote recorded for ${nomineeName}!`);
}
window.castDedicatedVote = castDedicatedVote;

window.onload = async function () {
    const params = new URLSearchParams(window.location.search);
    activePollId = params.get('id') || '';

    const { data: { session } } = await supabaseClient.auth.getSession();
    currentUser = session?.user || null;

    await fetchMusicConfig();
    const visiblePolls = (musicData.polls || []).filter(p => !p.hidden);
    if (window.AccordPolls) {
        window.AccordPolls.registerPolls(visiblePolls);
    }

    activePoll = activePollId
        ? visiblePolls.find(p => String(p.id) === String(activePollId)) || null
        : (visiblePolls[0] || null);

    if (activePoll && !activePollId) {
        activePollId = activePoll.id;
    }

    renderPollDetail();
    renderOtherPolls();
};
