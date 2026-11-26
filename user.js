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
let allVisibleProfilePosts = [];
let likedPostIds = new Set();
let viewerRepostedPostIds = new Set();
let commentCountsByPost = {};
let authorHandlesById = {};

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
    const { data: profile, error } = await supabaseClient
        .from('profiles')
        .select('id, full_name, handle, bio, avatar_url, account_type, upgrade_status, created_at')
        .eq('id', targetUserId)
        .maybeSingle();

    if (error || !profile) {
        showProfileNotFound();
        return;
    }

    targetProfile = profile;
    const displayName = profile.full_name || 'Accord Member';
    document.title = `${displayName} — Accord Archive`;

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
            supabaseClient.from('post_reposts').select('post_id').eq('user_id', viewerUser.id)
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
    if (targetProfile.handle) authorHandlesById[String(targetProfile.id)] = targetProfile.handle;
    const otherAuthorIds = [...new Set(allVisibleProfilePosts.map(p => p.author_id).filter(id => id && String(id) !== String(targetUserId)))];
    if (otherAuthorIds.length > 0) {
        const { data: apRows } = await supabaseClient.from('profiles').select('id, handle').in('id', otherAuthorIds);
        (apRows || []).forEach(ap => {
            if (ap.handle) authorHandlesById[String(ap.id)] = ap.handle;
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

    renderProfileHeader();
    renderProfileStream();

    document.getElementById('profile-loading')?.classList.add('hidden');
    document.getElementById('profile-header-card')?.classList.remove('hidden');
    document.getElementById('profile-tabs-bar')?.classList.remove('hidden');
    document.getElementById('profile-stream')?.classList.remove('hidden');
}

function renderProfileHeader() {
    const displayName = targetProfile.full_name || 'Accord Member';
    const isVerified = isVerifiedMinistryProfile(targetProfile);

    document.getElementById('profile-avatar-initial').textContent = displayName.charAt(0).toUpperCase();
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
    document.getElementById('user-edit-btn')?.classList.toggle('hidden', !isSelf);
    document.getElementById('user-message-btn')?.classList.toggle('hidden', Boolean(isSelf));
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

function renderProfileStream() {
    const stream = document.getElementById('profile-stream');
    if (!stream) return;

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

    if (items.length === 0) {
        const emptyMessages = {
            all: ['fa-regular fa-newspaper', 'No posts yet', 'Posts and reposts shared by this account will appear here.'],
            testimony: ['fa-regular fa-heart', 'No testimonies yet', 'Testimonies shared by this account will appear here.'],
            video: ['fa-solid fa-video', 'No video posts yet', 'Video posts shared by this account will appear here.'],
            audio: ['fa-solid fa-podcast', 'No audio posts yet', 'Audio posts shared by this account will appear here.'],
            text: ['fa-solid fa-align-left', 'No text posts yet', 'Text posts shared by this account will appear here.']
        };
        const [icon, title, subtitle] = emptyMessages[currentProfileTab] || emptyMessages.all;
        stream.innerHTML = emptyCard(icon, title, subtitle);
        return;
    }

    const myAvatarInitial = (viewerProfile?.full_name || viewerUser?.email || 'U').charAt(0).toUpperCase();
    stream.innerHTML = '';
    items.forEach(item => {
        const p = item.post;
        const card = createSharedFeedCardElement(p, {
            repost: item.repost,
            isLiked: likedPostIds.has(String(p.id)),
            isReposted: viewerRepostedPostIds.has(String(p.id)),
            commentsCount: commentCountsByPost[String(p.id)] || 0,
            myAvatarInitial,
            authorHandle: p.author_id ? (authorHandlesById[String(p.author_id)] || '') : '',
            reposterHandle: item.repost?.reposter_handle || '',
            currentUserId: viewerUser?.id || null
        });
        stream.appendChild(card);
    });
    hydrateSharedBookLinkPreviews(stream);
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

    const authorName = viewerProfile?.full_name || viewerUser.email?.split('@')[0] || 'Member';
    input.value = '';

    const { error } = await supabaseClient.from('post_comments').insert([{
        post_id: postId,
        user_id: viewerUser.id,
        author_id: viewerUser.id,
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
    openShareToChatModal({
        type: post.post_type === 'testimony' ? 'shared_testimony' : 'shared_post',
        id: post.id,
        title: post.title,
        subtitle: (post.body || '').slice(0, 110),
        url: getPostShareUrl(post.id),
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
