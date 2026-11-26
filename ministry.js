// Uses global `supabaseClient` initialized by admin-core.js
let ministryId = null;
let ministryProfile = null;
let currentUser = null;
let ministryPosts = [];
let currentMinistryTab = 'all';
let isFollowing = false;
let followersCount = 0;
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
    const params = new URLSearchParams(window.location.search);
    ministryId = params.get('id');

    if (ministryId) {
        window.location.replace(`user.html?id=${encodeURIComponent(ministryId)}`);
        return;
    }

    await initMinistrySession();

    if (!ministryId) {
        showMinistryNotFound();
        return;
    }

    await loadMinistryPage();
});

async function initMinistrySession() {
    const { data: { session } } = await supabaseClient.auth.getSession();
    currentUser = session?.user || null;

    const authLabel = document.getElementById('auth-nav-label');
    const mobileAuthLabel = document.getElementById('mobile-auth-label');

    if (currentUser) {
        if (authLabel) authLabel.textContent = 'Account';
        if (mobileAuthLabel) mobileAuthLabel.textContent = 'Account Settings';
    } else {
        if (authLabel) authLabel.textContent = 'Sign In';
        if (mobileAuthLabel) mobileAuthLabel.textContent = 'Sign In / Create Account';
    }
}

function handleAuthNavClick() {
    if (currentUser) {
        window.location.href = 'profile.html';
    } else {
        window.location.href = `signin.html?next=${encodeURIComponent('ministry.html' + window.location.search)}`;
    }
}

function toggleMobileMenu() {
    document.getElementById('mobile-menu')?.classList.toggle('hidden');
}

function showToast(message, isError = false) {
    const toast = document.getElementById('toast');
    const msgEl = document.getElementById('toast-message');
    const iconEl = document.getElementById('toast-icon');
    if (!toast || !msgEl) return;

    msgEl.textContent = message;
    if (iconEl) {
        iconEl.className = isError
            ? 'fa-solid fa-circle-exclamation text-red-500 text-base'
            : 'fa-solid fa-circle-check text-accord-gold text-base';
    }

    toast.classList.remove('translate-y-24', 'opacity-0');
    toast.classList.add('translate-y-0', 'opacity-100');
    setTimeout(() => {
        toast.classList.remove('translate-y-0', 'opacity-100');
        toast.classList.add('translate-y-24', 'opacity-0');
    }, 3500);
}

// ==========================================
// LOAD MINISTRY PROFILE, FOLLOWS & POSTS
// ==========================================

async function loadMinistryPage() {
    const { data: profile, error } = await supabaseClient
        .from('profiles')
        .select('id, full_name, account_type, upgrade_status, created_at')
        .eq('id', ministryId)
        .maybeSingle();

    const isVerified = profile && (profile.account_type === 'ministry_minister' || profile.upgrade_status === 'approved');
    if (error || !isVerified) {
        showMinistryNotFound();
        return;
    }

    ministryProfile = profile;
    const displayName = profile.full_name || 'Verified Ministry';
    document.title = `${displayName} — Accord Archive`;

    const [postsRes, followsCountRes, likesRes, commentsRes] = await Promise.all([
        supabaseClient
            .from('feed_posts')
            .select('*')
            .eq('author_id', ministryId)
            .eq('is_approved', true)
            .eq('is_anonymous', false)
            .order('created_at', { ascending: false }),
        supabaseClient
            .from('ministry_follows')
            .select('id', { count: 'exact', head: true })
            .eq('ministry_id', ministryId),
        supabaseClient
            .from('post_likes')
            .select('post_id')
            .eq('voter_key', getVoterKey()),
        supabaseClient
            .from('post_comments')
            .select('post_id')
    ]);

    ministryPosts = postsRes.data || [];
    followersCount = followsCountRes.count || 0;
    likedPostIds = new Set((likesRes.data || []).map(l => String(l.post_id)));

    commentCountsByPost = {};
    (commentsRes.data || []).forEach(c => {
        const key = String(c.post_id);
        commentCountsByPost[key] = (commentCountsByPost[key] || 0) + 1;
    });

    if (currentUser && currentUser.id !== ministryId) {
        const { data: followRow } = await supabaseClient
            .from('ministry_follows')
            .select('id')
            .eq('follower_id', currentUser.id)
            .eq('ministry_id', ministryId)
            .maybeSingle();
        isFollowing = Boolean(followRow);
    }

    renderMinistryHeader();
    renderMinistryPosts();

    document.getElementById('ministry-loading')?.classList.add('hidden');
    document.getElementById('ministry-header-card')?.classList.remove('hidden');
    document.getElementById('ministry-tabs-bar')?.classList.remove('hidden');
    document.getElementById('ministry-posts-stream')?.classList.remove('hidden');
}

