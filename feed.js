let currentTab = 'all';
let currentUser = null;
let currentProfile = null; // { account_type: 'normal_user' | 'ministry_minister', upgrade_status, full_name }
let allFeedPosts = [];
let allReposts = [];
let followingIds = new Set();
let myRepostedPostIds = new Set();
let likedPostIds = new Set();
let commentCountsByPost = {};
let revokedAuthorIds = new Set();
let viewedPostIds = new Set();
let initialViewedPostIds = new Set(); // Snapshot at load/tab switch so feed doesn't jump mid-scroll
let authorHandlesById = {};
let feedViewObserver = null;
let feedSearchQuery = '';
let feedSearchScope = 'all'; // 'all' | 'people' | 'posts'
let feedPeopleResults = [];
let feedSearchTimer = null;
let feedBookPreviewCache = new Map();
let managedVerifiedPages = []; // Verified ministry/minister pages where currentUser is a page admin

function getVoterKey() {
    if (currentUser?.id) return `user_${currentUser.id}`;
    let guestKey = localStorage.getItem('accord_guest_voter_key');
    if (!guestKey) {
        guestKey = 'guest_' + (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}_${Math.random().toString(36).slice(2)}`);
        localStorage.setItem('accord_guest_voter_key', guestKey);
    }
    return guestKey;
}

document.addEventListener('DOMContentLoaded', async () => {
    await initFeedSession();
    await loadFeedPosts();
});

function isMinistryOrMinister(profile = currentProfile) {
    if (!profile) return false;
    if (profile.upgrade_status === 'revoked') return false;
    return profile.account_type === 'ministry_minister' || profile.upgrade_status === 'approved';
}

function syncFeedAccountUI() {
    const verified = isMinistryOrMinister(currentProfile);
    const badge = document.getElementById('feed-profile-verified-badge') || document.getElementById('profile-verified-badge');
    const profileIcon = document.getElementById('feed-profile-icon') || document.getElementById('user-profile-icon');

    if (badge) {
        badge.classList.toggle('hidden', !verified);
    }

    if (currentUser && profileIcon && !profileIcon.querySelector('i, img')) {
        const displayName = currentProfile?.full_name || currentUser.email || 'U';
        profileIcon.textContent = displayName.charAt(0).toUpperCase();
    }
}

async function initFeedSession() {
    const { data: { session } } = await supabaseClient.auth.getSession();
    currentUser = session?.user || null;

    const authLabel = document.getElementById('auth-nav-label');
    const mobileAuthLabel = document.getElementById('mobile-auth-label');

    if (currentUser) {
        if (authLabel) authLabel.textContent = 'Account';
        if (mobileAuthLabel) mobileAuthLabel.textContent = 'Account Settings';

        const { data: profile } = await supabaseClient
            .from('profiles')
            .select('id, full_name, handle, email, account_type, upgrade_status')
            .eq('id', currentUser.id)
            .maybeSingle();

        currentProfile = profile || {
            id: currentUser.id,
            full_name: currentUser.user_metadata?.full_name || currentUser.email.split('@')[0],
            email: currentUser.email,
            account_type: 'normal_user',
            upgrade_status: 'none'
        };

        // Load verified pages where this user is a delegated page admin
        managedVerifiedPages = [];
        try {
            const { data: adminRows } = await supabaseClient
                .from('page_admins')
                .select('page_id, role, profiles!page_admins_page_id_fkey(id, full_name, handle, account_type, upgrade_status)')
                .eq('admin_user_id', currentUser.id);
            managedVerifiedPages = (adminRows || [])
                .map(r => r.profiles)
                .filter(p => p && isMinistryOrMinister(p));
        } catch (err) {
            managedVerifiedPages = [];
        }
    } else {
        currentProfile = null;
        managedVerifiedPages = [];
        if (authLabel) authLabel.textContent = 'Sign In';
        if (mobileAuthLabel) mobileAuthLabel.textContent = 'Sign In / Create Account';
    }

    syncPostAsPageSelector();
    syncFeedAccountUI();
}

function handleAuthNavClick() {
    if (currentUser) {
        window.location.href = 'profile.html';
    } else {
        window.location.href = 'signin.html?next=feed.html';
    }
}

function toggleMobileMenu() {
    document.getElementById('mobile-menu')?.classList.toggle('hidden');
}

function showToast(message, isError = false) {
    const toast = document.getElementById('toast');
    const msgEl = document.getElementById('toast-message');
    const iconEl = document.getElementById('toast-icon');
    if (!toast) return;

    msgEl.textContent = message;
    if (iconEl) {
        iconEl.className = isError
            ? 'fa-solid fa-circle-exclamation text-red-500 text-lg'
            : 'fa-solid fa-circle-check text-accord-gold text-lg';
    }

    toast.classList.remove('translate-y-24', 'opacity-0');
    setTimeout(() => {
        toast.classList.add('translate-y-24', 'opacity-0');
    }, 3500);
}

function setFeedTab(tab) {
    currentTab = tab;
    document.querySelectorAll('.feed-tab-btn').forEach(btn => {
        btn.className = 'feed-tab-btn whitespace-nowrap px-4 py-2 rounded-full text-xs font-bold transition-all bg-white text-accord-slate hover:bg-slate-100 border border-slate-200';
    });

    const activeBtn = document.getElementById(`tab-${tab}`);
    if (activeBtn) {
        activeBtn.className = 'feed-tab-btn whitespace-nowrap px-4 py-2 rounded-full text-xs font-bold transition-all bg-accord-blue text-white shadow-sm';
    }

    renderFeedStream();
}

async function loadFeedPosts() {
    const streamContainer = document.getElementById('feed-stream');
    if (!streamContainer) return;

    streamContainer.innerHTML = `
        <div class="bg-white border border-slate-200/80 rounded-2xl p-12 text-center space-y-3 shadow-sm">
            <i class="fa-solid fa-spinner fa-spin text-2xl text-accord-blue"></i>
            <p class="text-xs text-accord-muted font-medium">Loading fellowship feed...</p>
        </div>
    `;

    const requests = [
        supabaseClient.from('feed_posts').select('*').eq('is_approved', true).order('created_at', { ascending: false }),
        supabaseClient.from('post_likes').select('post_id').eq('voter_key', getVoterKey()),
        supabaseClient.from('post_comments').select('post_id'),
        supabaseClient
            .from('post_reposts')
            .select('id, post_id, user_id, quote_text, created_at, profiles(id, full_name, handle, account_type, upgrade_status)')
            .order('created_at', { ascending: false })
            .limit(120),
        supabaseClient.from('profiles').select('id').eq('upgrade_status', 'revoked')
    ];

    if (currentUser?.id) {
        requests.push(
            supabaseClient.from('account_follows').select('following_id').eq('follower_id', currentUser.id),
            supabaseClient.from('post_views').select('post_id').eq('user_id', currentUser.id)
        );
    }

    const [postsRes, likesRes, commentsRes, repostsRes, revokedRes, followsRes, viewsRes] = await Promise.all(requests);

    if (postsRes.error) {
        streamContainer.innerHTML = `
            <div class="bg-white border border-slate-200 rounded-2xl p-12 text-center space-y-2">
                <p class="text-xs font-bold text-red-600">Could not load feed posts.</p>
                <p class="text-xs text-accord-muted">${escapeHtml(postsRes.error.message)}</p>
            </div>
        `;
        return;
    }

    revokedAuthorIds = new Set((!revokedRes?.error && revokedRes?.data ? revokedRes.data : []).map(r => String(r.id)));
    allFeedPosts = (postsRes.data || [])
        .filter(p => !p.author_id || !revokedAuthorIds.has(String(p.author_id)));

    const authorIds = [...new Set(allFeedPosts.map(p => p.author_id).filter(Boolean))];
    authorHandlesById = {};
    if (authorIds.length > 0) {
        const { data: authorProfiles } = await supabaseClient
            .from('profiles')
            .select('id, handle')
            .in('id', authorIds);
        (authorProfiles || []).forEach(ap => {
            if (ap.handle) authorHandlesById[String(ap.id)] = ap.handle;
        });
    }

    allReposts = (!repostsRes?.error && repostsRes?.data) ? repostsRes.data : [];
    followingIds = new Set((followsRes?.data || []).map(f => String(f.following_id)));
    myRepostedPostIds = new Set(
        currentUser?.id
            ? allReposts.filter(r => r.user_id === currentUser.id).map(r => String(r.post_id))
            : []
    );

    const localViewed = JSON.parse(localStorage.getItem('accord_viewed_post_ids') || '[]').map(String);
    const dbViewed = (!viewsRes?.error && viewsRes?.data ? viewsRes.data : []).map(v => String(v.post_id));
    viewedPostIds = new Set([...localViewed, ...dbViewed]);
    initialViewedPostIds = new Set(viewedPostIds);

    likedPostIds = new Set((likesRes.data || []).map(l => String(l.post_id)));

    commentCountsByPost = {};
    (commentsRes.data || []).forEach(c => {
        const key = String(c.post_id);
        commentCountsByPost[key] = (commentCountsByPost[key] || 0) + 1;
    });

    renderFeedStream();
}

function matchesFeedSearch(post) {
    const q = feedSearchQuery.trim().toLowerCase();
    if (!q) return true;
    const title = (post.title || '').toLowerCase();
    const body = (post.body || '').toLowerCase();
    const author = post.is_anonymous ? 'anonymous' : (post.author_name || '').toLowerCase();
    const type = (post.post_type || '').toLowerCase();
    return title.includes(q) || body.includes(q) || author.includes(q) || type.includes(q);
}

function buildRankedFeedItems() {
    if (feedSearchQuery.trim() && feedSearchScope === 'people') {
        return [];
    }
    const postById = new Map(allFeedPosts.map(p => [String(p.id), p]));
    const items = [];

    allFeedPosts.forEach(post => {
        const matchesTab = currentTab === 'all' || post.post_type === currentTab;
        if (!matchesTab || !matchesFeedSearch(post)) return;
        items.push({
            kind: 'post',
            post,
            actorId: post.is_anonymous ? null : post.author_id,
            timestamp: new Date(post.created_at).getTime()
        });
    });

    allReposts.forEach(rep => {
        const post = postById.get(String(rep.post_id));
        if (!post) return;
        const matchesTab = currentTab === 'all' || post.post_type === currentTab;
        if (!matchesTab || !matchesFeedSearch(post)) return;
        items.push({
            kind: 'repost',
            post,
            repost: rep,
            actorId: rep.user_id,
            timestamp: new Date(rep.created_at).getTime()
        });
    });

    const now = Date.now();
    items.forEach(item => {
        const isViewed = initialViewedPostIds.has(String(item.post.id));
        const unseenBonus = isViewed ? 0 : 100000;
        const isFollowedActor = Boolean(item.actorId && followingIds.has(String(item.actorId)));
        const ageHours = Math.max(0, (now - item.timestamp) / 3600000);
        const engagement =
            (Number(item.post.likes_count) || 0) * 2 +
            (commentCountsByPost[String(item.post.id)] || 0) * 3 +
            (Number(item.post.reposts_count) || 0) * 4;
        const recencyScore = Math.max(0, 500 - ageHours * 1.5);
        item.score = unseenBonus + (isFollowedActor ? 10000 : 0) + recencyScore + Math.min(200, engagement);
    });

    items.sort((a, b) => b.score - a.score || b.timestamp - a.timestamp);
    return items;
}

function markPostAsViewed(postId) {
    const idStr = String(postId || '');
    if (!idStr || viewedPostIds.has(idStr)) return;
    viewedPostIds.add(idStr);

    try {
        const existing = JSON.parse(localStorage.getItem('accord_viewed_post_ids') || '[]').map(String);
        if (!existing.includes(idStr)) {
            const updated = [...existing.slice(-499), idStr];
            localStorage.setItem('accord_viewed_post_ids', JSON.stringify(updated));
        }
    } catch (e) {}

    if (currentUser?.id) {
        supabaseClient
            .from('post_views')
            .upsert({ user_id: currentUser.id, post_id: postId, viewed_at: new Date().toISOString() }, { onConflict: 'user_id,post_id' })
            .then(() => {});
    }
}

function setupFeedViewObserver() {
    if (feedViewObserver) {
        feedViewObserver.disconnect();
    }
    if (typeof IntersectionObserver === 'undefined') return;
    const timers = new Map();
    feedViewObserver = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            const postId = entry.target.getAttribute('data-post-id');
            if (!postId) return;
            if (entry.isIntersecting) {
                if (!timers.has(postId)) {
                    const t = setTimeout(() => {
                        markPostAsViewed(postId);
                        feedViewObserver?.unobserve(entry.target);
                        timers.delete(postId);
                    }, 900);
                    timers.set(postId, t);
                }
            } else if (timers.has(postId)) {
                clearTimeout(timers.get(postId));
                timers.delete(postId);
            }
        });
    }, { threshold: 0.45 });

    document.querySelectorAll('#feed-stream article[data-post-id]').forEach(el => {
        feedViewObserver.observe(el);
    });
}

async function renderFeedStream() {
    const streamContainer = document.getElementById('feed-stream');
    if (!streamContainer) return;

    const isSearching = Boolean(feedSearchQuery.trim());
    const visibleItems = buildRankedFeedItems();
    updateFeedSearchSummary(visibleItems.length);

    if (isSearching && feedSearchScope === 'people') {
        streamContainer.innerHTML = '';
        return;
    }

    if (visibleItems.length === 0) {
        streamContainer.innerHTML = `
            <div class="bg-white border border-slate-200 rounded-3xl p-12 text-center space-y-3">
                <i class="fa-regular fa-folder-open text-3xl text-slate-300"></i>
                <h3 class="font-bold text-accord-slate text-sm">${isSearching ? 'No matching posts found' : 'No posts in this category yet'}</h3>
                <p class="text-xs text-accord-muted">${isSearching ? 'Try another keyword or clear your search.' : 'Select another tab or share a new post above.'}</p>
            </div>
        `;
        return;
    }

    streamContainer.innerHTML = '';
    const sponsoredCards = typeof window.getAccordSponsoredFeedCards === 'function'
        ? await window.getAccordSponsoredFeedCards()
        : [];
    let adIdx = 0;

    visibleItems.forEach((item, idx) => {
        streamContainer.appendChild(renderFeedCard(item.post, item.repost || null));
        if ((idx + 1) % 4 === 0 && adIdx < sponsoredCards.length && typeof window.createAccordSponsoredCardElement === 'function') {
            streamContainer.appendChild(window.createAccordSponsoredCardElement(sponsoredCards[adIdx++]));
        }
    });
    if (adIdx === 0 && sponsoredCards.length > 0 && typeof window.createAccordSponsoredCardElement === 'function') {
        streamContainer.appendChild(window.createAccordSponsoredCardElement(sponsoredCards[0]));
    }
    window.observeAccordAds?.();
    hydrateFeedBookLinkPreviews();
    setupFeedViewObserver();
}

function extractBookIdFromText(text) {
    if (!text) return null;
    const m = String(text).match(/(?:book\.html\?(?:[^#\s]*&)?(?:id|book)=|[?&]book=)(\d+)/i);
    return m ? m[1] : null;
}

async function hydrateFeedBookLinkPreviews() {
    const slots = Array.from(document.querySelectorAll('.feed-book-link-preview[data-book-id]'));
    if (slots.length === 0) return;

    const missingIds = [...new Set(slots.map(s => s.getAttribute('data-book-id')).filter(id => id && !feedBookPreviewCache.has(id)))];
    if (missingIds.length > 0) {
        const { data } = await supabaseClient
            .from('books')
            .select('id, title, author, cover_url')
            .in('id', missingIds)
            .eq('is_visible', true);
        (data || []).forEach(b => feedBookPreviewCache.set(String(b.id), b));
    }

    slots.forEach(slot => {
        const book = feedBookPreviewCache.get(slot.getAttribute('data-book-id'));
        if (!book) return;
        slot.innerHTML = `
            <a href="book.html?id=${encodeURIComponent(book.id)}" class="flex items-center gap-3 p-3 rounded-2xl border border-slate-200 bg-slate-50 hover:bg-accord-lightBlue/40 transition-colors">
                ${book.cover_url
                    ? `<img src="${escapeHtml(book.cover_url)}" alt="${escapeHtml(book.title)}" class="w-12 h-16 object-cover rounded-lg border border-slate-200 shrink-0">`
                    : `<div class="w-12 h-16 rounded-lg bg-accord-blue text-white flex items-center justify-center shrink-0"><i class="fa-solid fa-book"></i></div>`}
                <div class="min-w-0 flex-1">
                    <p class="text-[10px] font-extrabold uppercase tracking-wider text-accord-blue">Accord Library Book</p>
                    <p class="text-xs font-bold text-accord-slate truncate">${escapeHtml(book.title)}</p>
                    <p class="text-[11px] text-accord-muted truncate">By ${escapeHtml(book.author || 'Unknown')}</p>
                </div>
                <i class="fa-solid fa-chevron-right text-slate-400 text-xs shrink-0"></i>
            </a>
        `;
    });
}

function handleFeedSearchInput(val) {
    feedSearchQuery = val || '';
    const hasQuery = Boolean(feedSearchQuery.trim());
    document.getElementById('feed-search-clear')?.classList.toggle('hidden', !hasQuery);
    const scopeBar = document.getElementById('feed-search-scope-bar');
    if (scopeBar) {
        scopeBar.classList.toggle('hidden', !hasQuery);
        scopeBar.classList.toggle('flex', hasQuery);
    }

    if (!hasQuery) {
        feedPeopleResults = [];
        renderPeopleSearchResults();
        renderFeedStream();
        return;
    }

    renderFeedStream();
    clearTimeout(feedSearchTimer);
    feedSearchTimer = setTimeout(() => {
        searchFeedPeople(feedSearchQuery.trim());
    }, 220);
}

function clearFeedSearch() {
    const input = document.getElementById('feed-search-input');
    if (input) input.value = '';
    feedSearchQuery = '';
    feedSearchScope = 'all';
    setFeedSearchScope('all');
    handleFeedSearchInput('');
}

function setFeedSearchScope(scope) {
    feedSearchScope = scope;
    ['all', 'people', 'posts'].forEach(s => {
        const btn = document.getElementById(`search-scope-${s}`);
        if (!btn) return;
        btn.className = s === scope
            ? 'feed-scope-btn px-3 py-1 rounded-full text-[11px] font-bold bg-accord-slate text-white'
            : 'feed-scope-btn px-3 py-1 rounded-full text-[11px] font-bold bg-slate-100 text-accord-slate hover:bg-slate-200';
    });
    renderPeopleSearchResults();
    renderFeedStream();
}

function updateFeedSearchSummary(postsCount) {
    const summaryEl = document.getElementById('feed-search-summary');
    if (!summaryEl) return;
    if (!feedSearchQuery.trim()) {
        summaryEl.textContent = '';
        return;
    }
    const pCount = feedPeopleResults.length;
    summaryEl.textContent = `${pCount} ${pCount === 1 ? 'person' : 'people'} • ${postsCount} ${postsCount === 1 ? 'post' : 'posts'}`;
}

async function searchFeedPeople(query) {
    if (!query) {
        feedPeopleResults = [];
        renderPeopleSearchResults();
        return;
    }
    const safePattern = `%${query.replace(/[%_]/g, '')}%`;
    const { data, error } = await supabaseClient
        .from('profiles')
        .select('id, full_name, handle, bio, account_type, upgrade_status, ministry_role')
        .or(`full_name.ilike.${safePattern},handle.ilike.${safePattern},bio.ilike.${safePattern},ministry_role.ilike.${safePattern}`)
        .neq('upgrade_status', 'revoked')
        .limit(12);

    if (error) {
        console.warn('People search error:', error.message);
        feedPeopleResults = [];
    } else {
        feedPeopleResults = data || [];
    }
    renderPeopleSearchResults();
    updateFeedSearchSummary(buildRankedFeedItems().length);
}

function renderPeopleSearchResults() {
    const container = document.getElementById('feed-people-results');
    if (!container) return;

    const hasQuery = Boolean(feedSearchQuery.trim());
    if (!hasQuery || feedSearchScope === 'posts') {
        container.classList.add('hidden');
        container.innerHTML = '';
        return;
    }

    container.classList.remove('hidden');
    if (feedPeopleResults.length === 0) {
        if (feedSearchScope === 'people') {
            container.innerHTML = `
                <div class="bg-white border border-slate-200/80 rounded-2xl p-8 text-center space-y-2 shadow-sm">
                    <i class="fa-regular fa-user text-2xl text-slate-300"></i>
                    <p class="text-xs font-bold text-accord-slate">No matching people or ministries found</p>
                    <p class="text-[11px] text-accord-muted">Try searching by name, ministry role, or bio keywords.</p>
                </div>
            `;
        } else {
            container.innerHTML = '';
            container.classList.add('hidden');
        }
        return;
    }

    const cardsHtml = feedPeopleResults.map(person => {
        const name = person.full_name || 'Accord Member';
        const verified = isMinistryOrMinister(person);
        const profileHref = `user.html?id=${encodeURIComponent(person.id)}`;
        const roleLabel = person.ministry_role || (verified ? 'Verified Ministry / Minister' : 'Community Member');
        const isFollowing = followingIds.has(String(person.id));
        const isSelf = currentUser?.id && String(currentUser.id) === String(person.id);

        return `
            <div class="flex items-center justify-between gap-3 p-3 rounded-xl border border-slate-100 hover:border-slate-200 hover:bg-slate-50/70 transition-all">
                <a href="${profileHref}" class="flex items-center gap-3 min-w-0 flex-1">
                    <div class="relative w-10 h-10 rounded-full bg-accord-lightBlue text-accord-blue font-bold text-sm flex items-center justify-center shrink-0">
                        <span>${escapeHtml(name.charAt(0).toUpperCase())}</span>
                        ${verified ? `<span title="Verified Ministry / Minister" class="absolute -bottom-0.5 -right-0.5 w-4 h-4 rounded-full bg-accord-blue text-white flex items-center justify-center ring-2 ring-white"><i class="fa-solid fa-check text-[8px]"></i></span>` : ''}
                    </div>
                    <div class="min-w-0">
                        <div class="flex items-center gap-1.5 flex-wrap">
                            <p class="text-xs sm:text-sm font-bold text-accord-slate truncate">${escapeHtml(name)}</p>
                            ${person.handle ? `<span class="text-[11px] font-semibold text-accord-blue truncate">${escapeHtml(person.handle)}</span>` : ''}
                            ${verified ? `<span class="text-[10px] font-bold text-accord-blue bg-accord-lightBlue px-2 py-0.5 rounded-full shrink-0">Verified</span>` : ''}
                        </div>
                        <p class="text-[11px] text-accord-muted truncate">${escapeHtml(person.bio || roleLabel)}</p>
                    </div>
                </a>
                ${isSelf ? '' : `
                    <button type="button" onclick="toggleFeedPersonFollow('${person.id}', this)" class="px-3 py-1.5 rounded-full text-[11px] font-bold shrink-0 transition-all ${isFollowing ? 'bg-slate-100 text-accord-slate hover:bg-slate-200' : 'bg-accord-blue text-white hover:bg-accord-darkBlue'}">
                        ${isFollowing ? 'Following' : 'Follow'}
                    </button>
                `}
            </div>
        `;
    }).join('');

    container.innerHTML = `
        <div class="bg-white border border-slate-200/80 rounded-xl sm:rounded-2xl p-3.5 sm:p-4 shadow-sm space-y-2.5">
            <div class="flex items-center justify-between">
                <h3 class="text-xs font-extrabold uppercase tracking-wider text-accord-muted flex items-center gap-1.5">
                    <i class="fa-solid fa-users text-accord-blue"></i>
                    <span>People & Ministries (${feedPeopleResults.length})</span>
                </h3>
            </div>
            <div class="space-y-2">${cardsHtml}</div>
        </div>
    `;
}

async function toggleFeedPersonFollow(targetUserId, btnEl) {
    if (!currentUser) {
        showToast('Please sign in to follow accounts.', true);
        return;
    }
    const idStr = String(targetUserId);
    const isFollowing = followingIds.has(idStr);
    if (isFollowing) {
        const { error } = await supabaseClient
            .from('account_follows')
            .delete()
            .eq('follower_id', currentUser.id)
            .eq('following_id', targetUserId);
        if (!error) {
            followingIds.delete(idStr);
            if (btnEl) {
                btnEl.textContent = 'Follow';
                btnEl.className = 'px-3 py-1.5 rounded-full text-[11px] font-bold shrink-0 transition-all bg-accord-blue text-white hover:bg-accord-darkBlue';
            }
        }
    } else {
        const { error } = await supabaseClient
            .from('account_follows')
            .insert([{ follower_id: currentUser.id, following_id: targetUserId }]);
        if (!error) {
            followingIds.add(idStr);
            if (btnEl) {
                btnEl.textContent = 'Following';
                btnEl.className = 'px-3 py-1.5 rounded-full text-[11px] font-bold shrink-0 transition-all bg-slate-100 text-accord-slate hover:bg-slate-200';
            }
        }
    }
}

function getPostTypeMeta(type) {
    switch (type) {
        case 'video':
            return { label: 'Video', badgeClass: 'bg-blue-50 text-accord-blue border border-blue-200', icon: 'fa-video' };
        case 'audio':
            return { label: 'Audio', badgeClass: 'bg-amber-50 text-accord-gold border border-amber-200', icon: 'fa-podcast' };
        case 'text':
            return { label: 'Text Post', badgeClass: 'bg-emerald-50 text-emerald-700 border border-emerald-200', icon: 'fa-align-left' };
        case 'testimony':
        default:
            return { label: 'Testimony', badgeClass: 'bg-rose-50 text-rose-600 border border-rose-200', icon: 'fa-heart' };
    }
}

function formatFeedTimeAgo(dateStr) {
    if (!dateStr) return '';
    const diffSec = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
    if (diffSec < 60) return 'Just now';
    if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m`;
    if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h`;
    if (diffSec < 604800) return `${Math.floor(diffSec / 86400)}d`;
    return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function getFeedPostDetailUrl(post) {
    return getPostShareUrl(post.id);
}

function renderFeedCard(post, repost = null) {
    const myAvatarInitial = (currentProfile?.full_name || currentUser?.email || 'U').charAt(0).toUpperCase();
    return createSharedFeedCardElement(post, {
        repost,
        isLiked: likedPostIds.has(String(post.id)),
        isReposted: myRepostedPostIds.has(String(post.id)),
        commentsCount: commentCountsByPost[String(post.id)] || 0,
        myAvatarInitial,
        authorHandle: post.author_id ? (authorHandlesById[String(post.author_id)] || '') : '',
        reposterHandle: repost?.profiles?.handle || '',
        currentUserId: currentUser?.id || null
    });
}

function closeAllFeedPostMenus() {
    document.querySelectorAll('.feed-post-menu').forEach(el => el.classList.add('hidden'));
}

function toggleFeedPostMenu(e, postId) {
    e.stopPropagation();
    const menu = document.getElementById(`feed-post-menu-${postId}`);
    if (!menu) return;
    const isHidden = menu.classList.contains('hidden');
    closeAllFeedPostMenus();
    if (isHidden) menu.classList.remove('hidden');
}

window.addEventListener('click', closeAllFeedPostMenus);

function toggleExpandPostBody(postId) {
    const post = allFeedPosts.find(p => String(p.id) === String(postId));
    const bodyEl = document.getElementById(`post-body-${postId}`);
    const btnEl = document.getElementById(`post-see-more-${postId}`);
    if (!post || !bodyEl || !btnEl) return;

    const expanded = btnEl.dataset.expanded === 'true';
    if (expanded) {
        bodyEl.textContent = String(post.body || '').slice(0, 260).trim() + '...';
        btnEl.textContent = 'See more';
        btnEl.dataset.expanded = 'false';
    } else {
        bodyEl.textContent = post.body || '';
        btnEl.textContent = 'See less';
        btnEl.dataset.expanded = 'true';
    }
}

async function toggleInlineComments(postId) {
    const container = document.getElementById(`inline-comments-${postId}`);
    if (!container) return;
    const willOpen = container.classList.contains('hidden');
    container.classList.toggle('hidden');
    if (willOpen) {
        await loadInlineComments(postId);
        document.getElementById(`inline-comment-input-${postId}`)?.focus();
    }
}

async function loadInlineComments(postId) {
    const listEl = document.getElementById(`inline-comments-list-${postId}`);
    const post = allFeedPosts.find(p => String(p.id) === String(postId));
    if (!listEl || !post) return;

    const { data } = await supabaseClient
        .from('post_comments')
        .select('id, author_name, comment_text, created_at')
        .eq('post_id', post.id)
        .order('created_at', { ascending: true })
        .limit(30);

    listEl.innerHTML = renderSharedCommentsHtml(data || []);
}

async function submitInlineComment(e, postId) {
    e.preventDefault();
    if (!currentUser) {
        showToast('Please sign in to comment on posts.', true);
        setTimeout(() => { window.location.href = 'signin.html?next=feed.html'; }, 800);
        return;
    }

    const input = document.getElementById(`inline-comment-input-${postId}`);
    const text = input?.value.trim() || '';
    const post = allFeedPosts.find(p => String(p.id) === String(postId));
    if (!text || !post) return;

    const authorName = currentProfile?.full_name || currentUser?.email?.split('@')[0] || 'Member';
    input.value = '';

    const { error } = await supabaseClient.from('post_comments').insert([{
        post_id: post.id,
        user_id: currentUser.id,
        author_id: currentUser.id,
        author_name: authorName,
        comment_text: text
    }]);

    if (error) {
        showToast(`Could not post comment: ${error.message}`, true);
        input.value = text;
        return;
    }

    markPostAsViewed(postId);
    commentCountsByPost[String(postId)] = (commentCountsByPost[String(postId)] || 0) + 1;
    const countEl = document.getElementById(`comment-count-${postId}`);
    if (countEl) countEl.textContent = commentCountsByPost[String(postId)];
    await loadInlineComments(postId);
}

function handleShareClick(postId) {
    const post = allFeedPosts.find(p => String(p.id) === String(postId));
    if (!post) return;
    shareOrCopyPost(post);
}

function handleSendPostToChat(postId) {
    const post = allFeedPosts.find(p => String(p.id) === String(postId));
    if (!post || typeof openShareToChatModal !== 'function') return;
    const videoThumb = post.post_type === 'video' && typeof getSharedVideoThumbnailUrl === 'function'
        ? getSharedVideoThumbnailUrl(post.media_url)
        : '';
    openShareToChatModal({
        type: post.post_type === 'testimony' ? 'shared_testimony' : 'shared_post',
        id: post.id,
        title: post.title,
        subtitle: (post.body || '').slice(0, 110),
        url: getFeedPostDetailUrl(post),
        image_url: videoThumb,
        media_url: post.media_url || '',
        author_name: post.is_anonymous ? 'Anonymous' : (post.author_name || 'Member'),
        post_type: post.post_type
    });
}

function handleEditPostClick(postId) {
    const post = allFeedPosts.find(p => String(p.id) === String(postId));
    if (!post || typeof openSharedEditPostModal !== 'function') return;
    openSharedEditPostModal(post, (updated) => {
        if (!updated) return;
        const idx = allFeedPosts.findIndex(p => String(p.id) === String(postId));
        if (idx !== -1) allFeedPosts[idx] = updated;
        renderFeedStream();
    });
}

function handleDeletePostClick(postId) {
    if (typeof executeSharedDeletePost !== 'function') return;
    executeSharedDeletePost(postId, () => {
        allFeedPosts = allFeedPosts.filter(p => String(p.id) !== String(postId));
        allReposts = allReposts.filter(r => String(r.post_id) !== String(postId));
        renderFeedStream();
    });
}

async function handleRepostClick(postId) {
    if (!currentUser) {
        showToast('Please sign in to repost to your followers.', true);
        setTimeout(() => { window.location.href = 'signin.html?next=feed.html'; }, 800);
        return;
    }

    if (myRepostedPostIds.has(String(postId))) {
        const { error } = await supabaseClient
            .from('post_reposts')
            .delete()
            .eq('post_id', postId)
            .eq('user_id', currentUser.id);
        if (error) {
            showToast(`Could not remove repost: ${error.message}`, true);
            return;
        }
        showToast('Repost removed.');
        await loadFeedPosts();
        return;
    }

    const post = allFeedPosts.find(p => String(p.id) === String(postId));
    document.getElementById('repost-post-id').value = postId;
    const previewEl = document.getElementById('repost-post-preview');
    if (previewEl && post) previewEl.textContent = `${post.title} — ${post.author_name || 'Member'}`;
    const modal = document.getElementById('repost-modal');
    modal?.classList.remove('hidden');
    modal?.classList.add('flex');
}

function closeRepostModal() {
    const modal = document.getElementById('repost-modal');
    modal?.classList.add('hidden');
    modal?.classList.remove('flex');
    document.getElementById('repost-form')?.reset();
}

async function handleRepostSubmit(e) {
    e.preventDefault();
    if (!currentUser) return;

    const postId = document.getElementById('repost-post-id').value;
    const quoteText = document.getElementById('repost-quote-text')?.value.trim() || null;
    const btn = document.getElementById('repost-submit-btn');
    if (btn) btn.disabled = true;

    const { error } = await supabaseClient
        .from('post_reposts')
        .insert([{ post_id: postId, user_id: currentUser.id, quote_text: quoteText }]);

    if (btn) btn.disabled = false;

    if (error) {
        showToast(`Could not repost: ${error.message}`, true);
        return;
    }

    closeRepostModal();
    showToast('Reposted to your followers!');
    await loadFeedPosts();
}

async function togglePostLike(postId) {
    const voterKey = getVoterKey();
    const post = allFeedPosts.find(p => String(p.id) === String(postId));
    if (!post) return;

    const alreadyLiked = likedPostIds.has(String(postId));
    let nextCount = Number(post.likes_count) || 0;

    if (alreadyLiked) {
        await supabaseClient.from('post_likes').delete().eq('post_id', postId).eq('voter_key', voterKey);
        likedPostIds.delete(String(postId));
        nextCount = Math.max(0, nextCount - 1);
    } else {
        const { error } = await supabaseClient.from('post_likes').insert([{ post_id: postId, voter_key: voterKey }]);
        if (error) {
            showToast('Could not record like.', true);
            return;
        }
        likedPostIds.add(String(postId));
        nextCount += 1;
        markPostAsViewed(postId);
    }
    post.likes_count = nextCount;
    await supabaseClient.from('feed_posts').update({ likes_count: nextCount }).eq('id', postId);

    const countEl = document.getElementById(`like-count-${postId}`);
    const btnEl = document.getElementById(`like-btn-${postId}`);
    if (countEl) countEl.textContent = nextCount;
    if (btnEl) {
        btnEl.className = !alreadyLiked
            ? 'py-2 rounded-lg hover:bg-slate-100 flex items-center justify-center gap-1.5 text-xs sm:text-[13px] font-semibold transition-colors text-rose-600'
            : 'py-2 rounded-lg hover:bg-slate-100 flex items-center justify-center gap-1.5 text-xs sm:text-[13px] font-semibold transition-colors text-slate-600';
        const icon = btnEl.querySelector('i');
        if (icon) icon.className = !alreadyLiked ? 'fa-solid fa-heart text-sm' : 'fa-regular fa-heart text-sm';
    }
}

function openCreatePostModal(defaultType = 'testimony') {
    const typeSelect = document.getElementById('post-type');
    if (typeSelect) typeSelect.value = defaultType;
    togglePostTypeFields();
    toggleAnonymousAuthorInput();

    const modal = document.getElementById('create-post-modal');
    modal?.classList.remove('hidden');
    modal?.classList.add('flex');
}

function closeCreatePostModal() {
    const modal = document.getElementById('create-post-modal');
    modal?.classList.remove('flex');
    modal?.classList.add('hidden');
    document.getElementById('create-post-form')?.reset();
}

function syncPostAsPageSelector() {
    const group = document.getElementById('post-as-page-group');
    const sel = document.getElementById('post-as-page-select');
    if (!group || !sel) return;

    if (!currentUser || managedVerifiedPages.length === 0) {
        group.classList.add('hidden');
        sel.innerHTML = '';
        return;
    }

    const selfName = currentProfile?.full_name || currentUser.email?.split('@')[0] || 'My Account';
    const options = [
        `<option value="">Myself (${escapeHtml(selfName)})</option>`,
        ...managedVerifiedPages.map(p => `<option value="${escapeHtml(p.id)}">${escapeHtml(p.full_name || 'Verified Page')} (Verified Page)</option>`)
    ];
    sel.innerHTML = options.join('');
    group.classList.remove('hidden');
}

function getSelectedPostingPage() {
    const sel = document.getElementById('post-as-page-select');
    const pageId = sel?.value || '';
    if (!pageId) return null;
    return managedVerifiedPages.find(p => String(p.id) === String(pageId)) || null;
}

function togglePostTypeFields() {
    const type = document.getElementById('post-type')?.value || 'testimony';
    const urlGroup = document.getElementById('post-url-group');
    const urlInput = document.getElementById('post-url');
    const idBox = document.getElementById('testimony-identity-box');
    const noteEl = document.getElementById('create-post-permission-note');
    const selectedPage = getSelectedPostingPage();
    const canPostVerified = isMinistryOrMinister() || Boolean(selectedPage);

    const needsUrl = type === 'video' || type === 'audio';
    urlGroup?.classList.toggle('hidden', !needsUrl);
    if (urlInput) urlInput.required = needsUrl;

    // Anonymous toggle applies to testimonies when posting as self
    idBox?.classList.toggle('hidden', type !== 'testimony' || Boolean(selectedPage));

    if (selectedPage) {
        if (noteEl) noteEl.textContent = `Posting on behalf of verified page: ${selectedPage.full_name}.`;
    } else if (type === 'testimony') {
        if (noteEl) noteEl.textContent = 'Testimonies can be shared by anyone, including anonymously.';
    } else if (!currentUser) {
        if (noteEl) noteEl.textContent = 'Sign in with a Ministry / Minister account to post Videos, Audio, or Text Posts.';
    } else if (!canPostVerified) {
        if (noteEl) noteEl.innerHTML = managedVerifiedPages.length > 0
            ? 'Select a verified page in <strong>Post As</strong> above to publish Videos, Audio, or Text Posts on its behalf, or <a href="verify.html" class="text-accord-blue font-bold underline">apply for your own verification</a>.'
            : 'Your account is a Normal User. <a href="verify.html" class="text-accord-blue font-bold underline">Apply for Ministry / Minister Verification</a> to publish Videos, Audio, or Text Posts.';
    } else {
        if (noteEl) noteEl.textContent = 'Verified Ministry / Minister account active: your post publishes directly to the feed.';
    }
}

function toggleAnonymousAuthorInput() {
    const isAnon = document.getElementById('post-anonymous')?.checked;
    const nameWrap = document.getElementById('guest-author-name-wrapper');
    nameWrap?.classList.toggle('hidden', Boolean(isAnon));
}

async function handleCreatePostSubmit(e) {
    e.preventDefault();

    const postType = document.getElementById('post-type').value;
    const title = document.getElementById('post-title').value.trim();
    const body = document.getElementById('post-content').value.trim();
    const mediaUrl = document.getElementById('post-url')?.value.trim() || null;
    const selectedPage = getSelectedPostingPage();
    const isAnonymous = (postType === 'testimony' && !selectedPage) ? Boolean(document.getElementById('post-anonymous')?.checked) : false;
    const customName = document.getElementById('post-author-name')?.value.trim() || '';

    // Enforce permissions: Testimonies allow guests/anonymous; Video/Audio/Text require Ministry/Minister or Page Admin
    if (postType !== 'testimony') {
        if (!currentUser) {
            showToast('Please sign in with a Ministry / Minister account to post.', true);
            return;
        }
        if (!isMinistryOrMinister() && !selectedPage) {
            showToast('Only verified Ministry / Minister accounts or their Page Admins can publish Video, Audio, or Text Posts.', true);
            return;
        }
    }

    const submitBtn = document.getElementById('create-post-submit-btn');
    if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = 'Publishing...';
    }

    let authorName = 'Anonymous';
    if (selectedPage) {
        authorName = selectedPage.full_name || 'Verified Ministry';
    } else if (!isAnonymous) {
        if (currentProfile?.full_name) {
            authorName = currentProfile.full_name;
        } else if (currentUser?.email) {
            authorName = currentUser.email.split('@')[0];
        } else if (customName) {
            authorName = customName;
        } else {
            authorName = 'Anonymous';
        }
    }

    const resolvedRole = selectedPage
        ? 'ministry_minister'
        : (currentUser
            ? (isMinistryOrMinister(currentProfile) ? 'ministry_minister' : (currentProfile?.account_type || 'normal_user'))
            : 'guest');

    const payload = {
        post_type: postType,
        title,
        body,
        media_url: (postType === 'video' || postType === 'audio') ? mediaUrl : null,
        author_id: selectedPage ? selectedPage.id : (currentUser ? currentUser.id : null),
        author_name: authorName,
        author_role: resolvedRole,
        is_anonymous: isAnonymous,
        is_approved: true
    };

    const { data, error } = await supabaseClient
        .from('feed_posts')
        .insert([payload])
        .select()
        .single();

    if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Publish to Feed';
    }

    if (error) {
        showToast(`Could not publish post: ${error.message}`, true);
        return;
    }

    closeCreatePostModal();
    showToast('Published to the feed!');
    if (data) {
        allFeedPosts.unshift(data);
        setFeedTab(postType);
    } else {
        await loadFeedPosts();
    }
}

function openReportModal(postId) {
    document.getElementById('report-post-id').value = postId;
    const modal = document.getElementById('report-modal');
    modal?.classList.remove('hidden');
    modal?.classList.add('flex');
}

function closeReportModal() {
    const modal = document.getElementById('report-modal');
    modal?.classList.remove('flex');
    modal?.classList.add('hidden');
    document.getElementById('report-form')?.reset();
}

async function handleReportSubmit(e) {
    e.preventDefault();
    const post_id = document.getElementById('report-post-id').value;
    const categoryReason = document.getElementById('report-category-reason').value;
    const details = document.getElementById('report-reason').value.trim();

    const { error } = await supabaseClient.from('post_reports').insert([{
        post_id,
        reporter_id: currentUser ? currentUser.id : null,
        reason: categoryReason,
        details
    }]);

    if (error) {
        showToast('Could not submit flag report.', true);
        return;
    }

    closeReportModal();
    showToast('Post flagged for moderation review.');
}

function getYouTubeEmbedUrl(url) {
    let videoId = '';
    if (url.includes('youtu.be/')) {
        videoId = url.split('youtu.be/')[1]?.split('?')[0];
    } else if (url.includes('watch?v=')) {
        videoId = url.split('watch?v=')[1]?.split('&')[0];
    } else if (url.includes('embed/')) {
        videoId = url.split('embed/')[1]?.split('?')[0];
    }
    return videoId ? `https://www.youtube.com/embed/${videoId}` : url;
}

function escapeHtml(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}