let currentTab = 'all';
let currentUser = null;
let currentProfile = null; // { account_type: 'normal_user' | 'ministry_minister', upgrade_status, full_name }
let allFeedPosts = [];
let allReposts = [];
let followingIds = new Set();
let myRepostedPostIds = new Set();
let likedPostIds = new Set();
let commentCountsByPost = {};

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
            .select('id, full_name, email, account_type, upgrade_status')
            .eq('id', currentUser.id)
            .maybeSingle();

        currentProfile = profile || {
            id: currentUser.id,
            full_name: currentUser.user_metadata?.full_name || currentUser.email.split('@')[0],
            email: currentUser.email,
            account_type: 'normal_user',
            upgrade_status: 'none'
        };
    } else {
        currentProfile = null;
        if (authLabel) authLabel.textContent = 'Sign In';
        if (mobileAuthLabel) mobileAuthLabel.textContent = 'Sign In / Create Account';
    }

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
            .select('id, post_id, user_id, quote_text, created_at, profiles(id, full_name, account_type, upgrade_status)')
            .order('created_at', { ascending: false })
            .limit(120),
        supabaseClient.from('testimonies').select('*').eq('is_approved', true).order('created_at', { ascending: false }),
        supabaseClient.from('testimony_comments').select('testimony_id')
    ];

    if (currentUser?.id) {
        requests.push(
            supabaseClient.from('account_follows').select('following_id').eq('follower_id', currentUser.id)
        );
    }

    const [postsRes, likesRes, commentsRes, repostsRes, testimoniesRes, testimonyCommentsRes, followsRes] = await Promise.all(requests);

    if (postsRes.error) {
        streamContainer.innerHTML = `
            <div class="bg-white border border-slate-200 rounded-2xl p-12 text-center space-y-2">
                <p class="text-xs font-bold text-red-600">Could not load feed posts.</p>
                <p class="text-xs text-accord-muted">${escapeHtml(postsRes.error.message)}</p>
            </div>
        `;
        return;
    }

    const feedPostRows = (postsRes.data || []).map(p => ({ ...p, _source: 'feed_posts' }));
    const testimonyRows = (!testimoniesRes?.error && testimoniesRes?.data ? testimoniesRes.data : []).map(t => ({
        id: `testimony_${t.id}`,
        _rawId: t.id,
        _source: 'testimonies',
        post_type: 'testimony',
        title: t.title,
        body: t.body,
        author_name: t.author_name || 'Anonymous',
        author_id: null,
        author_role: null,
        is_anonymous: !t.author_name || t.author_name.toLowerCase() === 'anonymous',
        media_url: null,
        likes_count: Number(t.likes_count) || 0,
        reposts_count: 0,
        created_at: t.created_at
    }));

    allFeedPosts = [...feedPostRows, ...testimonyRows];
    allReposts = (!repostsRes?.error && repostsRes?.data) ? repostsRes.data : [];
    followingIds = new Set((followsRes?.data || []).map(f => String(f.following_id)));
    myRepostedPostIds = new Set(
        currentUser?.id
            ? allReposts.filter(r => r.user_id === currentUser.id).map(r => String(r.post_id))
            : []
    );

    const amenedIds = JSON.parse(localStorage.getItem('accord_amened_ids') || '[]');
    likedPostIds = new Set([
        ...(likesRes.data || []).map(l => String(l.post_id)),
        ...amenedIds.map(id => `testimony_${id}`)
    ]);

    commentCountsByPost = {};
    (commentsRes.data || []).forEach(c => {
        const key = String(c.post_id);
        commentCountsByPost[key] = (commentCountsByPost[key] || 0) + 1;
    });
    (!testimonyCommentsRes?.error && testimonyCommentsRes?.data ? testimonyCommentsRes.data : []).forEach(c => {
        const key = `testimony_${c.testimony_id}`;
        commentCountsByPost[key] = (commentCountsByPost[key] || 0) + 1;
    });

    renderFeedStream();
}

