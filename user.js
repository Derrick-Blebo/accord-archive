// =========================================================
// ACCORD USER.JS — Unified Public Account Profile
// Followers, Following, Posts, Reposts, Testimonies & Activities
// =========================================================

let targetUserId = null;
let targetProfile = null;
let viewerUser = null;
let viewerProfile = null;
let currentProfileTab = 'all';

let followersList = [];
let followingList = [];
let isFollowingTarget = false;

let userOriginalPosts = [];
let userReposts = [];
let userApprovedBlogArticles = [];
let allVisibleProfilePosts = [];
let likedPostIds = new Set();
let viewerRepostedPostIds = new Set();
let commentCountsByPost = {};
let authorHandlesById = {};
let authorAvatarsById = {};
let canEditTargetProfile = false;

function getVoterKey() {
    if (viewerUser?.id) return `user_${viewerUser.id}`;
    let guestKey = localStorage.getItem('accord_guest_voter_key');
    if (!guestKey) {
        guestKey = 'guest_' + (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}_${Math.random().toString(36).slice(2)}`);
        localStorage.setItem('accord_guest_voter_key', guestKey);
    }
    return guestKey;
}

document.addEventListener('DOMContentLoaded', async () => {
    const params = new URLSearchParams(window.location.search);
    const { data: { session } } = await supabaseClient.auth.getSession();
    viewerUser = session?.user || null;

    targetUserId = params.get('id') || viewerUser?.id || null;
    if (!targetUserId) {
        showProfileNotFound();
        return;
    }

    await loadUnifiedProfile();
});

function showProfileNotFound() {
    document.getElementById('profile-loading')?.classList.add('hidden');
    document.getElementById('profile-not-found')?.classList.remove('hidden');
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
    setTimeout(() => toast.classList.add('translate-y-24', 'opacity-0'), 3500);
}

async function loadUnifiedProfile() {
    let { data: profile, error } = await supabaseClient
        .from('profiles')
        .select('id, full_name, handle, bio, avatar_url, banner_url, account_type, upgrade_status, created_at, audio_stream_url, audio_stream_type')
        .eq('id', targetUserId)
        .maybeSingle();

    if (error && /audio_stream_/i.test(error.message || '')) {
        const fallback = await supabaseClient
            .from('profiles')
            .select('id, full_name, handle, bio, avatar_url, banner_url, account_type, upgrade_status, created_at')
            .eq('id', targetUserId)
            .maybeSingle();
        profile = fallback.data;
        error = fallback.error;
    }

    if (error || !profile) {
        showProfileNotFound();
        return;
    }

    targetProfile = profile;
    const displayName = profile.full_name || 'Accord Member';
    document.title = `${displayName} — Accord Archive`;

    window.editableFeedPageIds = [];
    canEditTargetProfile = Boolean(viewerUser && viewerUser.id === targetUserId);
    if (viewerUser?.id) {
        try {
            const { data: adminRows } = await supabaseClient
                .from('page_admins')
                .select('page_id, role, permissions, profiles!page_admins_page_id_fkey(id, account_type, upgrade_status)')
                .eq('admin_user_id', viewerUser.id);
            const activeVerifiedRows = (adminRows || []).filter(r => {
                const prof = r.profiles;
                return prof && (prof.account_type === 'ministry_minister' || prof.upgrade_status === 'approved') && prof.upgrade_status !== 'revoked';
            });
            window.editableFeedPageIds = activeVerifiedRows
                .filter(r => {
                    const p = r.permissions;
                    return p && typeof p === 'object' ? Boolean(p.can_edit_delete_posts) : (r.role === 'admin');
                })
                .map(r => String(r.page_id));

            if (!canEditTargetProfile) {
                canEditTargetProfile = activeVerifiedRows.some(r =>
                    String(r.page_id) === String(targetUserId) &&
                    r.permissions && typeof r.permissions === 'object' &&
                    Boolean(r.permissions.can_edit_profile)
                );
            }
        } catch {
            window.editableFeedPageIds = [];
        }
    }

    const requests = [
        supabaseClient
            .from('account_follows')
            .select('follower_id, created_at, profiles!account_follows_follower_id_fkey(id, full_name, handle, account_type, upgrade_status)')
            .eq('following_id', targetUserId)
            .order('created_at', { ascending: false }),
        supabaseClient
            .from('account_follows')
            .select('following_id, created_at, profiles!account_follows_following_id_fkey(id, full_name, handle, account_type, upgrade_status)')
            .eq('follower_id', targetUserId)
            .order('created_at', { ascending: false }),
        supabaseClient
            .from('feed_posts')
            .select('*')
            .eq('author_id', targetUserId)
            .eq('is_approved', true)
            .eq('is_anonymous', false)
            .order('created_at', { ascending: false }),
        supabaseClient
            .from('post_reposts')
            .select('id, post_id, user_id, quote_text, created_at, feed_posts(*)')
            .eq('user_id', targetUserId)
            .order('created_at', { ascending: false }),
        supabaseClient
            .from('post_likes')
            .select('post_id')
            .eq('voter_key', getVoterKey()),
        supabaseClient
            .from('post_comments')
            .select('post_id')
    ];

    if (viewerUser?.id) {
        requests.push(
            supabaseClient.from('profiles').select('id, full_name, handle').eq('id', viewerUser.id).maybeSingle(),
            supabaseClient.from('post_reposts').select('post_id').eq('user_id', viewerUser.id),
            typeof loadSharedSavedPostIds === 'function' ? loadSharedSavedPostIds(viewerUser.id) : Promise.resolve()
        );
    }

    const [
        followersRes,
        followingRes,
        postsRes,
        repostsRes,
        likesRes,
        commentsRes,
        viewerProfRes,
        viewerRepostsRes
    ] = await Promise.all(requests);

    viewerProfile = viewerProfRes?.data || null;
    followersList = (followersRes.data || []).map(r => r.profiles).filter(Boolean);
    followingList = (followingRes.data || []).map(r => r.profiles).filter(Boolean);

    userOriginalPosts = postsRes.data || [];

    userReposts = (repostsRes.data || [])
        .filter(r => r.feed_posts && r.feed_posts.is_approved)
        .map(r => ({
            id: r.id,
            user_id: r.user_id,
            reposter_name: targetProfile.full_name || 'User',
            reposter_handle: targetProfile.handle || '',
            quote_text: r.quote_text,
            created_at: r.created_at,
            post: r.feed_posts
        }));

    const postMap = new Map();
    userOriginalPosts.forEach(p => postMap.set(String(p.id), p));
    userReposts.forEach(r => postMap.set(String(r.post.id), r.post));
    allVisibleProfilePosts = Array.from(postMap.values());

    authorHandlesById = {};
    authorAvatarsById = {};
    if (targetProfile.handle) authorHandlesById[String(targetProfile.id)] = targetProfile.handle;
    if (targetProfile.avatar_url) authorAvatarsById[String(targetProfile.id)] = targetProfile.avatar_url;
    const otherAuthorIds = [...new Set(allVisibleProfilePosts.map(p => p.author_id).filter(id => id && String(id) !== String(targetUserId)))];
    if (otherAuthorIds.length > 0) {
        const { data: apRows } = await supabaseClient.from('profiles').select('id, handle, avatar_url').in('id', otherAuthorIds);
        (apRows || []).forEach(ap => {
            if (ap.handle) authorHandlesById[String(ap.id)] = ap.handle;
            if (ap.avatar_url) authorAvatarsById[String(ap.id)] = ap.avatar_url;
        });
    }

    likedPostIds = new Set((likesRes.data || []).map(l => String(l.post_id)));
    viewerRepostedPostIds = new Set((viewerRepostsRes?.data || []).map(r => String(r.post_id)));

    commentCountsByPost = {};
    (commentsRes.data || []).forEach(c => {
        const key = String(c.post_id);
        commentCountsByPost[key] = (commentCountsByPost[key] || 0) + 1;
    });

    isFollowingTarget = Boolean(
        viewerUser && followersList.some(f => f.id === viewerUser.id)
    );

    try {
        const { data: blogRows } = await supabaseClient
            .from('blog_articles')
            .select('*')
            .eq('author_id', targetUserId)
            .eq('status', 'approved')
            .order('created_at', { ascending: false });
        userApprovedBlogArticles = Array.isArray(blogRows) ? blogRows : [];
    } catch {
        userApprovedBlogArticles = [];
    }

    renderProfileHeader();
    renderProfileStream();

    document.getElementById('profile-loading')?.classList.add('hidden');
    document.getElementById('profile-header-card')?.classList.remove('hidden');
    document.getElementById('profile-tabs-bar')?.classList.remove('hidden');
    document.getElementById('profile-stream')?.classList.remove('hidden');

    const editParam = new URLSearchParams(window.location.search).get('edit');
    if (editParam === '1' && canEditTargetProfile) {
        openEditProfileModal();
    }
}

function renderProfileHeader() {
    const displayName = targetProfile.full_name || 'Accord Member';
    const isVerified = isVerifiedMinistryProfile(targetProfile);

    const avatarImg = document.getElementById('profile-avatar-img');
    const avatarInitial = document.getElementById('profile-avatar-initial');
    if (avatarInitial) avatarInitial.textContent = displayName.charAt(0).toUpperCase();
    if (targetProfile.avatar_url && avatarImg) {
        avatarImg.src = targetProfile.avatar_url;
        avatarImg.classList.remove('hidden');
        avatarInitial?.classList.add('hidden');
    } else {
        avatarImg?.classList.add('hidden');
        avatarInitial?.classList.remove('hidden');
    }

    const bannerImg = document.getElementById('profile-banner-img');
    if (targetProfile.banner_url && bannerImg) {
        bannerImg.src = targetProfile.banner_url;
        bannerImg.classList.remove('hidden');
    } else {
        bannerImg?.classList.add('hidden');
    }

    document.getElementById('profile-display-name').textContent = displayName;

    const handleEl = document.getElementById('profile-handle');
    if (handleEl) {
        if (targetProfile.handle) {
            handleEl.textContent = targetProfile.handle;
            handleEl.classList.remove('hidden');
        } else {
            handleEl.classList.add('hidden');
        }
    }

    const verifiedIcon = document.getElementById('profile-verified-icon');
    const roleBadge = document.getElementById('profile-role-badge');
    if (isVerified) {
        if (verifiedIcon && typeof getVerifiedCheckmarkSvg === 'function') {
            verifiedIcon.innerHTML = getVerifiedCheckmarkSvg();
            verifiedIcon.classList.remove('hidden');
        }
        roleBadge?.classList.remove('hidden');
    } else {
        verifiedIcon?.classList.add('hidden');
        roleBadge?.classList.add('hidden');
    }

    const joinedEl = document.getElementById('profile-joined-date');
    if (joinedEl && targetProfile.created_at) {
        const joined = new Date(targetProfile.created_at).toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
        joinedEl.textContent = `${isVerified ? 'Verified Ministry / Minister' : 'Community Member'} · Joined ${joined}`;
    }

    const bioEl = document.getElementById('profile-bio');
    if (bioEl) {
        if (targetProfile.bio && targetProfile.bio.trim()) {
            bioEl.textContent = targetProfile.bio.trim();
            bioEl.classList.remove('hidden');
        } else {
            bioEl.classList.add('hidden');
        }
    }

    document.getElementById('stat-followers').textContent = followersList.length;
    document.getElementById('stat-following').textContent = followingList.length;
    document.getElementById('stat-posts').textContent = userOriginalPosts.length + userReposts.length;

    const isSelf = viewerUser && viewerUser.id === targetUserId;
    document.getElementById('user-write-blog-btn')?.classList.toggle('hidden', !(isVerified && canEditTargetProfile));
    document.getElementById('user-edit-btn')?.classList.toggle('hidden', !canEditTargetProfile);
    document.getElementById('banner-edit-trigger')?.classList.toggle('hidden', !canEditTargetProfile);
    document.getElementById('user-message-btn')?.classList.toggle('hidden', Boolean(isSelf));
    document.getElementById('ptab-blog')?.classList.toggle('hidden', !(isVerified || userApprovedBlogArticles.length > 0));
    renderFollowButton();
}

function renderFollowButton() {
    const btn = document.getElementById('user-follow-btn');
    const icon = document.getElementById('user-follow-icon');
    const label = document.getElementById('user-follow-label');
    if (!btn || !icon || !label) return;

    if (viewerUser && viewerUser.id === targetUserId) {
        btn.classList.add('hidden');
        return;
    }

    btn.classList.remove('hidden');
    if (isFollowingTarget) {
        btn.className = 'px-5 py-2.5 rounded-xl border border-accord-blue bg-accord-lightBlue text-accord-blue hover:bg-blue-100 text-xs font-bold transition-all inline-flex items-center space-x-2';
        icon.className = 'fa-solid fa-user-check';
        label.textContent = 'Following';
    } else {
        btn.className = 'px-5 py-2.5 rounded-xl bg-accord-blue hover:bg-accord-darkBlue text-white text-xs font-bold shadow-sm transition-all inline-flex items-center space-x-2';
        icon.className = 'fa-solid fa-user-plus';
        label.textContent = 'Follow';
    }
}

async function toggleFollowUser() {
    if (!viewerUser) {
        showToast('Please sign in to follow accounts.', true);
        setTimeout(() => {
            window.location.href = `signin.html?next=${encodeURIComponent('user.html?id=' + targetUserId)}`;
        }, 800);
        return;
    }
    if (viewerUser.id === targetUserId) return;

    const btn = document.getElementById('user-follow-btn');
    if (btn) btn.disabled = true;

    if (isFollowingTarget) {
        const { error } = await supabaseClient
            .from('account_follows')
            .delete()
            .eq('follower_id', viewerUser.id)
            .eq('following_id', targetUserId);

        if (error) {
            showToast(`Could not unfollow: ${error.message}`, true);
        } else {
            isFollowingTarget = false;
            followersList = followersList.filter(f => f.id !== viewerUser.id);
            showToast(`Unfollowed ${targetProfile.full_name || 'user'}.`);
        }
    } else {
        const { error } = await supabaseClient
            .from('account_follows')
            .insert([{ follower_id: viewerUser.id, following_id: targetUserId }]);

        if (error) {
            showToast(`Could not follow: ${error.message}`, true);
        } else {
            isFollowingTarget = true;
            followersList.unshift({
                id: viewerUser.id,
                full_name: viewerUser.user_metadata?.full_name || viewerUser.email?.split('@')[0] || 'You'
            });
            showToast(`Now following ${targetProfile.full_name || 'user'}!`);
        }
    }

    if (btn) btn.disabled = false;
    document.getElementById('stat-followers').textContent = followersList.length;
    renderFollowButton();
}

function startDmWithUser() {
    if (!viewerUser) {
        showToast('Please sign in to send messages.', true);
        setTimeout(() => {
            window.location.href = `signin.html?next=${encodeURIComponent('messages.html?dm=' + targetUserId)}`;
        }, 800);
        return;
    }
    window.location.href = `messages.html?dm=${encodeURIComponent(targetUserId)}`;
}

async function shareUserProfile() {
    const url = `${window.location.origin}/user.html?id=${encodeURIComponent(targetUserId)}`;
    if (typeof openShareToChatModal === 'function' && viewerUser) {
        openShareToChatModal({
            type: 'shared_profile',
            id: targetUserId,
            title: targetProfile.full_name || 'Accord Member',
            subtitle: isVerifiedMinistryProfile(targetProfile) ? 'Verified Ministry / Minister' : 'Accord Community Member',
            url,
            author_name: targetProfile.full_name || 'Accord Member'
        });
        return;
    }
    try {
        await navigator.clipboard.writeText(url);
        showToast('Profile link copied to clipboard.');
    } catch {
        prompt('Copy profile link:', url);
    }
}

function openConnectionsModal(mode) {
    const modal = document.getElementById('connections-modal');
    const titleEl = document.getElementById('connections-modal-title');
    const listEl = document.getElementById('connections-modal-list');
    if (!modal || !titleEl || !listEl) return;

    const items = mode === 'followers' ? followersList : followingList;
    titleEl.textContent = mode === 'followers' ? `Followers (${items.length})` : `Following (${items.length})`;

    if (items.length === 0) {
        listEl.innerHTML = `<p class="py-8 text-center text-xs text-accord-muted">No ${mode} yet.</p>`;
    } else {
        listEl.innerHTML = items.map(acc => {
            const name = acc.full_name || 'Accord Member';
            const verified = isVerifiedMinistryProfile(acc);
            return `
                <a href="user.html?id=${encodeURIComponent(acc.id)}" class="flex items-center justify-between py-2.5 px-2 rounded-xl hover:bg-slate-50 transition-colors">
                    <div class="flex items-center space-x-3 min-w-0">
                        <div class="w-9 h-9 rounded-full bg-accord-lightBlue text-accord-blue font-bold text-xs flex items-center justify-center shrink-0">
                            ${escapeProfileHtml(name.charAt(0).toUpperCase())}
                        </div>
                        <div class="min-w-0">
                            <p class="text-xs font-bold text-accord-slate truncate flex items-center gap-1.5">
                                <span>${escapeProfileHtml(name)}</span>
                                ${verified ? '<i class="fa-solid fa-circle-check text-accord-blue text-[11px]" title="Verified"></i>' : ''}
                            </p>
                            <p class="text-[10px] text-accord-muted">${verified ? 'Verified Ministry' : 'Member'}</p>
                        </div>
                    </div>
                    <i class="fa-solid fa-chevron-right text-[10px] text-slate-400"></i>
                </a>
            `;
        }).join('');
    }

    modal.classList.remove('hidden');
    modal.classList.add('flex');
}

function closeConnectionsModal() {
    const modal = document.getElementById('connections-modal');
    modal?.classList.add('hidden');
    modal?.classList.remove('flex');
}

function setProfileTab(tab) {
    currentProfileTab = tab;
    document.querySelectorAll('.ptab-btn').forEach(btn => {
        btn.className = 'ptab-btn whitespace-nowrap px-4 py-2 rounded-full text-xs font-bold bg-white text-accord-slate border border-slate-200 hover:bg-slate-100 transition-all';
    });
    const active = document.getElementById(`ptab-${tab}`);
    if (active) {
        active.className = 'ptab-btn whitespace-nowrap px-4 py-2 rounded-full text-xs font-bold bg-accord-blue text-white shadow-sm transition-all';
    }
    renderProfileStream();
}

function buildPinnedAudioStreamCard(profile) {
    const url = String(profile?.audio_stream_url || '').trim();
    if (!url) return null;

    const categoryRaw = String(profile?.audio_stream_type || 'music').toLowerCase();
    const categoryMeta = {
        sermons: { label: 'Sermons', icon: 'fa-solid fa-church', badgeClass: 'bg-indigo-50 text-indigo-700 border-indigo-200' },
        podcast: { label: 'Podcast', icon: 'fa-solid fa-podcast', badgeClass: 'bg-purple-50 text-purple-700 border-purple-200' },
        music: { label: 'Music', icon: 'fa-solid fa-music', badgeClass: 'bg-emerald-50 text-emerald-700 border-emerald-200' }
    }[categoryRaw] || { label: 'Audio', icon: 'fa-solid fa-headphones', badgeClass: 'bg-accord-lightBlue text-accord-blue border-blue-200' };

    const target = window.AccordAudioEmbed?.resolveInAppAudioTarget(url) || {
        kind: 'external',
        embedUrl: '',
        rawUrl: url,
        platform: 'external',
        label: 'Stream',
        icon: categoryMeta.icon,
        height: 352
    };
    const platformLabel = (target.label && target.label !== 'External') ? target.label : 'Stream';
    const openInText = platformLabel === 'Stream' ? 'Open Stream' : `Open in ${platformLabel}`;
    const embedSrc = target.embedUrl || target.rawUrl || url;
    const height = target.height || (String(embedSrc).includes('embed.podcasts.apple.com') || String(embedSrc).includes('embed.music.apple.com') ? 450 : (String(embedSrc).includes('youtube.com/embed') ? 315 : 352));

    let playerHtml = `
        <a href="${escapeProfileHtml(url)}" target="_blank" rel="noopener noreferrer" class="flex items-center justify-between gap-3 p-3.5 rounded-xl bg-slate-50 hover:bg-slate-100 border border-slate-200 transition-colors">
            <div class="flex items-center gap-3 min-w-0">
                <div class="w-10 h-10 rounded-xl bg-accord-lightBlue text-accord-blue flex items-center justify-center shrink-0">
                    <i class="${categoryMeta.icon}"></i>
                </div>
                <div class="min-w-0">
                    <p class="text-xs font-bold text-accord-slate truncate">${escapeProfileHtml(profile.full_name || 'Main Audio Page')}</p>
                    <p class="text-[11px] text-accord-blue truncate">${escapeProfileHtml(url)}</p>
                </div>
            </div>
            <i class="fa-solid fa-arrow-up-right-from-square text-xs text-slate-400 shrink-0"></i>
        </a>
    `;

    if (target.kind === 'audio' && embedSrc) {
        playerHtml = `
            <div class="rounded-xl p-3 bg-slate-50 border border-slate-200/80">
                <audio controls preload="metadata" class="w-full" src="${escapeProfileHtml(embedSrc)}"></audio>
            </div>
        `;
    } else if (target.kind === 'iframe' && target.embedUrl) {
        playerHtml = `
            <div class="rounded-xl overflow-hidden bg-slate-50 border border-slate-200/80">
                <iframe src="${escapeProfileHtml(target.embedUrl)}" allow="autoplay *; encrypted-media *; fullscreen *; clipboard-write" frameborder="0" height="${height}" style="width:100%;overflow:hidden;border-radius:12px;background:transparent;" loading="lazy" sandbox="allow-forms allow-popups allow-same-origin allow-scripts allow-storage-access-by-user-activation allow-top-navigation-by-user-activation"></iframe>
            </div>
        `;
    }

    const card = document.createElement('div');
    card.className = 'bg-white border-2 border-accord-blue/25 rounded-2xl p-4 sm:p-5 shadow-sm space-y-3.5';
    card.innerHTML = `
        <div class="flex flex-wrap items-center justify-between gap-2.5">
            <div class="flex items-center gap-2 flex-wrap">
                <span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-accord-blue text-white text-[10px] font-extrabold uppercase tracking-wider">
                    <i class="fa-solid fa-thumbtack text-[9px]"></i>
                    <span>Pinned Audio Page</span>
                </span>
                <span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[10px] font-extrabold uppercase tracking-wider ${categoryMeta.badgeClass}">
                    <i class="${categoryMeta.icon} text-[10px]"></i>
                    <span>${escapeProfileHtml(categoryMeta.label)}</span>
                </span>
            </div>
            <a href="${escapeProfileHtml(url)}" target="_blank" rel="noopener noreferrer" class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-100 hover:bg-accord-blue hover:text-white text-accord-slate text-[11px] font-bold transition-colors">
                <span>${escapeProfileHtml(openInText)}</span>
                <i class="fa-solid fa-arrow-up-right-from-square text-[10px]"></i>
            </a>
        </div>
        ${playerHtml}
    `;
    return card;
}

function renderProfileStream() {
    const stream = document.getElementById('profile-stream');
    if (!stream) return;

    if (currentProfileTab === 'blog') {
        window.teardownActiveMobileFeedVideo?.();
        if (userApprovedBlogArticles.length === 0) {
            stream.innerHTML = emptyCard('fa-solid fa-feather-pointed', 'No approved blog articles yet', 'Verified blog articles published by this account will appear here.');
            return;
        }
        const categoryLabels = {
            artiste: 'Artistes',
            ministry: 'Ministries',
            pastor: 'Pastors',
            event: 'Events'
        };
        stream.innerHTML = userApprovedBlogArticles.map(art => {
            const catLabel = categoryLabels[art.category] || 'Blog';
            const dateStr = art.created_at
                ? new Date(art.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
                : '';
            const spotlightBadge = art.spotlight_target === 'artist'
                ? `<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-accord-goldLight text-amber-800">Artist Spotlight</span>`
                : (art.spotlight_target === 'ministry'
                    ? `<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-indigo-50 text-indigo-700">Ministry Spotlight</span>`
                    : '');
            return `
                <a href="artist.html?blog_id=${encodeURIComponent(art.id)}" class="block bg-white border border-slate-200/90 hover:border-accord-blue/50 rounded-2xl p-5 shadow-sm hover:shadow-md transition-all group">
                    <div class="flex flex-col sm:flex-row gap-4">
                        ${art.image_url ? `
                            <div class="w-full sm:w-32 h-40 sm:h-28 rounded-xl overflow-hidden bg-slate-100 shrink-0">
                                <img src="${escapeProfileHtml(art.image_url)}" alt="${escapeProfileHtml(art.title)}" class="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300">
                            </div>
                        ` : ''}
                        <div class="flex-1 min-w-0 flex flex-col justify-between space-y-2">
                            <div class="space-y-1.5">
                                <div class="flex flex-wrap items-center gap-1.5">
                                    <span class="px-2.5 py-0.5 rounded-full text-[10px] font-extrabold uppercase tracking-wider bg-slate-100 text-accord-slate">${escapeProfileHtml(catLabel)}</span>
                                    ${art.genre ? `<span class="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-accord-lightBlue text-accord-blue">${escapeProfileHtml(art.genre)}</span>` : ''}
                                    ${spotlightBadge}
                                </div>
                                <h3 class="serif-heading text-base sm:text-lg font-bold text-accord-slate group-hover:text-accord-blue transition-colors">${escapeProfileHtml(art.title)}</h3>
                                <p class="text-xs text-accord-muted leading-relaxed line-clamp-3">${escapeProfileHtml(art.article || '')}</p>
                            </div>
                            <div class="flex items-center justify-between text-[11px] pt-1">
                                <span class="text-accord-muted">${escapeProfileHtml(dateStr)}</span>
                                <span class="font-bold text-accord-blue inline-flex items-center gap-1">Read Article <i class="fa-solid fa-arrow-right text-[10px]"></i></span>
                            </div>
                        </div>
                    </div>
                </a>
            `;
        }).join('');
        return;
    }

    let items = [];
    if (currentProfileTab === 'all') {
        items = [
            ...userOriginalPosts.map(p => ({ kind: 'post', sortAt: p.created_at, post: p, repost: null })),
            ...userReposts.map(r => ({ kind: 'repost', sortAt: r.created_at, post: r.post, repost: r }))
        ].sort((a, b) => new Date(b.sortAt) - new Date(a.sortAt));
    } else {
        items = userOriginalPosts
            .filter(p => p.post_type === currentProfileTab)
            .map(p => ({ kind: 'post', sortAt: p.created_at, post: p, repost: null }));
    }

    const pinnedAudioCard = currentProfileTab === 'audio' ? buildPinnedAudioStreamCard(targetProfile) : null;

    if (items.length === 0 && !pinnedAudioCard) {
        const emptyMessages = {
            all: ['fa-regular fa-newspaper', 'No posts yet', 'Posts and reposts shared by this account will appear here.'],
            testimony: ['fa-regular fa-heart', 'No testimonies yet', 'Testimonies shared by this account will appear here.'],
            video: ['fa-solid fa-video', 'No video posts yet', 'Video posts shared by this account will appear here.'],
            audio: ['fa-solid fa-circle-play', 'No audio posts yet', 'Audio posts shared by this account will appear here.'],
            text: ['fa-solid fa-align-left', 'No text posts yet', 'Text posts shared by this account will appear here.']
        };
        const [icon, title, subtitle] = emptyMessages[currentProfileTab] || emptyMessages.all;
        stream.innerHTML = emptyCard(icon, title, subtitle);
        return;
    }

    const myAvatarInitial = (viewerProfile?.full_name || viewerUser?.email || 'U').charAt(0).toUpperCase();
    window.teardownActiveMobileFeedVideo?.();
    stream.innerHTML = '';
    if (pinnedAudioCard) {
        stream.appendChild(pinnedAudioCard);
    }
    items.forEach(item => {
        const p = item.post;
        const card = createSharedFeedCardElement(p, {
            repost: item.repost,
            isLiked: likedPostIds.has(String(p.id)),
            isReposted: viewerRepostedPostIds.has(String(p.id)),
            commentsCount: commentCountsByPost[String(p.id)] || 0,
            myAvatarInitial,
            authorHandle: p.author_id ? (authorHandlesById[String(p.author_id)] || '') : '',
            authorAvatarUrl: p.author_id ? (authorAvatarsById[String(p.author_id)] || '') : '',
            reposterHandle: item.repost?.reposter_handle || '',
            currentUserId: viewerUser?.id || null
        });
        stream.appendChild(card);
    });
    hydrateSharedBookLinkPreviews(stream);
    window.setupMobileFeedVideoObserver?.();
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
    const post = allVisibleProfilePosts.find(p => String(p.id) === String(postId));
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
    if (!listEl) return;

    const { data } = await supabaseClient
        .from('post_comments')
        .select('id, author_name, comment_text, created_at')
        .eq('post_id', postId)
        .order('created_at', { ascending: true })
        .limit(30);

    listEl.innerHTML = renderSharedCommentsHtml(data || []);
}

