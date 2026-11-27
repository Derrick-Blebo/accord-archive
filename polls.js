const SUPABASE_URL = 'https://mzblgajftvyyosyrawcx.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im16YmxnYWpmdHZ5eW9zeXJhd2N4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTQ0NzYxNTQsImV4cCI6MjExMDA1MjE1NH0.Xs9MeioNfqb5DzxDYP-9ZqfywBeOlUreAY-yKrcBmJM';
window.supabaseClient = window.supabaseClient || window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const supabaseClient = window.supabaseClient;
const MUSIC_CONFIG_RECORD_NAME = '__ACCORD_MUSIC_CONFIG__';

let allPolls = [];
let activeFilter = 'all';

function escapeHTML(str) {
    return String(str || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

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

async function fetchPollsData() {
    try {
        const { data, error } = await supabaseClient
            .from('books')
            .select('description')
            .eq('title', MUSIC_CONFIG_RECORD_NAME)
            .maybeSingle();

        if (!error && data?.description) {
            const parsed = JSON.parse(data.description);
            if (Array.isArray(parsed?.polls)) {
                allPolls = parsed.polls;
                localStorage.setItem('accord_music_config', JSON.stringify(parsed));
                return;
            }
        }
    } catch (e) {
        console.warn('Could not load polls from Supabase:', e);
    }

    const localSaved = localStorage.getItem('accord_music_config');
    if (localSaved) {
        try {
            const parsed = JSON.parse(localSaved);
            if (Array.isArray(parsed?.polls)) {
                allPolls = parsed.polls;
                return;
            }
        } catch (e) {}
    }

    allPolls = [];
}

function updateStats() {
    const totalEl = document.getElementById('stat-total-polls');
    const closedEl = document.getElementById('stat-closed-polls');
    const votesEl = document.getElementById('stat-total-votes');

    const closedCount = allPolls.filter(p => p.status === 'closed').length;
    const totalVotes = allPolls.reduce((sum, poll) => {
        const pollVotes = Object.values(poll.votes || {}).reduce((a, b) => a + b, 0);
        return sum + pollVotes;
    }, 0);

    if (totalEl) totalEl.innerText = allPolls.length;
    if (closedEl) closedEl.innerText = closedCount;
    if (votesEl) votesEl.innerText = totalVotes.toLocaleString();
}

function setPollsFilter(filter) {
    activeFilter = filter;
    document.querySelectorAll('.poll-filter-btn').forEach(btn => {
        const isActive = btn.dataset.filter === filter;
        btn.className = isActive
            ? 'poll-filter-btn px-3.5 py-1.5 rounded-full text-xs font-bold bg-accord-slate text-white transition-all'
            : 'poll-filter-btn px-3.5 py-1.5 rounded-full text-xs font-bold bg-white text-accord-muted border border-slate-200 hover:border-accord-slate hover:text-accord-slate transition-all';
    });
    renderAllPolls();
}

function renderAllPolls() {
    const grid = document.getElementById('all-polls-grid');
    if (!grid) return;

    const filtered = activeFilter === 'all'
        ? allPolls
        : allPolls.filter(p => p.status === activeFilter);

    if (filtered.length === 0) {
        grid.innerHTML = `
            <div class="col-span-full bg-white border border-slate-200 rounded-2xl p-10 text-center space-y-2">
                <i class="fa-solid fa-square-poll-vertical text-2xl text-slate-300"></i>
                <p class="text-sm font-bold text-accord-slate">No polls found in this category</p>
                <p class="text-xs text-accord-muted">Check back soon or switch filters to view other polls.</p>
            </div>
        `;
        return;
    }

    grid.innerHTML = '';

    filtered.forEach(poll => {
        const isClosed = poll.status === 'closed';
        const isOpen = poll.status === 'open';
        const isNominating = poll.status === 'nominating';

        const nominees = (poll.nominees || []).map(normalizeNominee).filter(n => n.name);
        const totalVotes = Object.values(poll.votes || {}).reduce((a, b) => a + b, 0);

        const ranked = nominees
            .map(n => ({ name: n.name, count: (poll.votes || {})[n.name] || 0 }))
            .sort((a, b) => b.count - a.count);

        const topCount = ranked[0]?.count || 0;
        const leaders = ranked.filter(r => r.count === topCount);
        const hasWinner = topCount > 0 && leaders.length > 0;
        const winnerNames = hasWinner ? leaders.map(l => l.name).join(' & ') : (nominees.length ? 'No votes yet' : 'Awaiting nominees');
        const winnerPct = totalVotes > 0 ? Math.round((topCount / totalVotes) * 100) : 0;

        const statusBadge = isClosed
            ? `<span class="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-extrabold uppercase tracking-wider bg-amber-100 text-amber-800"><i class="fa-solid fa-trophy text-accord-gold"></i> Winner</span>`
            : isOpen
                ? `<span class="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-extrabold uppercase tracking-wider bg-emerald-50 text-emerald-700"><i class="fa-solid fa-chart-line"></i> Open</span>`
                : `<span class="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-extrabold uppercase tracking-wider bg-blue-50 text-accord-blue">Upcoming</span>`;

        const winnerBoxClass = isClosed
            ? 'bg-accord-goldLight/80 border-amber-200'
            : isOpen
                ? 'bg-emerald-50/60 border-emerald-200/80'
                : 'bg-slate-50 border-slate-200/80';

        const winnerLabel = isClosed
            ? (leaders.length > 1 && hasWinner ? 'Co-Winners' : 'Official Winner')
            : isOpen
                ? 'Current Leader'
                : 'Nominations Open';

        const rankedHtml = ranked.length > 0
            ? ranked.map((item, idx) => {
                const pct = totalVotes > 0 ? Math.round((item.count / totalVotes) * 100) : 0;
                const isTop = hasWinner && item.count === topCount;
                return `
                    <div class="space-y-1">
                        <div class="flex items-center justify-between gap-2 text-xs">
                            <span class="truncate ${isTop ? 'font-bold text-accord-slate' : 'font-medium text-slate-600'}">
                                ${idx + 1}. ${escapeHTML(item.name)}
                            </span>
                            <span class="text-[11px] font-bold tabular-nums shrink-0 ${isTop ? 'text-accord-blue' : 'text-accord-muted'}">
                                ${item.count} (${pct}%)
                            </span>
                        </div>
                        <div class="w-full bg-slate-100 h-1.5 rounded-full overflow-hidden">
                            <div class="${isTop && isClosed ? 'bg-accord-gold' : 'bg-accord-blue'} h-full rounded-full" style="width: ${pct}%"></div>
                        </div>
                    </div>
                `;
            }).join('')
            : `<p class="text-xs text-accord-muted italic">Nominees have not been finalized yet.</p>`;

        const card = document.createElement('div');
        card.className = 'bg-white border border-slate-200/90 rounded-2xl p-5 shadow-sm flex flex-col justify-between space-y-4';
        card.innerHTML = `
            <div class="space-y-3">
                <div class="flex items-center justify-between gap-2">
                    ${statusBadge}
                    <span class="text-[11px] font-semibold text-accord-muted">${totalVotes} total votes</span>
                </div>
                <h2 class="serif-heading text-lg font-bold text-accord-slate leading-snug">${escapeHTML(poll.title)}</h2>

                <div class="rounded-xl border p-3 ${winnerBoxClass}">
                    <p class="text-[10px] font-extrabold uppercase tracking-wider text-accord-muted">${winnerLabel}</p>
                    <div class="flex items-center justify-between gap-2 mt-0.5">
                        <p class="text-sm font-extrabold text-accord-slate truncate">${escapeHTML(winnerNames)}</p>
                        ${hasWinner ? `<span class="text-xs font-extrabold text-accord-blue shrink-0">${winnerPct}%</span>` : ''}
                    </div>
                </div>

                <div class="space-y-2 pt-1">
                    ${rankedHtml}
                </div>
            </div>

            <div class="pt-3 border-t border-slate-100 flex items-center justify-between text-[11px]">
                <span class="text-accord-muted">${poll.endDate ? `Ends ${escapeHTML(poll.endDate)}` : (isNominating ? 'Accepting nominations' : 'Accord Music Awards')}</span>
                ${isOpen || isNominating ? `<a href="music.html#polls" class="font-bold text-accord-blue hover:underline">${isOpen ? 'Vote Now →' : 'Nominate →'}</a>` : '<span class="font-bold text-amber-700">Final Results</span>'}
            </div>
        `;
        grid.appendChild(card);
    });
}

window.onload = async function () {
    await fetchPollsData();
    updateStats();
    renderAllPolls();
};