function buildRankedFeedItems() {
    const postById = new Map(allFeedPosts.map(p => [String(p.id), p]));
    const items = [];

    allFeedPosts.forEach(post => {
        const matchesTab = currentTab === 'all' || post.post_type === currentTab;
        if (!matchesTab) return;
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
        if (!matchesTab) return;
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
        const isFollowedActor = Boolean(item.actorId && followingIds.has(String(item.actorId)));
        const ageHours = Math.max(0, (now - item.timestamp) / 3600000);
        const engagement =
            (Number(item.post.likes_count) || 0) * 2 +
            (commentCountsByPost[String(item.post.id)] || 0) * 3 +
            (Number(item.post.reposts_count) || 0) * 4;
        const recencyScore = Math.max(0, 500 - ageHours * 1.5);
        item.score = (isFollowedActor ? 10000 : 0) + recencyScore + Math.min(200, engagement);
    });

    items.sort((a, b) => b.score - a.score || b.timestamp - a.timestamp);
    return items;
}

function renderFeedStream() {
    const streamContainer = document.getElementById('feed-stream');
    if (!streamContainer) return;

    const visibleItems = buildRankedFeedItems();

    if (visibleItems.length === 0) {
        streamContainer.innerHTML = `
            <div class="bg-white border border-slate-200 rounded-3xl p-12 text-center space-y-3">
                <i class="fa-regular fa-folder-open text-3xl text-slate-300"></i>
                <h3 class="font-bold text-accord-slate text-sm">No posts in this category yet</h3>
                <p class="text-xs text-accord-muted">Select another tab or share a new post above.</p>
            </div>
        `;
        return;
    }

    streamContainer.innerHTML = '';
    visibleItems.forEach(item => {
        streamContainer.appendChild(renderFeedCard(item.post, item.repost || null));
    });
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
    if (post._source === 'testimonies') {
        return `${window.location.origin}/testimony.html?id=${encodeURIComponent(post._rawId)}`;
    }
    return getPostShareUrl(post.id);
}