async function submitInlineComment(e, postId) {
    e.preventDefault();
    if (!viewerUser) {
        showToast('Please sign in to comment on posts.', true);
        setTimeout(() => {
            window.location.href = `signin.html?next=${encodeURIComponent('user.html?id=' + targetUserId)}`;
        }, 800);
        return;
    }

    const input = document.getElementById(`inline-comment-input-${postId}`);
    const text = input?.value.trim() || '';
    if (!text) return;

    const activeCtx = typeof window.getAccordActiveContext === 'function' ? window.getAccordActiveContext() : null;
    if (activeCtx?.isSwitched && !activeCtx.permissions?.can_post) {
        showToast('You do not have permission to comment on behalf of this verified page.', true);
        return;
    }
    const commentAuthorId = activeCtx?.isSwitched ? activeCtx.activeProfileId : viewerUser.id;
    const authorName = activeCtx?.isSwitched
        ? (activeCtx.activeProfile?.full_name || 'Verified Page')
        : (viewerProfile?.full_name || viewerUser.email?.split('@')[0] || 'Member');
    input.value = '';

    const { error } = await supabaseClient.from('post_comments').insert([{
        post_id: postId,
        user_id: viewerUser.id,
        author_id: commentAuthorId,
        author_name: authorName,
        comment_text: text
    }]);

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

async function togglePostLike(postId) {
    const post = allVisibleProfilePosts.find(p => String(p.id) === String(postId));
    if (!post) return;
    const voterKey = getVoterKey();
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

async function handleRepostClick(postId) {
    if (!viewerUser) {
        showToast('Please sign in to repost to your followers.', true);
        setTimeout(() => {
            window.location.href = `signin.html?next=${encodeURIComponent('user.html?id=' + targetUserId)}`;
        }, 800);
        return;
    }

    if (viewerRepostedPostIds.has(String(postId))) {
        const { error } = await supabaseClient
            .from('post_reposts')
            .delete()
            .eq('post_id', postId)
            .eq('user_id', viewerUser.id);
        if (error) {
            showToast(`Could not remove repost: ${error.message}`, true);
            return;
        }
        showToast('Repost removed.');
        await loadUnifiedProfile();
        return;
    }

    const post = allVisibleProfilePosts.find(p => String(p.id) === String(postId));
    document.getElementById('repost-post-id').value = postId;
    const previewEl = document.getElementById('repost-post-preview');
    if (previewEl && post) {
        const snippet = (post.body || '').trim();
        const shortSnippet = snippet.length > 80 ? `${snippet.slice(0, 80)}...` : snippet;
        previewEl.textContent = `${shortSnippet || 'Post'} — ${post.author_name || 'Member'}`;
    }
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
    if (!viewerUser) return;
    const postId = document.getElementById('repost-post-id').value;
    const quoteText = document.getElementById('repost-quote-text')?.value.trim() || null;
    const btn = document.getElementById('repost-submit-btn');
    if (btn) btn.disabled = true;

    const { error } = await supabaseClient
        .from('post_reposts')
        .insert([{ post_id: postId, user_id: viewerUser.id, quote_text: quoteText }]);

    if (btn) btn.disabled = false;
    if (error) {
        showToast(`Could not repost: ${error.message}`, true);
        return;
    }

    closeRepostModal();
    showToast('Reposted to your followers!');
    await loadUnifiedProfile();
}

function handleShareClick(postId) {
    const post = allVisibleProfilePosts.find(p => String(p.id) === String(postId));
    if (!post) return;
    shareOrCopyPost(post);
}

function handleSendPostToChat(postId) {
    const post = allVisibleProfilePosts.find(p => String(p.id) === String(postId));
    if (!post || typeof openShareToChatModal !== 'function') return;
    const videoThumb = post.post_type === 'video' && typeof getSharedVideoThumbnailUrl === 'function'
        ? getSharedVideoThumbnailUrl(post.media_url)
        : '';
    openShareToChatModal({
        type: post.post_type === 'testimony' ? 'shared_testimony' : 'shared_post',
        id: post.id,
        title: (post.body || '').slice(0, 70) || 'Fellowship Post',
        subtitle: (post.body || '').slice(0, 110),
        url: getPostShareUrl(post.id),
        image_url: videoThumb,
        media_url: post.media_url || '',
        author_name: post.is_anonymous ? 'Anonymous' : (post.author_name || 'Member'),
        post_type: post.post_type
    });
}

function handleEditPostClick(postId) {
    const post = allVisibleProfilePosts.find(p => String(p.id) === String(postId));
    if (!post || typeof openSharedEditPostModal !== 'function') return;
    openSharedEditPostModal(post, () => loadUnifiedProfile());
}

function handleDeletePostClick(postId) {
    if (typeof executeSharedDeletePost !== 'function') return;
    executeSharedDeletePost(postId, () => loadUnifiedProfile());
}

function openReportModal(postId) {
    const input = document.getElementById('report-post-id');
    if (input) input.value = postId;
    const modal = document.getElementById('report-modal');
    modal?.classList.remove('hidden');
    modal?.classList.add('flex');
}

function closeReportModal() {
    const modal = document.getElementById('report-modal');
    modal?.classList.add('hidden');
    modal?.classList.remove('flex');
}

async function handleReportSubmit(e) {
    e.preventDefault();
    const postId = document.getElementById('report-post-id')?.value;
    const category = document.getElementById('report-category-reason')?.value || 'Other';
    const details = document.getElementById('report-reason')?.value.trim() || '';
    if (!postId || !details) return;

    const { error } = await supabaseClient.from('post_reports').insert([{
        post_id: postId,
        reporter_key: getVoterKey(),
        reason: `${category}: ${details}`
    }]);

    if (error) {
        showToast('Could not submit report.', true);
        return;
    }
    closeReportModal();
    showToast('Thank you. Post flagged for review.');
}

function emptyCard(iconClass, title, subtitle) {
    return `
        <div class="bg-white border border-slate-200 rounded-3xl p-12 text-center space-y-2">
            <i class="${iconClass} text-3xl text-slate-300"></i>
            <h3 class="text-sm font-bold text-accord-slate">${title}</h3>
            <p class="text-xs text-accord-muted">${subtitle}</p>
        </div>
    `;
}

function escapeProfileHtml(str) {
    return String(str || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function formatProfileMediaBytes(bytes) {
    if (!bytes || bytes < 1024) return `${bytes || 0} B`;
    if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function syncEditProfileModalMedia() {
    if (!targetProfile) return;
    const avatarImg = document.getElementById('modal-avatar-img');
    const avatarInitial = document.getElementById('modal-avatar-initial');
    const avatarRemoveBtn = document.getElementById('modal-avatar-remove-btn');
    const bannerImg = document.getElementById('modal-banner-img');
    const bannerRemoveBtn = document.getElementById('modal-banner-remove-btn');

    const initial = (targetProfile.full_name || 'U').charAt(0).toUpperCase();
    if (avatarInitial) avatarInitial.textContent = initial;

    if (targetProfile.avatar_url) {
        if (avatarImg) {
            avatarImg.src = targetProfile.avatar_url;
            avatarImg.classList.remove('hidden');
        }
        avatarInitial?.classList.add('hidden');
        avatarRemoveBtn?.classList.remove('hidden');
    } else {
        avatarImg?.classList.add('hidden');
        avatarInitial?.classList.remove('hidden');
        avatarRemoveBtn?.classList.add('hidden');
    }

    if (targetProfile.banner_url) {
        if (bannerImg) {
            bannerImg.src = targetProfile.banner_url;
            bannerImg.classList.remove('hidden');
        }
        bannerRemoveBtn?.classList.remove('hidden');
    } else {
        bannerImg?.classList.add('hidden');
        bannerRemoveBtn?.classList.add('hidden');
    }
}

function openEditProfileModal() {
    if (!canEditTargetProfile || !targetProfile) return;
    document.getElementById('modal-profile-name').value = targetProfile.full_name || '';
    document.getElementById('modal-profile-handle').value = (targetProfile.handle || '').replace(/^@+/, '');
    document.getElementById('modal-profile-bio').value = targetProfile.bio || '';
    const audioUrlEl = document.getElementById('modal-profile-audio-url');
    if (audioUrlEl) audioUrlEl.value = targetProfile.audio_stream_url || '';
    const audioTypeEl = document.getElementById('modal-profile-audio-type');
    if (audioTypeEl) audioTypeEl.value = targetProfile.audio_stream_type || '';
    const statusEl = document.getElementById('modal-profile-handle-status');
    if (statusEl) {
        statusEl.textContent = 'Letters, numbers, and underscores only (3–30 chars).';
        statusEl.className = 'text-[11px] text-accord-muted mt-1';
    }
    const mediaStatus = document.getElementById('modal-media-status');
    if (mediaStatus) mediaStatus.textContent = 'Auto-compressed to save space.';
    syncEditProfileModalMedia();
    const modal = document.getElementById('edit-profile-modal');
    modal?.classList.remove('hidden');
    modal?.classList.add('flex');
}

function closeEditProfileModal() {
    const modal = document.getElementById('edit-profile-modal');
    modal?.classList.add('hidden');
    modal?.classList.remove('flex');
}

let modalHandleCheckTimer = null;
function handleModalProfileHandleInput(inputEl) {
    const clean = inputEl.value.toLowerCase().replace(/^@+/, '').replace(/[^a-z0-9_]/g, '');
    if (inputEl.value !== clean) inputEl.value = clean;
    const statusEl = document.getElementById('modal-profile-handle-status');
    if (!statusEl) return;
    const candidate = clean ? `@${clean}` : '';
    clearTimeout(modalHandleCheckTimer);
    if (!/^@[a-z0-9_]{3,30}$/.test(candidate)) {
        statusEl.textContent = 'Use 3–30 letters, numbers, or underscores.';
        statusEl.className = 'text-[11px] text-amber-600 mt-1';
        return;
    }
    if (targetProfile?.handle && targetProfile.handle.toLowerCase() === candidate.toLowerCase()) {
        statusEl.textContent = `${candidate} is the current handle.`;
        statusEl.className = 'text-[11px] text-accord-muted mt-1';
        return;
    }
    statusEl.textContent = `Checking ${candidate}...`;
    statusEl.className = 'text-[11px] text-accord-muted mt-1';
    modalHandleCheckTimer = setTimeout(async () => {
        const { data: available } = await supabaseClient.rpc('is_handle_available', {
            candidate,
            exclude_user_id: targetUserId
        });
        if (available) {
            statusEl.textContent = `${candidate} is available!`;
            statusEl.className = 'text-[11px] text-emerald-600 font-semibold mt-1';
        } else {
            statusEl.textContent = `${candidate} is already taken. Try another.`;
            statusEl.className = 'text-[11px] text-red-600 font-semibold mt-1';
        }
    }, 250);
}

async function handleModalAvatarUpload(inputEl) {
    const file = inputEl?.files?.[0];
    if (!file || !canEditTargetProfile || typeof window.uploadCompressedProfileMedia !== 'function') return;
    const statusEl = document.getElementById('modal-media-status');
    if (statusEl) statusEl.textContent = 'Compressing & uploading picture...';
    try {
        const res = await window.uploadCompressedProfileMedia(supabaseClient, file, 'avatar', targetUserId);
        const { error } = await supabaseClient
            .from('profiles')
            .update({ avatar_url: res.url })
            .eq('id', targetUserId);
        if (error) throw error;

        if (viewerUser && viewerUser.id === targetUserId) {
            await supabaseClient.auth.updateUser({ data: { avatar_url: res.url } });
            if (typeof renderGlobalHeader === 'function') renderGlobalHeader();
        }
        targetProfile.avatar_url = res.url;
        authorAvatarsById[String(targetUserId)] = res.url;
        syncEditProfileModalMedia();
        renderProfileHeader();
        renderProfileStream();
        if (statusEl) statusEl.textContent = `Saved (${formatProfileMediaBytes(res.originalSize)} → ${formatProfileMediaBytes(res.compressedSize)}).`;
        showToast('Profile picture updated.');
    } catch (err) {
        if (statusEl) statusEl.textContent = 'Auto-compressed to save space.';
        showToast(`Could not upload picture: ${err.message || 'Upload failed'}`, true);
    } finally {
        inputEl.value = '';
    }
}

async function removeModalAvatar() {
    if (!canEditTargetProfile) return;
    const { error } = await supabaseClient
        .from('profiles')
        .update({ avatar_url: null })
        .eq('id', targetUserId);
    if (error) {
        showToast(`Could not remove picture: ${error.message}`, true);
        return;
    }
    if (viewerUser && viewerUser.id === targetUserId) {
        await supabaseClient.auth.updateUser({ data: { avatar_url: null } });
        if (typeof renderGlobalHeader === 'function') renderGlobalHeader();
    }
    targetProfile.avatar_url = null;
    delete authorAvatarsById[String(targetUserId)];
    syncEditProfileModalMedia();
    renderProfileHeader();
    renderProfileStream();
    showToast('Profile picture removed.');
}

async function handleModalBannerUpload(inputEl) {
    const file = inputEl?.files?.[0];
    if (!file || !canEditTargetProfile || typeof window.uploadCompressedProfileMedia !== 'function') return;
    const statusEl = document.getElementById('modal-media-status');
    if (statusEl) statusEl.textContent = 'Compressing & uploading banner...';
    try {
        const res = await window.uploadCompressedProfileMedia(supabaseClient, file, 'banner', targetUserId);
        const { error } = await supabaseClient
            .from('profiles')
            .update({ banner_url: res.url })
            .eq('id', targetUserId);
        if (error) throw error;

        targetProfile.banner_url = res.url;
        syncEditProfileModalMedia();
        renderProfileHeader();
        if (statusEl) statusEl.textContent = `Banner saved (${formatProfileMediaBytes(res.originalSize)} → ${formatProfileMediaBytes(res.compressedSize)}).`;
        showToast('Page banner updated.');
    } catch (err) {
        if (statusEl) statusEl.textContent = 'Auto-compressed to save space.';
        showToast(`Could not upload banner: ${err.message || 'Upload failed'}`, true);
    } finally {
        inputEl.value = '';
    }
}

async function removeModalBanner() {
    if (!canEditTargetProfile) return;
    const { error } = await supabaseClient
        .from('profiles')
        .update({ banner_url: null })
        .eq('id', targetUserId);
    if (error) {
        showToast(`Could not remove banner: ${error.message}`, true);
        return;
    }
    targetProfile.banner_url = null;
    syncEditProfileModalMedia();
    renderProfileHeader();
    showToast('Page banner removed.');
}

async function submitEditProfileModal(e) {
    e.preventDefault();
    if (!canEditTargetProfile || !targetProfile) return;

    const fullName = document.getElementById('modal-profile-name')?.value.trim() || '';
    const rawHandle = (document.getElementById('modal-profile-handle')?.value || '').trim().toLowerCase().replace(/^@+/, '').replace(/[^a-z0-9_]/g, '');
    const handle = rawHandle ? `@${rawHandle}` : '';
    const bio = document.getElementById('modal-profile-bio')?.value.trim() || '';
    const audioStreamUrl = document.getElementById('modal-profile-audio-url')?.value.trim() || null;
    const audioStreamType = document.getElementById('modal-profile-audio-type')?.value.trim() || null;
    const btn = document.getElementById('modal-profile-save-btn');

    if (audioStreamUrl && !audioStreamType) {
        showToast('Please select whether the audio link is for Sermons, Music, or Podcast.', true);
        return;
    }

    if (!fullName) {
        showToast('Please enter a display name.', true);
        return;
    }
    if (!/^@[a-z0-9_]{3,30}$/.test(handle)) {
        showToast('Please enter a valid @handle (3–30 letters, numbers, or underscores).', true);
        return;
    }

    if (btn) {
        btn.disabled = true;
        btn.textContent = 'Saving...';
    }

    const { data: available, error: availErr } = await supabaseClient.rpc('is_handle_available', {
        candidate: handle,
        exclude_user_id: targetUserId
    });
    if (!availErr && available === false) {
        if (btn) {
            btn.disabled = false;
            btn.textContent = 'Save Changes';
        }
        showToast(`Handle ${handle} is already in use.`, true);
        return;
    }

    const updatePayload = {
        full_name: fullName,
        handle,
        bio,
        audio_stream_url: audioStreamUrl,
        audio_stream_type: audioStreamUrl ? audioStreamType : null
    };

    let { error } = await supabaseClient
        .from('profiles')
        .update(updatePayload)
        .eq('id', targetUserId);

    if (error && /audio_stream_/i.test(error.message || '')) {
        delete updatePayload.audio_stream_url;
        delete updatePayload.audio_stream_type;
        const retry = await supabaseClient
            .from('profiles')
            .update(updatePayload)
            .eq('id', targetUserId);
        error = retry.error;
    }

    if (!error && viewerUser && viewerUser.id === targetUserId) {
        await supabaseClient.auth.updateUser({ data: { full_name: fullName, handle } });
    }

    if (btn) {
        btn.disabled = false;
        btn.textContent = 'Save Changes';
    }

    if (error) {
        showToast(/unique|duplicate/i.test(error.message) ? `Handle ${handle} is already taken.` : error.message, true);
        return;
    }

    targetProfile.full_name = fullName;
    targetProfile.handle = handle;
    targetProfile.bio = bio;
    targetProfile.audio_stream_url = audioStreamUrl;
    targetProfile.audio_stream_type = audioStreamUrl ? audioStreamType : null;
    authorHandlesById[String(targetUserId)] = handle;
    closeEditProfileModal();
    renderProfileHeader();
    renderProfileStream();
    if (typeof renderGlobalHeader === 'function') renderGlobalHeader();
    showToast('Profile updated.');
}

// =========================================================
// VERIFIED ACCOUNT BLOG WRITING & SINGLE IMAGE UPLOAD
// =========================================================

function openWriteBlogModal() {
    if (!viewerUser || !isVerifiedMinistryProfile(targetProfile) || !canEditTargetProfile) {
        showToast('Only verified accounts can write to the blog.', true);
        return;
    }
    const modal = document.getElementById('write-blog-modal');
    const form = document.getElementById('write-blog-form');
    if (form) form.reset();
    clearBlogImageUpload();
    modal?.classList.remove('hidden');
    modal?.classList.add('flex');
}

function closeWriteBlogModal() {
    const modal = document.getElementById('write-blog-modal');
    modal?.classList.add('hidden');
    modal?.classList.remove('flex');
}

function clearBlogImageUpload() {
    const urlInput = document.getElementById('blog-article-image-url');
    const fileInput = document.getElementById('blog-article-image-file');
    const preview = document.getElementById('blog-article-image-preview');
    const placeholder = document.getElementById('blog-article-image-placeholder');
    const removeBtn = document.getElementById('blog-article-image-remove');
    const statusEl = document.getElementById('blog-article-upload-status');
    if (urlInput) urlInput.value = '';
    if (fileInput) fileInput.value = '';
    if (preview) {
        preview.src = '';
        preview.classList.add('hidden');
    }
    placeholder?.classList.remove('hidden');
    removeBtn?.classList.add('hidden');
    if (statusEl) statusEl.textContent = 'Optional cover image (max 1 image, JPG/PNG/WebP).';
}

function compressBlogImageFile(file, maxDim = 1200, quality = 0.85) {
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
                    blob => blob ? resolve({ blob, ext: 'webp', contentType: 'image/webp' }) : reject(new Error('Image compression failed.')),
                    'image/webp',
                    quality
                );
            };
            img.src = reader.result;
        };
        reader.readAsDataURL(file);
    });
}