function showMinistryNotFound() {
    document.getElementById('ministry-loading')?.classList.add('hidden');
    document.getElementById('ministry-not-found')?.classList.remove('hidden');
}

function renderMinistryHeader() {
    const displayName = ministryProfile.full_name || 'Verified Ministry';
    document.getElementById('ministry-avatar-initial').textContent = displayName.charAt(0).toUpperCase();
    document.getElementById('ministry-name').textContent = displayName;
    document.getElementById('ministry-followers-count').textContent = followersCount;
    document.getElementById('ministry-posts-count').textContent = ministryPosts.length;

    const joinedEl = document.getElementById('ministry-joined');
    if (joinedEl && ministryProfile.created_at) {
        const joinedDate = new Date(ministryProfile.created_at).toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
        joinedEl.textContent = `Joined ${joinedDate}`;
    }

    renderFollowButton();
}

function renderFollowButton() {
    const btn = document.getElementById('follow-btn');
    const icon = document.getElementById('follow-btn-icon');
    const label = document.getElementById('follow-btn-label');
    if (!btn || !icon || !label) return;

    // Hide Follow button on your own Ministry page
    if (currentUser && currentUser.id === ministryId) {
        btn.classList.add('hidden');
        return;
    }

    btn.classList.remove('hidden');
    if (isFollowing) {
        btn.className = 'px-5 py-2.5 rounded-xl border border-accord-blue bg-accord-lightBlue text-accord-blue hover:bg-blue-100 text-xs font-bold transition-all inline-flex items-center space-x-2';
        icon.className = 'fa-solid fa-user-check';
        label.textContent = 'Following';
    } else {
        btn.className = 'px-5 py-2.5 rounded-xl bg-accord-blue hover:bg-accord-darkBlue text-white text-xs font-bold shadow-sm transition-all inline-flex items-center space-x-2';
        icon.className = 'fa-solid fa-user-plus';
        label.textContent = 'Follow';
    }
}

async function toggleFollowMinistry() {
    if (!currentUser) {
        showToast('Please sign in to follow this ministry.', true);
        setTimeout(() => { window.location.href = `signin.html?next=${encodeURIComponent('ministry.html' + window.location.search)}`; }, 900);
        return;
    }

    if (currentUser.id === ministryId) return;

    const btn = document.getElementById('follow-btn');
    if (btn) btn.disabled = true;

    if (isFollowing) {
        const { error } = await supabaseClient
            .from('ministry_follows')
            .delete()
            .eq('follower_id', currentUser.id)
            .eq('ministry_id', ministryId);

        if (error) {
            showToast(`Could not unfollow: ${error.message}`, true);
        } else {
            isFollowing = false;
            followersCount = Math.max(0, followersCount - 1);
            showToast(`Unfollowed ${ministryProfile.full_name || 'ministry'}.`);
        }
    } else {
        const { error } = await supabaseClient
            .from('ministry_follows')
            .insert([{ follower_id: currentUser.id, ministry_id: ministryId }]);

        if (error) {
            showToast(`Could not follow: ${error.message}`, true);
        } else {
            isFollowing = true;
            followersCount += 1;
            showToast(`Now following ${ministryProfile.full_name || 'ministry'}!`);
        }
    }

    if (btn) btn.disabled = false;
    document.getElementById('ministry-followers-count').textContent = followersCount;
    renderFollowButton();
}