function renderFeedCard(post, repost = null) {
    const card = document.createElement('article');
    card.className = 'bg-white border border-slate-200/80 rounded-xl sm:rounded-2xl shadow-sm overflow-visible';

    const postUrl = getFeedPostDetailUrl(post);
    const isTestimonyTable = post._source === 'testimonies';
    const isLiked = likedPostIds.has(String(post.id));
    const isReposted = myRepostedPostIds.has(String(post.id));
    const likesCount = Number(post.likes_count) || 0;
    const repostsCount = Number(post.reposts_count) || 0;
    const commentsCount = commentCountsByPost[String(post.id)] || 0;
    const dateFormatted = formatFeedTimeAgo(post.created_at);

    const displayAuthor = post.is_anonymous ? 'Anonymous' : (post.author_name || 'Anonymous');
    const isVerifiedAuthor = post.author_role === 'ministry_minister' && !post.is_anonymous;
    const authorProfileUrl = (!post.is_anonymous && post.author_id)
        ? `user.html?id=${encodeURIComponent(post.author_id)}`
        : null;

    let repostBannerHtml = '';
    if (repost) {
        const reposterName = repost.profiles?.full_name || 'Member';
        const reposterUrl = `user.html?id=${encodeURIComponent(repost.user_id)}`;
        const quoteHtml = repost.quote_text
            ? `<p class="text-xs italic text-slate-700 bg-slate-50 border-l-2 border-emerald-500 pl-3 py-1.5 rounded-r-lg mt-1.5">"${escapeHtml(repost.quote_text)}"</p>`
            : '';
        repostBannerHtml = `
            <div class="px-4 pt-3 pb-2 border-b border-slate-100">
                <a href="${escapeHtml(reposterUrl)}" class="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-600 hover:text-emerald-700">
                    <i class="fa-solid fa-retweet text-emerald-600"></i>
                    <span><strong class="text-slate-900">${escapeHtml(reposterName)}</strong> reposted</span>
                </a>
                ${quoteHtml}
            </div>
        `;
    }

    const avatarInner = `
        <div class="relative w-10 h-10 rounded-full bg-accord-lightBlue text-accord-blue font-bold flex items-center justify-center text-sm shrink-0">
            <span>${escapeHtml(displayAuthor.charAt(0).toUpperCase())}</span>
            ${isVerifiedAuthor ? `<span title="Verified Ministry / Minister" class="absolute -bottom-0.5 -right-0.5 w-4 h-4 rounded-full bg-accord-blue text-white flex items-center justify-center ring-2 ring-white"><i class="fa-solid fa-check text-[8px]"></i></span>` : ''}
        </div>
    `;

    const authorAvatarHtml = authorProfileUrl
        ? `<a href="${escapeHtml(authorProfileUrl)}" class="shrink-0 hover:opacity-90 transition-opacity">${avatarInner}</a>`
        : avatarInner;

    const authorNameHtml = authorProfileUrl
        ? `<a href="${escapeHtml(authorProfileUrl)}" class="text-[14px] font-bold text-slate-900 hover:underline truncate">${escapeHtml(displayAuthor)}</a>`
        : `<span class="text-[14px] font-bold text-slate-900 truncate">${escapeHtml(displayAuthor)}</span>`;

    const typeMeta = getPostTypeMeta(post.post_type);
    let mediaHtml = '';

    if (post.post_type === 'video' && post.media_url) {
        const embedUrl = getYouTubeEmbedUrl(post.media_url);
        mediaHtml = `
            <div class="relative w-full aspect-video bg-black">
                <iframe src="${escapeHtml(embedUrl)}" class="w-full h-full border-0" allowfullscreen></iframe>
            </div>
        `;
    } else if (post.post_type === 'audio' && post.media_url) {
        const isDirectAudio = /\.(mp3|wav|ogg|m4a)(\?|$)/i.test(post.media_url);
        mediaHtml = isDirectAudio
            ? `<div class="mx-4 mb-3 bg-slate-50 border border-slate-200 rounded-xl p-3">
                   <audio controls src="${escapeHtml(post.media_url)}" class="w-full"></audio>
               </div>`
            : `<div class="mx-4 mb-3 bg-slate-50 border border-slate-200 rounded-xl p-3.5 flex items-center space-x-3.5">
                   <div class="w-11 h-11 bg-accord-goldLight rounded-xl flex items-center justify-center text-accord-gold shrink-0">
                       <i class="fa-solid fa-podcast text-lg"></i>
                   </div>
                   <div class="flex-grow min-w-0">
                       <p class="text-xs font-bold text-accord-slate truncate">Audio Stream</p>
                       <a href="${escapeHtml(post.media_url)}" target="_blank" rel="noopener noreferrer" class="text-[11px] text-accord-blue font-semibold hover:underline truncate block">Listen on external platform →</a>
                   </div>
               </div>`;
    }

    const bodyText = String(post.body || '');
    const isLongBody = bodyText.length > 260;
    const shortBody = isLongBody ? bodyText.slice(0, 260).trim() + '...' : bodyText;

    const myAvatarInitial = (currentProfile?.full_name || currentUser?.email || 'U').charAt(0).toUpperCase();

    card.innerHTML = `
        ${repostBannerHtml}

        <!-- Facebook-Style Card Header -->
        <div class="px-4 pt-3.5 pb-2 flex items-start justify-between gap-3">
            <div class="flex items-center space-x-2.5 min-w-0">
                ${authorAvatarHtml}
                <div class="min-w-0">
                    <div class="flex items-center gap-1.5 flex-wrap">
                        ${authorNameHtml}
                        ${isVerifiedAuthor ? '<i class="fa-solid fa-circle-check text-accord-blue text-xs" title="Verified Ministry / Minister"></i>' : ''}
                    </div>
                    <div class="flex items-center gap-1.5 text-[11px] text-slate-500">
                        <span>${dateFormatted}</span>
                        <span>·</span>
                        <span class="inline-flex items-center gap-1 font-semibold ${post.post_type === 'testimony' ? 'text-rose-600' : post.post_type === 'video' ? 'text-accord-blue' : post.post_type === 'audio' ? 'text-accord-gold' : 'text-emerald-600'}">
                            <i class="fa-solid ${typeMeta.icon} text-[10px]"></i>
                            <span>${typeMeta.label}</span>
                        </span>
                    </div>
                </div>
            </div>

            <!-- 3-Dots More Menu -->
            <div class="relative shrink-0">
                <button type="button" onclick="toggleFeedPostMenu(event, '${post.id}')" class="w-8 h-8 rounded-full hover:bg-slate-100 text-slate-500 flex items-center justify-center transition-colors" aria-label="Post options">
                    <i class="fa-solid fa-ellipsis text-sm"></i>
                </button>
                <div id="feed-post-menu-${post.id}" onclick="event.stopPropagation()" class="feed-post-menu hidden absolute right-0 top-9 w-48 bg-white rounded-xl shadow-xl border border-slate-200 py-1.5 z-30">
                    <a href="${escapeHtml(postUrl)}" class="w-full px-3.5 py-2 text-left text-xs font-semibold text-slate-700 hover:bg-slate-50 flex items-center gap-2.5">
                        <i class="fa-solid fa-arrow-up-right-from-square w-3.5 text-center text-slate-400"></i>
                        <span>Open Full Post</span>
                    </a>
                    <button type="button" onclick="closeAllFeedPostMenus(); handleSendPostToChat('${post.id}')" class="w-full px-3.5 py-2 text-left text-xs font-semibold text-slate-700 hover:bg-slate-50 flex items-center gap-2.5">
                        <i class="fa-regular fa-paper-plane w-3.5 text-center text-accord-blue"></i>
                        <span>Send to Chat</span>
                    </button>
                    <button type="button" onclick="closeAllFeedPostMenus(); handleShareClick('${post.id}')" class="w-full px-3.5 py-2 text-left text-xs font-semibold text-slate-700 hover:bg-slate-50 flex items-center gap-2.5">
                        <i class="fa-solid fa-link w-3.5 text-center text-emerald-600"></i>
                        <span>Copy Link / Share</span>
                    </button>
                    ${!isTestimonyTable ? `
                    <button type="button" onclick="closeAllFeedPostMenus(); openReportModal('${post.id}')" class="w-full px-3.5 py-2 text-left text-xs font-semibold text-red-600 hover:bg-red-50 flex items-center gap-2.5 border-t border-slate-100 mt-1 pt-2">
                        <i class="fa-regular fa-flag w-3.5 text-center"></i>
                        <span>Flag Post</span>
                    </button>` : ''}
                </div>
            </div>
        </div>

        <!-- Post Content -->
        <div class="px-4 pb-3 space-y-1.5">
            ${post.title ? `<a href="${escapeHtml(postUrl)}" class="block text-[15px] font-bold text-slate-900 hover:text-accord-blue leading-snug">${escapeHtml(post.title)}</a>` : ''}
            <p id="post-body-${post.id}" class="text-[14px] text-slate-800 leading-relaxed whitespace-pre-wrap">${escapeHtml(shortBody)}</p>
            ${isLongBody ? `<button type="button" id="post-see-more-${post.id}" onclick="toggleExpandPostBody('${post.id}')" class="text-xs font-bold text-slate-500 hover:text-slate-800 hover:underline">See more</button>` : ''}
        </div>

        ${mediaHtml}

        <!-- Engagement Summary Row (Facebook Style) -->
        <div class="px-4 py-2 flex items-center justify-between text-xs text-slate-500">
            <div class="flex items-center gap-1.5">
                <span class="w-4 h-4 rounded-full bg-rose-500 text-white flex items-center justify-center text-[9px]">
                    <i class="fa-solid fa-heart"></i>
                </span>
                <span id="like-count-${post.id}">${likesCount}</span>
            </div>
            <div class="flex items-center gap-3">
                <button type="button" onclick="toggleInlineComments('${post.id}')" class="hover:underline">
                    <span id="comment-count-${post.id}">${commentsCount}</span> ${commentsCount === 1 ? 'comment' : 'comments'}
                </button>
                ${!isTestimonyTable ? `<span>${repostsCount} ${repostsCount === 1 ? 'repost' : 'reposts'}</span>` : ''}
            </div>
        </div>

        <!-- Facebook-Style Action Bar -->
        <div class="mx-4 border-t border-slate-200/80 py-1 grid ${isTestimonyTable ? 'grid-cols-3' : 'grid-cols-4'} gap-1">
            <button type="button" onclick="togglePostLike('${post.id}')" id="like-btn-${post.id}" class="py-2 rounded-lg hover:bg-slate-100 flex items-center justify-center gap-1.5 text-xs sm:text-[13px] font-semibold transition-colors ${isLiked ? 'text-rose-600' : 'text-slate-600'}">
                <i class="${isLiked ? 'fa-solid' : 'fa-regular'} fa-heart text-sm"></i>
                <span>Like</span>
            </button>

            <button type="button" onclick="toggleInlineComments('${post.id}')" class="py-2 rounded-lg hover:bg-slate-100 flex items-center justify-center gap-1.5 text-xs sm:text-[13px] font-semibold text-slate-600 transition-colors">
                <i class="fa-regular fa-comment text-sm"></i>
                <span>Comment</span>
            </button>

            ${!isTestimonyTable ? `
            <button type="button" onclick="handleRepostClick('${post.id}')" class="py-2 rounded-lg hover:bg-slate-100 flex items-center justify-center gap-1.5 text-xs sm:text-[13px] font-semibold transition-colors ${isReposted ? 'text-emerald-600' : 'text-slate-600'}">
                <i class="fa-solid fa-retweet text-sm"></i>
                <span>Repost</span>
            </button>` : ''}

            <button type="button" onclick="handleShareClick('${post.id}')" class="py-2 rounded-lg hover:bg-slate-100 flex items-center justify-center gap-1.5 text-xs sm:text-[13px] font-semibold text-slate-600 transition-colors">
                <i class="fa-solid fa-share text-sm"></i>
                <span>Share</span>
            </button>
        </div>

        <!-- Facebook-Style Inline Comment Section -->
        <div id="inline-comments-${post.id}" class="hidden border-t border-slate-200/80 px-4 py-3 space-y-3 bg-white rounded-b-xl sm:rounded-b-2xl">
            <div class="flex items-center gap-2">
                <div class="w-8 h-8 rounded-full bg-accord-lightBlue text-accord-blue font-bold text-xs flex items-center justify-center shrink-0">
                    ${escapeHtml(myAvatarInitial)}
                </div>
                <form onsubmit="submitInlineComment(event, '${post.id}')" class="flex-1 flex items-center gap-1.5 bg-[#F0F2F5] rounded-full px-3.5 py-1.5 focus-within:ring-2 focus-within:ring-accord-blue/30">
                    <input type="text" id="inline-comment-input-${post.id}" placeholder="Write a comment..." class="flex-1 bg-transparent text-xs sm:text-[13px] text-slate-800 placeholder-slate-500 focus:outline-none py-1" required>
                    <button type="submit" class="text-accord-blue hover:text-accord-darkBlue px-1.5 py-1 text-xs font-bold shrink-0" aria-label="Send comment">
                        <i class="fa-solid fa-paper-plane"></i>
                    </button>
                </form>
            </div>
            <div id="inline-comments-list-${post.id}" class="space-y-2.5">
                <p class="text-xs text-slate-400 text-center py-2">Loading comments...</p>
            </div>
            <div class="pt-1">
                <a href="${escapeHtml(postUrl)}#comments-section" class="text-xs font-semibold text-slate-500 hover:underline">Open full post &amp; all comments →</a>
            </div>
        </div>
    `;

    return card;
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

    let comments = [];
    if (post._source === 'testimonies') {
        const { data } = await supabaseClient
            .from('testimony_comments')
            .select('id, author_name, comment_text, created_at')
            .eq('testimony_id', post._rawId)
            .order('created_at', { ascending: true })
            .limit(30);
        comments = (data || []).map(c => ({
            author_name: c.author_name || 'Member',
            text: c.comment_text,
            created_at: c.created_at
        }));
    } else {
        const { data } = await supabaseClient
            .from('post_comments')
            .select('id, author_name, comment_text, created_at')
            .eq('post_id', post.id)
            .order('created_at', { ascending: true })
            .limit(30);
        comments = (data || []).map(c => ({
            author_name: c.author_name || 'Member',
            text: c.comment_text,
            created_at: c.created_at
        }));
    }

    if (comments.length === 0) {
        listEl.innerHTML = `<p class="text-xs text-slate-400 py-1">No comments yet. Be the first to comment!</p>`;
        return;
    }

    listEl.innerHTML = comments.map(c => `
        <div class="flex items-start gap-2">
            <div class="w-8 h-8 rounded-full bg-slate-200 text-slate-700 font-bold text-xs flex items-center justify-center shrink-0 mt-0.5">
                ${escapeHtml((c.author_name || 'M').charAt(0).toUpperCase())}
            </div>
            <div class="min-w-0 flex-1">
                <div class="inline-block bg-[#F0F2F5] rounded-2xl px-3.5 py-2 max-w-full">
                    <p class="text-xs font-bold text-slate-900">${escapeHtml(c.author_name)}</p>
                    <p class="text-xs sm:text-[13px] text-slate-800 whitespace-pre-wrap break-words leading-snug mt-0.5">${escapeHtml(c.text)}</p>
                </div>
                <div class="px-2 mt-0.5 text-[11px] font-semibold text-slate-500">
                    ${formatFeedTimeAgo(c.created_at)}
                </div>
            </div>
        </div>
    `).join('');
}