async function handleBlogImageUpload(event) {
    const file = event?.target?.files?.[0];
    if (!file) return;

    const statusEl = document.getElementById('blog-article-upload-status');
    const labelEl = document.getElementById('blog-article-upload-label');
    if (statusEl) statusEl.textContent = 'Uploading image...';
    labelEl?.classList.add('opacity-60', 'pointer-events-none');

    try {
        const { blob, ext, contentType } = await compressBlogImageFile(file);
        const fileName = `blog_${Date.now()}_${Math.random().toString(36).slice(2, 7)}.${ext}`;
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
        const urlInput = document.getElementById('blog-article-image-url');
        const preview = document.getElementById('blog-article-image-preview');
        const placeholder = document.getElementById('blog-article-image-placeholder');
        const removeBtn = document.getElementById('blog-article-image-remove');

        if (urlInput) urlInput.value = publicUrl;
        if (preview) {
            preview.src = publicUrl;
            preview.classList.remove('hidden');
        }
        placeholder?.classList.add('hidden');
        removeBtn?.classList.remove('hidden');
        if (statusEl) statusEl.textContent = 'Image uploaded (1/1).';
        showToast('Blog image uploaded!');
    } catch (err) {
        if (statusEl) statusEl.textContent = 'Upload failed. Please try again.';
        showToast(`Upload failed: ${err.message}`, true);
    } finally {
        labelEl?.classList.remove('opacity-60', 'pointer-events-none');
        if (event?.target) event.target.value = '';
    }
}