async function shareMinistryProfile() {
    const shareUrl = `${window.location.origin}/ministry.html?id=${encodeURIComponent(ministryId)}`;
    const title = ministryProfile?.full_name || 'Accord Archive Ministry';
    if (window.innerWidth < 768 && navigator.share) {
        try { await navigator.share({ title, url: shareUrl }); return; } catch (err) {}
    }
    await navigator.clipboard.writeText(shareUrl);
    showToast('Ministry link copied to clipboard!');
}

// ==========================================
// TABS & POSTS RENDERING
// ==========================================

function setMinistryTab(tab) {
    currentMinistryTab = tab;
    document.querySelectorAll('.ministry-tab-btn').forEach(btn => {
        btn.className = 'ministry-tab-btn whitespace-nowrap px-5 py-2.5 rounded-xl text-xs font-bold transition-all bg-white text-accord-slate hover:bg-slate-100 border border-slate-200';
    });

    const activeBtn = document.getElementById(`mtab-${tab}`);
    if (activeBtn) {
        activeBtn.className = 'ministry-tab-btn whitespace-nowrap px-5 py-2.5 rounded-xl text-xs font-bold transition-all bg-accord-blue text-white shadow-sm';
    }

    renderMinistryPosts();
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

function renderMinistryPosts() {
    const stream = document.getElementById('ministry-posts-stream');
    if (!stream) return;

    const visiblePosts = currentMinistryTab === 'all'
        ? ministryPosts
        : ministryPosts.filter(p => p.post_type === currentMinistryTab);

    if (visiblePosts.length === 0) {
        stream.innerHTML = `
            <div class="bg-white border border-slate-200 rounded-3xl p-12 text-center space-y-3">
                <i class="fa-regular fa-folder-open text-3xl text-slate-300"></i>
                <h3 class="font-bold text-accord-slate text-sm">No posts in this category yet</h3>
                <p class="text-xs text-accord-muted">Check back soon for updates from this ministry.</p>
            </div>
        `;
        return;
    }

    stream.innerHTML = '';
    visiblePosts.forEach(post => {
        const card = document.createElement('article');
        card.className = 'bg-white border border-slate-200/90 rounded-3xl p-6 sm:p-7 shadow-sm space-y-4 hover:shadow-md transition-shadow';

        const postUrl = typeof getPostShareUrl === 'function' ? getPostShareUrl(post.id) : `post.html?id=${encodeURIComponent(post.id)}`;
        const isLiked = likedPostIds.has(String(post.id));
        const likesCount = Number(post.likes_count) || 0;
        const commentsCount = commentCountsByPost[String(post.id)] || 0;
        const dateFormatted = post.created_at
            ? new Date(post.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
            : '';
        const typeMeta = getPostTypeMeta(post.post_type);

        let mediaHtml = '';
        if (post.post_type === 'video' && post.media_url) {
            const embedUrl = getYouTubeEmbedUrl(post.media_url);
            mediaHtml = `
                <div class="relative w-full aspect-video rounded-2xl overflow-hidden bg-slate-900 shadow-inner">
                    <iframe src="${escapeHtml(embedUrl)}" class="w-full h-full border-0" allowfullscreen></iframe>
                </div>
            `;
        } else if (post.post_type === 'audio' && post.media_url) {
            const isDirectAudio = /\.(mp3|wav|ogg|m4a)(\?|$)/i.test(post.media_url);
            mediaHtml = isDirectAudio
                ? `<div class="bg-slate-50 border border-slate-200 rounded-2xl p-4">
                       <audio controls src="${escapeHtml(post.media_url)}" class="w-full"></audio>
                   </div>`
                : `<div class="bg-slate-50 border border-slate-200 rounded-2xl p-4 flex items-center space-x-4">
                       <div class="w-12 h-12 bg-accord-goldLight rounded-xl flex items-center justify-center text-accord-gold shrink-0">
                           <i class="fa-solid fa-podcast text-xl"></i>
                       </div>
                       <div class="flex-grow min-w-0">
                           <p class="text-xs font-bold text-accord-slate truncate">Audio Stream</p>
                           <a href="${escapeHtml(post.media_url)}" target="_blank" rel="noopener noreferrer" class="text-[11px] text-accord-blue font-semibold hover:underline truncate block">Listen on external platform →</a>
                       </div>
                   </div>`;
        }

        card.innerHTML = `
            <div class="flex items-center justify-between gap-3">
                <p class="text-[11px] font-semibold text-accord-muted">${dateFormatted}</p>
                <span class="px-2.5 py-1 rounded-full text-[10px] font-bold shrink-0 ${typeMeta.badgeClass}">
                    <i class="fa-solid ${typeMeta.icon} mr-1"></i>${typeMeta.label}
                </span>
            </div>

            <div class="space-y-2">
                <a href="${escapeHtml(postUrl)}" class="block group">
                    <h3 class="serif-heading text-lg sm:text-xl font-bold text-accord-slate group-hover:text-accord-blue transition-colors">
                        ${escapeHtml(post.title)}
                    </h3>
                </a>
                <p class="text-xs sm:text-sm text-slate-700 leading-relaxed whitespace-pre-wrap line-clamp-4">
                    ${escapeHtml(post.body)}
                </p>
                <a href="${escapeHtml(postUrl)}" class="inline-flex items-center space-x-1 text-xs font-bold text-accord-blue hover:underline">
                    <span>Open Post &amp; Comments</span>
                    <i class="fa-solid fa-arrow-right text-[10px]"></i>
                </a>
            </div>

            ${mediaHtml}

            <div class="pt-3 border-t border-slate-100 flex items-center space-x-2 text-xs">
                <button type="button" onclick="toggleMinistryPostLike('${post.id}')" id="mlike-btn-${post.id}" class="px-3.5 py-2 rounded-xl font-bold transition-all flex items-center space-x-1.5 ${isLiked ? 'bg-rose-50 text-rose-600 border border-rose-200' : 'bg-slate-50 hover:bg-slate-100 text-accord-slate border border-slate-200'}">
                    <i class="${isLiked ? 'fa-solid' : 'fa-regular'} fa-heart"></i>
                    <span id="mlike-count-${post.id}">${likesCount}</span>
                </button>
                <a href="${escapeHtml(postUrl)}#comments-section" class="px-3.5 py-2 rounded-xl bg-slate-50 hover:bg-slate-100 text-accord-slate border border-slate-200 font-bold transition-all flex items-center space-x-1.5">
                    <i class="fa-regular fa-comment"></i>
                    <span>${commentsCount}</span>
                </a>
            </div>
        `;
        stream.appendChild(card);
    });
}

async function toggleMinistryPostLike(postId) {
    const voterKey = getVoterKey();
    const post = ministryPosts.find(p => String(p.id) === String(postId));
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
    }

    post.likes_count = nextCount;
    await supabaseClient.from('feed_posts').update({ likes_count: nextCount }).eq('id', postId);

    const countEl = document.getElementById(`mlike-count-${postId}`);
    const btnEl = document.getElementById(`mlike-btn-${postId}`);
    if (countEl) countEl.textContent = nextCount;
    if (btnEl) {
        btnEl.className = !alreadyLiked
            ? 'px-3.5 py-2 rounded-xl font-bold transition-all flex items-center space-x-1.5 bg-rose-50 text-rose-600 border border-rose-200'
            : 'px-3.5 py-2 rounded-xl font-bold transition-all flex items-center space-x-1.5 bg-slate-50 hover:bg-slate-100 text-accord-slate border border-slate-200';
        const icon = btnEl.querySelector('i');
        if (icon) icon.className = !alreadyLiked ? 'fa-solid fa-heart' : 'fa-regular fa-heart';
    }
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