async function submitInlineComment(e, postId) {
    e.preventDefault();
    const input = document.getElementById(`inline-comment-input-${postId}`);
    const text = input?.value.trim() || '';
    const post = allFeedPosts.find(p => String(p.id) === String(postId));
    if (!text || !post) return;

    const authorName = currentProfile?.full_name || currentUser?.email?.split('@')[0] || 'Guest Member';
    input.value = '';

    let error = null;
    if (post._source === 'testimonies') {
        const res = await supabaseClient.from('testimony_comments').insert([{
            testimony_id: post._rawId,
            author_name: authorName,
            comment_text: text
        }]);
        error = res.error;
    } else {
        const res = await supabaseClient.from('post_comments').insert([{
            post_id: post.id,
            author_id: currentUser?.id || null,
            author_name: authorName,
            comment_text: text
        }]);
        error = res.error;
    }

    if (error) {
        showToast(`Could not post comment: ${error.message}`, true);
        input.value = text;
        return;
    }

    commentCountsByPost[String(postId)] = (commentCountsByPost[String(postId)] || 0) + 1;
    const countEl = document.getElementById(`comment-count-${postId}`);
    if (countEl) countEl.textContent = commentCountsByPost[String(postId)];
    await loadInlineComments(postId);
}

function handleShareClick(postId) {
    const post = allFeedPosts.find(p => String(p.id) === String(postId));
    if (!post) return;
    if (post._source === 'testimonies') {
        const shareUrl = getFeedPostDetailUrl(post);
        if (isMobileShareContext() && navigator.share) {
            navigator.share({ title: post.title, url: shareUrl }).catch(() => {});
        } else {
            navigator.clipboard.writeText(shareUrl).then(() => showToast('Link copied to clipboard!'));
        }
        return;
    }
    shareOrCopyPost(post);
}