async function handleWriteBlogSubmit(event) {
    event.preventDefault();
    if (!viewerUser || !isVerifiedMinistryProfile(targetProfile) || !canEditTargetProfile) {
        showToast('Only verified accounts can submit blog articles.', true);
        return;
    }

    const category = document.getElementById('blog-article-category')?.value || '';
    const title = (document.getElementById('blog-article-title')?.value || '').trim();
    const genre = (document.getElementById('blog-article-genre')?.value || '').trim() || 'Gospel';
    const imageUrl = (document.getElementById('blog-article-image-url')?.value || '').trim();
    const link = (document.getElementById('blog-article-link')?.value || '').trim();
    const article = (document.getElementById('blog-article-body')?.value || '').trim();
    const submitBtn = document.getElementById('blog-article-submit-btn');

    if (!['artiste', 'ministry', 'pastor', 'event'].includes(category)) {
        showToast('Please select a valid category.', true);
        return;
    }
    if (!title || !article) {
        showToast('Please enter both a title and article content.', true);
        return;
    }

    if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = 'Submitting...';
    }

    const { error } = await supabaseClient
        .from('blog_articles')
        .insert([{
            author_id: targetUserId,
            author_name: targetProfile.full_name || 'Verified Account',
            author_handle: targetProfile.handle || null,
            category,
            title,
            genre,
            article,
            image_url: imageUrl || null,
            link: link || null,
            status: 'pending'
        }]);

    if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Submit for Verification';
    }

    if (error) {
        showToast(`Could not submit article: ${error.message}`, true);
        return;
    }

    closeWriteBlogModal();
    showToast('Article submitted for admin verification. It will appear on the blog and your profile once approved.');
}