function handleSendPostToChat(postId) {
    const post = allFeedPosts.find(p => String(p.id) === String(postId));
    if (!post || typeof openShareToChatModal !== 'function') return;
    openShareToChatModal({
        type: post.post_type === 'testimony' ? 'shared_testimony' : 'shared_post',
        id: post._source === 'testimonies' ? post._rawId : post.id,
        title: post.title,
        subtitle: (post.body || '').slice(0, 110),
        url: getFeedPostDetailUrl(post),
        author_name: post.is_anonymous ? 'Anonymous' : (post.author_name || 'Member'),
        post_type: post.post_type
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

    if (post._source === 'testimonies') {
        const amenedIds = JSON.parse(localStorage.getItem('accord_amened_ids') || '[]').map(Number);
        const rawId = Number(post._rawId);
        if (alreadyLiked) {
            likedPostIds.delete(String(postId));
            nextCount = Math.max(0, nextCount - 1);
            localStorage.setItem('accord_amened_ids', JSON.stringify(amenedIds.filter(id => id !== rawId)));
        } else {
            likedPostIds.add(String(postId));
            nextCount += 1;
            if (!amenedIds.includes(rawId)) {
                amenedIds.push(rawId);
                localStorage.setItem('accord_amened_ids', JSON.stringify(amenedIds));
            }
        }
        post.likes_count = nextCount;
        await supabaseClient.from('testimonies').update({ likes_count: nextCount }).eq('id', post._rawId);
    } else {
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
        }
        post.likes_count = nextCount;
        await supabaseClient.from('feed_posts').update({ likes_count: nextCount }).eq('id', postId);
    }

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

function togglePostTypeFields() {
    const type = document.getElementById('post-type')?.value || 'testimony';
    const urlGroup = document.getElementById('post-url-group');
    const urlInput = document.getElementById('post-url');
    const idBox = document.getElementById('testimony-identity-box');
    const noteEl = document.getElementById('create-post-permission-note');

    const needsUrl = type === 'video' || type === 'audio';
    urlGroup?.classList.toggle('hidden', !needsUrl);
    if (urlInput) urlInput.required = needsUrl;

    // Anonymous toggle applies to testimonies
    idBox?.classList.toggle('hidden', type !== 'testimony');

    if (type === 'testimony') {
        if (noteEl) noteEl.textContent = 'Testimonies can be shared by anyone, including anonymously.';
    } else if (!currentUser) {
        if (noteEl) noteEl.textContent = 'Sign in with a Ministry / Minister account to post Videos, Audio, or Text Posts.';
    } else if (!isMinistryOrMinister()) {
        if (noteEl) noteEl.textContent = 'Your account is a Normal User. Request a Ministry / Minister upgrade in Profile to publish Videos, Audio, or Text Posts.';
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
    const isAnonymous = postType === 'testimony' ? Boolean(document.getElementById('post-anonymous')?.checked) : false;
    const customName = document.getElementById('post-author-name')?.value.trim() || '';

    // Enforce permissions: Testimonies allow guests/anonymous; Video/Audio/Text require Ministry/Minister
    if (postType !== 'testimony') {
        if (!currentUser) {
            showToast('Please sign in with a Ministry / Minister account to post.', true);
            return;
        }
        if (!isMinistryOrMinister()) {
            showToast('Only Ministry / Minister accounts can publish Video, Audio, or Text Posts. Request an upgrade in Profile.', true);
            return;
        }
    }

    const submitBtn = document.getElementById('create-post-submit-btn');
    if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = 'Publishing...';
    }

    let authorName = 'Anonymous';
    if (!isAnonymous) {
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

    const resolvedRole = currentUser
        ? (isMinistryOrMinister(currentProfile) ? 'ministry_minister' : (currentProfile?.account_type || 'normal_user'))
        : 'guest';

    const payload = {
        post_type: postType,
        title,
        body,
        media_url: (postType === 'video' || postType === 'audio') ? mediaUrl : null,
        author_id: currentUser ? currentUser.id : null,
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